#!/usr/bin/env node
// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import Module from "node:module";

// ============================================================================
// 1. VS Code Module Mock
// ============================================================================
const mockVscode = {
  window: {
    showInformationMessage: () => Promise.resolve(),
    showErrorMessage: (msg: string) => {
      console.error(`[Proxy Error] ${msg}`);
      return Promise.resolve();
    },
  },
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, defaultValue: unknown) => defaultValue,
    }),
  },
};

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === "vscode") return mockVscode;
  return originalRequire.call(this, id);
};

// ============================================================================
// Imports (Must be after the mock)
// ============================================================================
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import * as net from "node:net";
import * as child_process from "node:child_process";
import chalk from "chalk";
import { startProxyServer, stopProxyServer } from "../server/index";
import { fetchModels } from "../api";
import {
  normalizeNvidiaModels,
  MODEL_FAMILY_RULES,
  MODEL_FAMILY_ORDER,
} from "../api/model-catalog";
import type { NormalizedNvidiaModel } from "../api/model-catalog";
import {
  getCurrentModel,
  setCurrentModel,
  resetCurrentModel,
} from "../api/model-switch";
import { getSessionStats } from "../dashboard";
import {
  renderMainMenu,
  renderListMenu,
  clearScreen,
  rawOn,
  rawOff,
} from "./cli-menu";
import {
  registerInstallation,
  checkForUpdates,
  sendCreatorMessage,
} from "../creator";

// ============================================================================
// 2. Encryption & Key Storage
// ============================================================================
const KEY_FILE = path.join(os.homedir(), ".claude-nim-key");
const ALGORITHM = "aes-256-gcm";

function getMachineKey(): Buffer {
  const machineId = `${os.hostname()}-${os.platform()}-${os.arch()}-${os.userInfo().username}`;
  return crypto.scryptSync(machineId, "claude-nim-salt", 32);
}

function encryptKey(apiKey: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getMachineKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString("hex"),
    data: encrypted.toString("hex"),
    tag: authTag.toString("hex"),
  });
}

function decryptKey(payload: string): string | null {
  try {
    const { iv, data, tag } = JSON.parse(payload);
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      getMachineKey(),
      Buffer.from(iv, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(data, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

function getStoredApiKey(): string | null {
  if (!fs.existsSync(KEY_FILE)) return null;
  const payload = fs.readFileSync(KEY_FILE, "utf8");
  return decryptKey(payload);
}

function saveApiKey(apiKey: string): void {
  const encrypted = encryptKey(apiKey);
  fs.writeFileSync(KEY_FILE, encrypted, { mode: 0o600 });
}

function clearApiKey(): void {
  try {
    if (fs.existsSync(KEY_FILE)) fs.unlinkSync(KEY_FILE);
  } catch {
    // ignore
  }
}

// ============================================================================
// 3. Prompt Helpers (raw mode, ESC = cancel/back)
// ============================================================================
function promptForInput(question: string): Promise<string | null> {
  return new Promise((resolve) => {
    rawOn();
    process.stdout.write(question);

    let input = "";

    function handler(data: Buffer) {
      const char = data.toString();
      if (char === "\r" || char === "\n") {
        cleanup();
        resolve(input);
      } else if (char === "\x03") {
        cleanup();
        process.exit(0);
      } else if (char === "\x1b") {
        cleanup();
        resolve(null);
      } else if (char === "\x7f" || char === "\b") {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else if (char.length === 1 && char >= " ") {
        input += char;
        process.stdout.write(char);
      }
    }

    function cleanup() {
      process.stdin.removeListener("data", handler);
      rawOff();
    }

    process.stdin.on("data", handler);
  });
}

function promptEnterToContinue(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    rawOn();
    process.stdout.write(prompt);

    function handler(data: Buffer) {
      const char = data.toString();
      if (char === "\r" || char === "\n") {
        cleanup();
        resolve(true);
      } else if (char === "\x1b" || char === "\x03") {
        cleanup();
        resolve(false);
      }
    }

    function cleanup() {
      process.stdin.removeListener("data", handler);
      rawOff();
    }

    process.stdin.on("data", handler);
  });
}

async function getOrPromptApiKey(cliArgKey?: string): Promise<string> {
  if (cliArgKey) {
    saveApiKey(cliArgKey);
    return cliArgKey;
  }

  const storedKey = getStoredApiKey();
  if (storedKey) return storedKey;

  console.log("\nNo NVIDIA NIM API key found.");
  console.log("Get your key securely from: https://build.nvidia.com/");
  const answer = await promptForInput("Enter your NVIDIA NIM API key: ");

  if (!answer) {
    console.error("API key is required to start.");
    process.exit(1);
  }

  saveApiKey(answer);
  console.log(" API key securely encrypted and stored locally.\n");
  return answer;
}

// ============================================================================
// 4. Claude CLI Detection
// ============================================================================
function isClaudeInstalled(): boolean {
  try {
    const cmd = process.platform === "win32" ? "where claude" : "which claude";
    child_process.execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function ensureClaudeInstalled(): Promise<void> {
  if (isClaudeInstalled()) return;

  console.warn("⚠️  Claude Code CLI is not installed globally.");
  const answer = await promptForInput(
    "Would you like to install it now via bun? (y/N): ",
  );
  if (answer?.toLowerCase() === "y" || answer?.toLowerCase() === "yes") {
    console.log("Installing @anthropic-ai/claude-code globally via bun...");
    try {
      child_process.execSync("bun install -g @anthropic-ai/claude-code", {
        stdio: "inherit",
      });
      console.log("✅ Claude Code installed successfully.\n");
    } catch {
      console.error(
        "❌ Failed to install Claude Code. Please install it manually:",
      );
      console.error("bun install -g @anthropic-ai/claude-code");
      process.exit(1);
    }
  } else {
    console.error("Cannot proceed without Claude Code. Exiting.");
    process.exit(1);
  }
}

// ============================================================================
// 5. Dynamic Port Binding
// ============================================================================
function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      const fallbackServer = net.createServer();
      fallbackServer.listen(0, "127.0.0.1", () => {
        const port = (fallbackServer.address() as net.AddressInfo).port;
        fallbackServer.close(() => resolve(port));
      });
    });
  });
}

