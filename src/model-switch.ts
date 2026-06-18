// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ============================================================================
// State persistence (~/.claude-nim/state.json)
// ============================================================================

const DATA_DIR = path.join(os.homedir(), ".claude-nim");
const STATE_FILE = path.join(DATA_DIR, "state.json");

interface PersistedState {
  defaultModel: string;
  lastUpdated: number;
}

let currentModel = "";

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadState(): void {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const state = JSON.parse(
        fs.readFileSync(STATE_FILE, "utf8"),
      ) as PersistedState;
      currentModel = state.defaultModel || "";
    }
  } catch {
    /* ignore corrupt state */
  }
}

function saveState(): void {
  ensureDir();
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        defaultModel: currentModel,
        lastUpdated: Date.now(),
      },
      null,
      2,
    ),
  );
}

export function initModelState(): void {
  loadState();
}

export function getCurrentModel(): string {
  return currentModel;
}

export function setCurrentModel(model: string): void {
  currentModel = model;
  saveState();
}

export function resetCurrentModel(): void {
  currentModel = "";
  saveState();
}

// ============================================================================
// User text extraction from Anthropic message format
// ============================================================================

export function extractUserText(message: unknown): string {
  const msg = message as {
    role?: string;
    content?: string | Array<{ type?: string; text?: string }>;
  };
  if (!msg) return "";
  const content = msg.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join(" ");
  }
  return "";
}

// ============================================================================
// Command parsing
// ============================================================================

export interface ModelCommand {
  cmd: "switch" | "list" | "current";
  model?: string;
}

export function parseModelCommand(text: string): ModelCommand | null {
  const trimmed = text.trim();

  // /model (show current)
  if (/^\/models?$/i.test(trimmed)) {
    return { cmd: "current" };
  }

  // /model list  or  /models list
  if (/^\/models?\s+list$/i.test(trimmed)) {
    return { cmd: "list" };
  }

  // /model <name>  or  /model <index>
  const switchMatch = trimmed.match(/^\/model\s+(.+)/i);
  if (switchMatch) {
    return { cmd: "switch", model: switchMatch[1].trim() };
  }

  return null;
}

// ============================================================================
// Build ANTHROPIC_CUSTOM_MODEL_OPTION env var value
// ============================================================================

interface ModelOption {
  value: string;
  label: string;
  description: string;
}

export function buildCustomModelOptions(
  models: Array<{ id: string; displayName: string }>,
): string {
  // Limit to 30 most popular models to avoid overwhelming Claude Code's picker
  const limited = models.slice(0, 30);
  const options: ModelOption[] = limited.map((m) => ({
    value: m.id,
    label: m.displayName,
    description: "NIM",
  }));
  return JSON.stringify(options);
}
