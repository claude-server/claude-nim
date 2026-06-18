// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import * as vscode from "vscode";
import {
  DEBUG_ENV_VAR,
  DEBUG_STATE_KEY,
  MANAGE_COMMAND_ID,
  OPEN_DEBUG_LOG_COMMAND_ID,
  PROVIDER_DISPLAY_NAME,
  SECRET_STORAGE_KEY,
  SHOW_REASONING_STATE_KEY,
  TOGGLE_DEBUG_LOGGING_COMMAND_ID,
  TOGGLE_SHOW_REASONING_COMMAND_ID,
  LAUNCH_CLAUDE_CODE_COMMAND_ID,
  SELECT_DEFAULT_MODEL_COMMAND_ID,
} from "./constants";
import { debugLog, getOutputChannel } from "./output-channel";
import { StatusBarManager } from "./status-bar";
import {
  startProxyServer,
  stopProxyServer,
  isProxyRunning,
  setShowReasoning,
  setModelsCacheTTL,
  setRequestTimeout,
  setDefaultModel,
} from "./server";
import { fetchModels } from "./api";
import { normalizeNvidiaModels } from "./model-catalog";
import { buildCustomModelOptions } from "./model-switch";

let _statusBar: StatusBarManager | null = null;

async function ensureCliInstalled(): Promise<boolean> {
  const { execSync } = require("child_process");
  try {
    execSync("claude-nim --version", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    // Not installed, install it
    return new Promise<boolean>((resolve) => {
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Claude-NIM Proxy",
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: "Installing CLI globally..." });
          try {
            const { exec } = require("child_process");
            await new Promise<void>((res, rej) => {
              exec(
                "npm install -g claude-nim",
                { timeout: 120000 },
                (err: Error | null) => {
                  if (err) rej(err);
                  else res();
                },
              );
            });
            vscode.window.showInformationMessage(
              "Claude-NIM CLI installed successfully.",
            );
            resolve(true);
          } catch (e) {
            vscode.window.showErrorMessage(
              "Failed to install Claude-NIM CLI. Install manually: npm install -g claude-nim",
            );
            resolve(false);
          }
        },
      );
    });
  }
}

async function tryStartProxy(
  context: vscode.ExtensionContext,
  showMessage = false,
): Promise<void> {
  if (isProxyRunning()) {
    if (showMessage) {
      vscode.window.showInformationMessage(
        "Claude Code Proxy is already running.",
      );
    }
    return;
  }

  const apiKey = await context.secrets.get(SECRET_STORAGE_KEY);
  if (!apiKey) {
    if (showMessage) {
      vscode.window.showErrorMessage(
        "Please configure your NVIDIA NIM API key first.",
      );
    }
    return;
  }

  const config = vscode.workspace.getConfiguration("nvidia-nim");
  const port = config.get<number>("proxyPort", 3456);
  const defaultModel = config.get<string>("defaultModel", "");
  const showReasoning = context.globalState.get<boolean>(
    SHOW_REASONING_STATE_KEY,
    false,
  );
  const cacheTTL = config.get<number>("modelsCacheTTL", 5);
  const requestTimeout = config.get<number>("requestTimeout", 120);

  setShowReasoning(showReasoning);
  setModelsCacheTTL(cacheTTL);
  setRequestTimeout(requestTimeout);
  startProxyServer(port, apiKey, defaultModel || undefined, (running, p) => {
    _statusBar?.update(running, p, defaultModel || undefined);
  });
  _statusBar?.update(true, port, defaultModel || undefined);
}

function stopProxy(showMessage = false): void {
  if (!isProxyRunning()) {
    if (showMessage) {
      vscode.window.showInformationMessage("Claude Code Proxy is not running.");
    }
    return;
  }

  stopProxyServer();
  _statusBar?.update(false);
}