// ============================================================================
// 6. Child Process & Process Lifecycle Management
// ============================================================================
let claudeProcess: child_process.ChildProcess | null = null;
let isCleaningUp = false;

function cleanupAndExit(exitCode = 0) {
  if (isCleaningUp) return;
  isCleaningUp = true;

  resetCurrentModel();
  stopProxyServer();

  try {
    const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
    if (fs.existsSync(settingsPath)) {
      const cfg = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      delete cfg.model;
      fs.writeFileSync(settingsPath, JSON.stringify(cfg, null, 2), "utf8");
    }
  } catch {
    // ignore
  }

  try {
    const stats = getSessionStats();
    const minutes = Math.floor(stats.uptimeMs / 60000);
    const seconds = Math.floor((stats.uptimeMs % 60000) / 1000);
    const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    const model = getCurrentModel() || "";

    const accent = chalk.hex("#CC5500");
    const accentBold = chalk.bold.hex("#CC5500");

    const W = 40;
    const hLine = accent("\u2501".repeat(W));
    const innerW = W - 4;
    const left = `  ${accent("\u2503")}  `;
    const right = `  ${accent("\u2503")}`;
    const row = (l: string, v: string) => {
      const pad = innerW - l.length - v.length;
      return `${left}${chalk.dim(l)}${pad > 0 ? " ".repeat(pad) : " ".repeat(2)}${chalk.bold.white(v)}${right}`;
    };

    console.log();
    console.log(`  ${accent("\u250F")}${hLine}${accent("\u2513")}`);
    console.log(
      `${left}${accentBold("\u25C9  SESSION COMPLETE")}${" ".repeat(innerW - 19)}${right}`,
    );
    console.log(
      `  ${accent("\u2523")}${accent("\u2500".repeat(W))}${accent("\u252B")}`,
    );
    if (model) {
      const m =
        model.length > innerW - 7 ? model.slice(0, innerW - 10) + "..." : model;
      console.log(
        `${left}${chalk.dim("Model")}${" ".repeat(innerW - 5 - m.length)}${accent(m)}${right}`,
      );
    }
    console.log(row("Requests", stats.requests.toString()));
    console.log(row("Tokens", stats.tokens.toLocaleString()));
    console.log(row("Duration", timeStr));
    console.log(`  ${accent("\u2517")}${hLine}${accent("\u251B")}`);
    console.log();
  } catch {
    // Ignore error
  }

  if (claudeProcess && !claudeProcess.killed) {
    try {
      if (process.platform === "win32") {
        child_process.execSync(`taskkill /pid ${claudeProcess.pid} /T /F`, {
          stdio: "ignore",
        });
      } else {
        claudeProcess.kill("SIGKILL");
      }
    } catch {
      // Ignore
    }
  }

  // Restore terminal state
  try {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  } catch {
    // ignore — stdin may already be destroyed
  }

  process.exit(exitCode);
}

