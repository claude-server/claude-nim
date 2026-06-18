#!/usr/bin/env node
// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import Module from "node:module";

// ============================================================================
// 1. VS Code Module Mock
// ============================================================================
// We mock the 'vscode' module so that src/server.ts can run cleanly outside the extension host.
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
import * as readline from "node:readline";
import { Writable } from "node:stream";
import { startProxyServer, stopProxyServer } from "./server";
import { fetchModels } from "./api";
import { normalizeNvidiaModels } from "./model-catalog";
import { buildCustomModelOptions } from "./model-switch";

// ============================================================================
// 2. Encryption & Key Storage
// ============================================================================
const KEY_FILE = path.join(os.homedir(), ".claude-nim-key");
const ALGORITHM = "aes-256-gcm";

// Derive a machine-specific key so the stored file isn't plaintext.
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
    return null; // Decryption failed (e.g. moved to a different machine)
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

// ============================================================================
// 3. Interactive Prompts
// ============================================================================
function promptForInput(
  question: string,
  hidden: boolean = false,
): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // We disable the 'hidden' requirement for now to ensure it works reliably across all Windows terminals.
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function getOrPromptApiKey(cliArgKey?: string): Promise<string> {
  if (cliArgKey) return cliArgKey;
  if (process.env.NVIDIA_NIM_API_KEY) return process.env.NVIDIA_NIM_API_KEY;

  const storedKey = getStoredApiKey();
  if (storedKey) return storedKey;

  console.log("No NVIDIA NIM API key found.");
  console.log("Get your key securely from: https://build.nvidia.com/");
  const answer = await promptForInput("Enter your NVIDIA NIM API key: ", false);

  if (!answer) {
    console.error("❌ API key is required to start.");
    process.exit(1);
  }

  saveApiKey(answer);
  console.log("✅ API key securely encrypted and stored locally.\n");
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
    "Would you like to install it now via npm? (y/N): ",
  );
  if (answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
    console.log("Installing @anthropic-ai/claude-code globally...");
    try {
      child_process.execSync("npm install -g @anthropic-ai/claude-code", {
        stdio: "inherit",
      });
      console.log("✅ Claude Code installed successfully.\n");
    } catch {
      console.error(
        "❌ Failed to install Claude Code. Please install it manually:",
      );
      console.error("npm install -g @anthropic-ai/claude-code");
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
      // If the port is in use, use 0 to get an ephemeral port dynamically assigned by OS
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

function cleanupAndExit() {
  if (isCleaningUp) return;
  isCleaningUp = true;

  stopProxyServer();

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
  process.exit(0);
}

process.on("SIGINT", cleanupAndExit);
process.on("SIGTERM", cleanupAndExit);
process.on("exit", () => stopProxyServer());

// ============================================================================
// Main Execution
// ============================================================================
async function main() {
  const args = process.argv.slice(2);
  let cliPort = 3456;
  let model: string | undefined = undefined;
  let cliApiKey: string | undefined = undefined;
  let debug = false;

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
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Claude-NIM Proxy CLI
Usage: claude-nim [options]

Options:
  --port <number>     Preferred port (default: 3456, falls back to dynamic)
  --model <string>    Default model ID to use
  --api-key <string>  Your NVIDIA NIM API key
  --debug             Enable debug logging
  --help              Show this help message

Description:
  This launcher will interactively guide you to set up your API key securely,
  start the proxy server on an available port, and spawn the interactive 
  Claude Code terminal. When you exit Claude, the proxy shuts down cleanly.
`);
      process.exit(0);
    }
  }

  console.log("Welcome to Claude-NIM Proxy Launcher!");

  // 1. Check for Claude
  await ensureClaudeInstalled();

  // 2. Resolve API Key
  const apiKey = await getOrPromptApiKey(cliApiKey);

  if (debug) {
    process.env.NVIDIA_NIM_DEBUG = "1";
  }

  // 3. Find Port
  const port = await findAvailablePort(cliPort);
  console.log(`🚀 Starting proxy server on local port ${port}...`);

  // 4. Start Server — default to a known working NIM model
  const resolvedModel = model || "deepseek-ai/deepseek-r1";
  if (!model) {
    console.log(`  No model specified, defaulting to ${resolvedModel}`);
    console.log(`  Use --model <name> to choose a different model\n`);
  }
  try {
    startProxyServer(port, apiKey, resolvedModel);
  } catch (err) {
    console.error("❌ Failed to start proxy server:", err);
    process.exit(1);
  }

  // 5. Spawn Claude Code
  console.log("✨ Launching Claude Code terminal...\n");

  const envOptions = { ...process.env };
  // Prevent Claude Code warning about multiple auth methods
  delete envOptions.ANTHROPIC_AUTH_TOKEN;

  // Fetch NIM models for ANTHROPIC_CUSTOM_MODEL_OPTION
  let customModelOption = "[]";
  try {
    const rawModels = await fetchModels(apiKey);
    if (rawModels) {
      const models = normalizeNvidiaModels(rawModels);
      customModelOption = buildCustomModelOptions(models);
      console.log(`  Found ${models.length} NIM models for Claude Code picker.`);
    }
  } catch {
    console.log("  Could not fetch NIM models. Custom model picker unavailable.");
  }

  const cmd = process.platform === "win32" ? "claude.cmd" : "claude";

  claudeProcess = child_process.spawn(cmd, [], {
    stdio: "inherit",
    shell: true,
    env: {
      ...envOptions,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
      ANTHROPIC_API_KEY: apiKey,
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
      ANTHROPIC_CUSTOM_MODEL_OPTION: customModelOption,
    },
  });

  claudeProcess.on("exit", (code) => {
    console.log(
      `\n👋 Claude Code exited (code ${code}). Shutting down proxy server...`,
    );
    cleanupAndExit();
  });
}

main().catch((err) => {
  console.error("Fatal Error:", err);
  cleanupAndExit();
});