export async function activate(context: vscode.ExtensionContext) {
  const channel = getOutputChannel();
  context.subscriptions.push(channel);

  _statusBar = new StatusBarManager();
  context.subscriptions.push(_statusBar);

  // Auto-install CLI if not present
  await ensureCliInstalled();

  const debugEnabled = context.globalState.get<boolean>(DEBUG_STATE_KEY, false);
  process.env[DEBUG_ENV_VAR] = debugEnabled ? "1" : "0";
  debugLog(
    "activate",
    `Extension activated. Debug logging ${debugEnabled ? "enabled" : "disabled"}.`,
  );

  const showReasoning = context.globalState.get<boolean>(
    SHOW_REASONING_STATE_KEY,
    false,
  );
  setShowReasoning(showReasoning);

  // Manage API Key Command
  context.subscriptions.push(
    vscode.commands.registerCommand(MANAGE_COMMAND_ID, async () => {
      const existing = await context.secrets.get(SECRET_STORAGE_KEY);
      const apiKey = await vscode.window.showInputBox({
        title: `${PROVIDER_DISPLAY_NAME} API Key`,
        prompt: existing
          ? `Update your ${PROVIDER_DISPLAY_NAME} API key`
          : `Enter your ${PROVIDER_DISPLAY_NAME} API key`,
        ignoreFocusOut: true,
        password: true,
        value: existing ?? "",
        placeHolder: `Enter your ${PROVIDER_DISPLAY_NAME} API key...`,
      });
      if (apiKey === undefined) {
        return;
      }
      if (!apiKey.trim()) {
        await context.secrets.delete(SECRET_STORAGE_KEY);
        vscode.window.showInformationMessage(
          `${PROVIDER_DISPLAY_NAME} API key cleared.`,
        );
        stopProxy();
        return;
      }
      await context.secrets.store(SECRET_STORAGE_KEY, apiKey.trim());
      vscode.window.showInformationMessage(
        `${PROVIDER_DISPLAY_NAME} API key saved.`,
      );

      // Auto-restart proxy with new key
      stopProxy();
      await tryStartProxy(context);
    }),
  );

  // Toggle Debug Logging
  context.subscriptions.push(
    vscode.commands.registerCommand(
      TOGGLE_DEBUG_LOGGING_COMMAND_ID,
      async () => {
        const current = context.globalState.get<boolean>(
          DEBUG_STATE_KEY,
          false,
        );
        const next = !current;
        await context.globalState.update(DEBUG_STATE_KEY, next);
        process.env[DEBUG_ENV_VAR] = next ? "1" : "0";
        debugLog(
          "toggleDebug",
          `Debug logging ${next ? "enabled" : "disabled"}.`,
        );
        vscode.window.showInformationMessage(
          `${PROVIDER_DISPLAY_NAME} debug logging ${next ? "enabled" : "disabled"}.`,
        );
      },
    ),
  );

  // Toggle Show Reasoning
  context.subscriptions.push(
    vscode.commands.registerCommand(
      TOGGLE_SHOW_REASONING_COMMAND_ID,
      async () => {
        const current = context.globalState.get<boolean>(
          SHOW_REASONING_STATE_KEY,
          false,
        );
        const next = !current;
        await context.globalState.update(SHOW_REASONING_STATE_KEY, next);
        setShowReasoning(next);
        vscode.window.showInformationMessage(
          `${PROVIDER_DISPLAY_NAME} model reasoning output is now ${next ? "visible" : "hidden"}.`,
        );
      },
    ),
  );

  // Open Debug Log
  context.subscriptions.push(
    vscode.commands.registerCommand(OPEN_DEBUG_LOG_COMMAND_ID, () => {
      const output = getOutputChannel();
      output.show(true);
    }),
  );

  // Toggle Proxy Server
  context.subscriptions.push(
    vscode.commands.registerCommand("nvidia-nim.toggleProxy", async () => {
      if (isProxyRunning()) {
        stopProxy(true);
      } else {
        await tryStartProxy(context, true);
      }
    }),
  );

  // Launch Claude Code with Proxy
  context.subscriptions.push(
    vscode.commands.registerCommand(LAUNCH_CLAUDE_CODE_COMMAND_ID, async () => {
      if (!isProxyRunning()) {
        await tryStartProxy(context, true);
      }

      const apiKey = await context.secrets.get(SECRET_STORAGE_KEY);
      if (!apiKey) {
        vscode.window.showErrorMessage(
          "Cannot launch Claude Code without an API key.",
        );
        return;
      }

      const config = vscode.workspace.getConfiguration("nvidia-nim");
      const port = config.get<number>("proxyPort", 3456);

      // Fetch NIM models for ANTHROPIC_CUSTOM_MODEL_OPTION
      let customModelOption = "[]";
      try {
        const rawModels = await fetchModels(apiKey);
        if (rawModels) {
          const models = normalizeNvidiaModels(rawModels);
          customModelOption = buildCustomModelOptions(models);
        }
      } catch {
        // Launch without custom models if fetch fails
      }

      const terminal = vscode.window.createTerminal({
        name: "Claude Code (NVIDIA NIM)",
        env: {
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
          ANTHROPIC_API_KEY: apiKey,
          CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
          ANTHROPIC_CUSTOM_MODEL_OPTION: customModelOption,
          ANTHROPIC_AUTH_TOKEN: "",
        },
      });
      terminal.show();
      terminal.sendText("claude");
    }),
  );

  // Select Default Model
  context.subscriptions.push(
    vscode.commands.registerCommand(
      SELECT_DEFAULT_MODEL_COMMAND_ID,
      async () => {
        const apiKey = await context.secrets.get(SECRET_STORAGE_KEY);
        if (!apiKey) {
          vscode.window.showErrorMessage(
            "Please configure your NVIDIA NIM API key first.",
          );
          return;
        }

        const modelsResponse = await fetchModels(apiKey);
        if (!modelsResponse) {
          vscode.window.showErrorMessage(
            "Failed to fetch models from NVIDIA NIM.",
          );
          return;
        }

        const models = normalizeNvidiaModels(modelsResponse);
        const items = models.map((m) => ({
          label: m.displayName,
          description: m.id,
          detail: `Context Window: ${m.contextWindow.toLocaleString()} tokens`,
          modelId: m.id,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: "Select a default model for Claude Code",
          matchOnDescription: true,
        });

        if (selected) {
          const config = vscode.workspace.getConfiguration("nvidia-nim");
          await config.update(
            "defaultModel",
            selected.modelId,
            vscode.ConfigurationTarget.Global,
          );
          vscode.window.showInformationMessage(
            `Default model set to ${selected.label}.`,
          );
        }
      },
    ),
  );

  // Configuration Change Listener — react to all setting changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("nvidia-nim")) return;

      const config = vscode.workspace.getConfiguration("nvidia-nim");

      if (e.affectsConfiguration("nvidia-nim.proxyPort")) {
        if (isProxyRunning()) {
          stopProxy();
          void tryStartProxy(context);
        }
        return;
      }

      // These can be applied live without restart
      const cacheTTL = config.get<number>("modelsCacheTTL", 5);
      setModelsCacheTTL(cacheTTL);

      const requestTimeout = config.get<number>("requestTimeout", 120);
      setRequestTimeout(requestTimeout);

      const defaultModel = config.get<string>("defaultModel", "");
      setDefaultModel(defaultModel || undefined);
    }),
  );

  // Automatically start proxy on load if key exists
  void tryStartProxy(context);
}

export function deactivate() {
  stopProxyServer();
  _statusBar = null;
}