process.on("SIGINT", cleanupAndExit);
process.on("SIGTERM", cleanupAndExit);
process.on("exit", () => stopProxyServer());

// ============================================================================
// 7. Model Grouping
// ============================================================================

interface ModelGroup {
  family: string;
  models: NormalizedNvidiaModel[];
}

function groupModelsByFamily(models: NormalizedNvidiaModel[]): ModelGroup[] {
  const groups = new Map<string, NormalizedNvidiaModel[]>();
  for (const m of models) {
    const id = m.id.toLowerCase();
    let family = "Other";
    for (const [regex, name] of MODEL_FAMILY_RULES) {
      if (regex.test(id)) {
        family = name;
        break;
      }
    }
    if (family === "Other") {
      const provider = m.id.split("/")[0];
      if (provider)
        family = provider.charAt(0).toUpperCase() + provider.slice(1);
    }
    if (!groups.has(family)) groups.set(family, []);
    groups.get(family)!.push(m);
  }

  const sorted: ModelGroup[] = [];
  const seen = new Set<string>();
  for (const name of MODEL_FAMILY_ORDER) {
    if (groups.has(name)) {
      sorted.push({ family: name, models: groups.get(name)! });
      seen.add(name);
    }
  }
  for (const [name, list] of groups) {
    if (!seen.has(name)) {
      sorted.push({ family: name, models: list });
      seen.add(name);
    }
  }
  return sorted;
}

// ============================================================================
// 8. Interactive Sessions
// ============================================================================

async function runApiKeyMenu(): Promise<void> {
  const existing = getStoredApiKey();

  console.log("\n--- API Key Management ---");
  if (existing) {
    const masked = existing.slice(0, 4) + "****" + existing.slice(-4);
    console.log(` Current key: ${masked}`);
  } else {
    console.log(" No API key stored.");
  }

  const choice = await promptForInput(
    "\nEnter a new key to update, type 'clear' to remove, or press Enter to go back: ",
  );

  if (choice?.toLowerCase() === "clear") {
    clearApiKey();
    console.log(" API key cleared.");
  } else if (choice) {
    saveApiKey(choice);
    console.log(" API key saved.");
  }
}

async function runModelSelection(apiKey: string): Promise<string | null> {
  console.log("\n  Fetching available NIM models...");
  try {
    const rawModels = await fetchModels(apiKey);
    if (!rawModels || rawModels.length === 0) {
      throw new Error("No models returned");
    }
    const models = normalizeNvidiaModels(rawModels);
    const groups = groupModelsByFamily(models);

    if (groups.length === 0) {
      throw new Error("No model groups");
    }

    const selectedGroup = await renderListMenu(
      " Select a model family:",
      groups,
      (g) => `${g.family} (${g.models.length} models)`,
    );

    if (!selectedGroup) return null;

    const selectedModel = await renderListMenu(
      ` Select a model (${selectedGroup.family}):`,
      selectedGroup.models,
      (m) => `${m.displayName}`,
    );

    if (!selectedModel) return null;

    setCurrentModel(selectedModel.id);
    return selectedModel.id;
  } catch {
    console.log(
      chalk.hex("#CC5500")("  Could not fetch models. Using default model."),
    );
    return null;
  }
}

async function runStartFlow(
  apiKey: string,
  port: number,
  resolvedModel: string,
): Promise<void> {
  const accent = chalk.hex("#CC5500");
  const dashboardUrl = `http://127.0.0.1:${port}/dashboard`;
  console.log(`\n  ${accent.bold("Dashboard:")} ${chalk.dim(dashboardUrl)}`);
  console.log(`  ${accent.bold("Model:")} ${chalk.dim(resolvedModel)}`);
  console.log();
  console.log(accent.bold("  Launching Claude Code terminal...\n"));

  const envOptions = { ...process.env };
  delete envOptions.ANTHROPIC_AUTH_TOKEN;

  // Restore stdin to cooked mode before giving it to the child process
  try {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  } catch {
    // ignore
  }

  const cmd = process.platform === "win32" ? "claude.cmd" : "claude";

  const args: string[] = [];

  try {
    const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
    let cfg: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      cfg = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    }
    delete cfg.model;
    fs.writeFileSync(settingsPath, JSON.stringify(cfg, null, 2), "utf8");
  } catch {
    // ignore
  }

  claudeProcess = child_process.spawn(cmd, args, {
    stdio: "inherit",
    shell: false,
    env: {
      ...envOptions,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
      ANTHROPIC_API_KEY: apiKey,
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
    },
  });

  claudeProcess.on("error", (err) => {
    console.error(`\nFailed to launch Claude Code: ${err.message}`);
    console.error("Make sure '@anthropic-ai/claude-code' is installed:");
    console.error("  bun install -g @anthropic-ai/claude-code\n");
    cleanupAndExit(1);
  });

  claudeProcess.on("exit", (code) => {
    console.log(
      `\nClaude Code exited (code ${code}). Shutting down proxy server...`,
    );
    cleanupAndExit();
  });
}

// ============================================================================
// 9. Main
// ============================================================================
async function main() {
  const args = process.argv.slice(2);
  let cliPort = 3456;
  let model: string | undefined = undefined;
  let cliApiKey: string | undefined = undefined;
  let debug = false;
  let serveOnly = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" && args[i + 1]) {
      cliPort = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === "--model" && args[i + 1]) {
      model = args[i + 1];
      i++;
    } else if (arg === "--api-key" && args[i + 1]) {
      cliApiKey = args[i + 1];
      i++;
    } else if (arg === "--debug") {
      debug = true;
    } else if (arg === "--serve-only") {
      serveOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
      );
      console.log(`
Claude-NIM Proxy CLI v${pkg.version}
Usage: claude-nim [options]

Options:
  --port <number>     Preferred port (default: 3456, falls back to dynamic)
  --model <string>    Default model ID to use
  --api-key <string>  Your NVIDIA NIM API key
  --serve-only        Start proxy server only (no interactive menu or Claude Code)
  --debug             Enable debug logging
  --version, -v       Show version
  --help              Show this help message
`);
      process.exit(0);
    } else if (arg === "--version" || arg === "-v") {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
      );
      console.log(pkg.version);
      process.exit(0);
    }
  }

  const accent = chalk.hex("#CC5500");

  if (debug) {
    process.env.NVIDIA_NIM_DEBUG = "1";
  }

  // Enable raw mode once for the entire CLI lifetime — never toggle it.
  // This avoids fragile Windows console API calls mid-session.
  try {
    process.stdin.setRawMode(true);
    process.stdin.resume();
  } catch {
    // ignore — not a TTY
  }

  // Serve-only: start proxy server without launching Claude Code
  if (serveOnly) {
    const apiKey = await getOrPromptApiKey(cliApiKey);
    const port = await findAvailablePort(cliPort);
    const resolvedModel =
      model || getCurrentModel() || "meta/llama-3.3-70b-instruct";
    try {
      await startProxyServer(port, apiKey, resolvedModel);
      console.log(
        `\n  ${accent.bold("Proxy server started on port")} ${chalk.dim(port.toString())}\n`,
      );
    } catch (err) {
      console.error("Failed to start proxy server:", err);
      process.exit(1);
    }
    // Wait for signal to stop
    await new Promise<void>((resolve) => {
      const onSignal = () => {
        cleanupAndExit();
        resolve();
      };
      process.on("SIGINT", onSignal);
      process.on("SIGTERM", onSignal);
    });
    return;
  }

  // Non-interactive: --model provided, skip menus
  if (model) {
    await ensureClaudeInstalled();
    const apiKey = await getOrPromptApiKey(cliApiKey);
    const port = await findAvailablePort(cliPort);
    console.log(`\n  Proxy binding to port ${port} with model: ${model}\n`);
    try {
      await startProxyServer(port, apiKey, model);
    } catch (err) {
      console.error("Failed to start proxy server:", err);
      process.exit(1);
    }
    await runStartFlow(apiKey, port, model);
    return;
  }

  // Interactive menu loop

  while (true) {
    const choice = await renderMainMenu();

    if (!choice || choice === "Exit") {
      console.log(`\n${chalk.dim("Goodbye!")}`);
      cleanupAndExit();
      return;
    }

    if (choice === "Start") {
      await ensureClaudeInstalled();
      const apiKey = await getOrPromptApiKey(cliApiKey);

      let resolvedModel = getCurrentModel();
      if (!resolvedModel) {
        setCurrentModel("minimaxai/minimax-m3");
        resolvedModel = "minimaxai/minimax-m3";
        console.log(
          `\n  ${accent.bold("Default model:")} ${chalk.dim("minimaxai/minimax-m3")}\n`,
        );
      } else {
        console.log(
          `\n  ${accent.bold("Model:")} ${chalk.dim(resolvedModel)}\n`,
        );
      }

      const port = await findAvailablePort(cliPort);
      try {
        await startProxyServer(port, apiKey, resolvedModel);
      } catch (err) {
        console.error("Failed to start proxy server:", err);
        process.exit(1);
      }

      void registerInstallation(apiKey);

      await runStartFlow(apiKey, port, resolvedModel);
      return;
    }

    if (choice === "Model") {
      clearScreen();
      const apiKey = await getOrPromptApiKey(cliApiKey);
      const selected = await runModelSelection(apiKey);
      if (selected) {
        console.log(
          `\n  ${accent.bold("Default model set:")} ${chalk.dim(selected)}\n`,
        );
      } else {
        console.log(
          `\n  ${chalk.dim("Model selection cancelled. Current default preserved.")}\n`,
        );
      }
      continue;
    }

    if (choice === "API") {
      clearScreen();
      await runApiKeyMenu();
      console.log();
      continue;
    }

    if (choice === "Send a message") {
      clearScreen();
      const apiKey = await getOrPromptApiKey(cliApiKey);

      // ── heading ──
      const sep = accent("\u2501".repeat(44));
      console.log(`\n  ${sep}`);
      console.log(
        `  ${accent("\u2503")}  ${accent.bold("Claude-NIM")}  ${chalk.dim("Send a message")}`,
      );
      console.log(
        `  ${accent("\u2517")}${accent("\u2500".repeat(44))}${accent("\u251B")}`,
      );
      console.log();

      // ── updates ──
      const pkg = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
      );
      void registerInstallation(apiKey);
      const updateMsg = await checkForUpdates(pkg.version);
      if (updateMsg) console.log(updateMsg);

      // ── creator info ──
      console.log();
      console.log(`  ${accent.bold("Creator")}`);
      console.log(`    ${chalk.dim("GitHub:")} https://github.com/k-rithik04`);
      console.log();
      console.log(`  ${chalk.dim("Send anonymous message to the creator.")}`);
      console.log();

      // ── message input ──
      const message = await promptForInput(
        `  ${accent.bold("Your message")} ${chalk.dim("(or press Enter to skip)")}: `,
      );

      if (message) {
        const sent = await sendCreatorMessage(message, apiKey);
        if (sent) {
          console.log(
            `  ${chalk.green("\u2713")} ${chalk.dim("Message sent anonymously.")}`,
          );
        } else {
          console.log(
            `  ${chalk.dim("Could not send message (offline mode).")}`,
          );
        }
      } else {
        console.log(`  ${chalk.dim("No message sent.")}`);
      }

      await promptEnterToContinue(
        `\n  ${chalk.dim("Press Enter to return, ESC to go back...")}`,
      );
      continue;
    }
  }
}

main().catch((err) => {
  console.error("Fatal Error:", err);
  cleanupAndExit(1);
});
