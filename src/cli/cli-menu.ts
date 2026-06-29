#!/usr/bin/env node
// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details

import chalk from "chalk";
import { stdin, stdout } from "node:process";

// ─── ANSI escape sequences ────────────────────────────────────────────────────

const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const CLEAR_SCREEN = "\x1b[2J\x1b[H";

export function clearScreen(): void {
  stdout.write(CLEAR_SCREEN);
}

// ─── Key types ────────────────────────────────────────────────────────────────

/** Every key the navigation loop cares about. */
type NavKey = "up" | "down" | "enter" | "esc" | "ctrlc";

// ─── Stdin flow management (NOT raw mode — raw mode is set once in main()) ─────
// Ref-counts pause/resume so nested calls (menu → prompt) work correctly.

interface RawState {
  depth: number;
  wasPaused: boolean;
}

const rawState: RawState = { depth: 0, wasPaused: false };

/**
 * Ensures stdin is flowing.  Raw mode is managed by the entrypoint — this
 * only resumes stdin if it was paused, so `data` listeners always fire.
 */
export function rawOn(): void {
  if (rawState.depth === 0) {
    rawState.wasPaused =
      !stdin.readable || ((stdin as NodeJS.ReadStream).isPaused?.() ?? false);
    if (rawState.wasPaused) stdin.resume();
  }
  rawState.depth++;
}

/**
 * Undoes a previous `rawOn()`.  Only pauses stdin when every caller has
 * balanced their `rawOn` (depth reaches 0) AND stdin was paused originally.
 */
export function rawOff(): void {
  if (rawState.depth <= 0) return;
  rawState.depth--;
  if (rawState.depth === 0 && rawState.wasPaused) {
    stdin.pause();
  }
}

// ─── Key reader ───────────────────────────────────────────────────────────────
// Reads exactly one logical keypress from stdin (already in raw mode).
// Returns a discriminated NavKey so callers never see raw escape bytes.

function readKey(signal?: AbortSignal): Promise<NavKey> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    let buf = "";
    let escTimer: ReturnType<typeof setTimeout> | null = null;

    function settle(key: NavKey): void {
      cleanup();
      resolve(key);
    }

    function cleanup(): void {
      if (escTimer !== null) {
        clearTimeout(escTimer);
        escTimer = null;
      }
      stdin.removeListener("data", onData);
      signal?.removeEventListener("abort", onAbort);
    }

    function onAbort(): void {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    }

    function onData(chunk: Buffer): void {
      buf += chunk.toString("binary"); // binary to avoid multi-byte confusion

      // Ctrl+C
      if (buf === "\x03") {
        settle("ctrlc");
        return;
      }

      // Enter / Return
      if (buf === "\r" || buf === "\n") {
        settle("enter");
        return;
      }

      // Arrow keys (VT100: ESC [ A / B)
      if (buf === "\x1b[A") {
        settle("up");
        return;
      }
      if (buf === "\x1b[B") {
        settle("down");
        return;
      }

      // Plain ESC — wait 50 ms to distinguish from the start of a sequence
      if (buf === "\x1b") {
        if (escTimer !== null) clearTimeout(escTimer);
        escTimer = setTimeout(() => {
          settle("esc");
        }, 50);
        return;
      }

      // Partial escape sequence (e.g. \x1b[) — keep accumulating briefly
      if (buf.startsWith("\x1b") && buf.length < 6) {
        if (escTimer !== null) clearTimeout(escTimer);
        escTimer = setTimeout(() => {
          settle("esc");
        }, 50);
        return;
      }

      // Unknown / complete escape sequence we don't handle → treat as ESC
      if (buf.startsWith("\x1b")) {
        settle("esc");
        return;
      }

      // Any other printable character — ignored by navigation but clears buf
      buf = "";
    }

    signal?.addEventListener("abort", onAbort, { once: true });
    stdin.on("data", onData);
  });
}

// ─── Theme ────────────────────────────────────────────────────────────────────

const ACCENT_HEX = "#CC5500";
const accent = chalk.hex(ACCENT_HEX);
const accentBold = chalk.hex(ACCENT_HEX).bold;

const BANNER_LINES = [
  ` ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗    ███╗   ██╗██╗███╗   ███╗`,
  `██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝    ████╗  ██║██║████╗ ████║`,
  `██║     ██║     ███████║██║   ██║██║  ██║█████╗█████╗██╔██╗ ██║██║██╔████╔██║`,
  `██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝╚════╝██║╚██╗██║██║██║╚██╔╝██║`,
  `╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗    ██║ ╚████║██║██║ ╚═╝ ██║`,
  ` ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝    ╚═╝  ╚═══╝╚═╝╚═╝     ╚═╝`,
];

const HELP_LINE = chalk.dim(
  "  (↑/↓ navigate, Enter select, ESC back, Ctrl+C exit)\n",
);

// ─── Main menu ────────────────────────────────────────────────────────────────

export type MainMenuValue = "Start" | "Model" | "API" | "Send a message" | "Exit";

interface MainMenuItem {
  label: string;
  value: MainMenuValue;
}

const MAIN_ITEMS: MainMenuItem[] = [
  { label: "1. Start", value: "Start" },
  { label: "2. Model", value: "Model" },
  { label: "3. API", value: "API" },
  { label: "4. Send a message", value: "Send a message" },
  { label: "5. Exit", value: "Exit" },
];

function drawMainMenu(sel: number): void {
  stdout.write(CLEAR_SCREEN);
  stdout.write("\n\n");

  // Banner: first 5 rows accented, 6th dimmed
  for (let i = 0; i < BANNER_LINES.length - 1; i++) {
    stdout.write(accent(BANNER_LINES[i]) + "\n");
  }
  stdout.write(chalk.dim(BANNER_LINES[5]) + "\n");
  stdout.write(
    chalk.dim("                          ── NVIDIA NIM Proxy ──") + "\n\n",
  );

  for (let i = 0; i < MAIN_ITEMS.length; i++) {
    const { label } = MAIN_ITEMS[i];
    stdout.write(
      i === sel
        ? `    ${accent("▶")} ${accentBold(label)}\n`
        : `      ${chalk.dim(label)}\n`,
    );
  }

  stdout.write(HELP_LINE);
}

/**
 * Renders the main menu and returns the selected value, or `null` when the
 * user presses ESC.
 */
export async function renderMainMenu(): Promise<MainMenuValue | null> {
  let sel = 0;
  const ac = new AbortController();

  rawOn();
  stdout.write(CURSOR_HIDE);
  drawMainMenu(sel);

  try {
    while (true) {
      const key = await readKey(ac.signal);

      switch (key) {
        case "up":
          if (sel > 0) {
            sel--;
            drawMainMenu(sel);
          }
          break;
        case "down":
          if (sel < MAIN_ITEMS.length - 1) {
            sel++;
            drawMainMenu(sel);
          }
          break;
        case "enter":
          return MAIN_ITEMS[sel].value;
        case "esc":
          return null;
        case "ctrlc":
          stdout.write("\n");
          return "Exit";
      }
    }
  } finally {
    // Always restore cursor and raw mode, even on thrown errors
    stdout.write(CURSOR_SHOW);
    rawOff();
  }
}

// ─── Generic list menu ────────────────────────────────────────────────────────

const MAX_VISIBLE = 12;

function drawListMenu<T>(
  title: string,
  items: T[],
  render: (item: T) => string,
  sel: number,
  scrollOffset: number,
): void {
  stdout.write(CLEAR_SCREEN);
  stdout.write(accentBold("  " + title) + "\n\n");

  const end = Math.min(scrollOffset + MAX_VISIBLE, items.length);

  for (let i = scrollOffset; i < end; i++) {
    stdout.write(
      i === sel
        ? `    ${accent("▶")} ${chalk.bold(render(items[i]))}\n`
        : `      ${chalk.dim(render(items[i]))}\n`,
    );
  }

  // Scroll indicators
  const hasUp = scrollOffset > 0;
  const hasDown = end < items.length;
  if (hasUp || hasDown) {
    const parts: string[] = [];
    if (hasUp) parts.push("↑ more");
    if (hasDown) parts.push("↓ more");
    stdout.write(
      `      ${chalk.dim(parts.join("  ·  "))}  ${chalk.dim(`(${items.length} total)`)}\n`,
    );
  }

  stdout.write(HELP_LINE);
}

/**
 * Renders a scrollable list menu and returns the selected item, or `null`
 * when the user presses ESC.  Never calls `process.exit` — Ctrl+C re-throws
 * so the caller can decide how to handle it.
 */
export async function renderListMenu<T>(
  title: string,
  items: T[],
  render: (item: T) => string,
): Promise<T | null> {
  if (items.length === 0) return null;

  let sel = 0;
  let scrollOffset = 0;
  const ac = new AbortController();

  rawOn();
  stdout.write(CURSOR_HIDE);
  drawListMenu(title, items, render, sel, scrollOffset);

  try {
    while (true) {
      const key = await readKey(ac.signal);

      switch (key) {
        case "up":
          if (sel > 0) {
            sel--;
            if (sel < scrollOffset) scrollOffset = sel;
            drawListMenu(title, items, render, sel, scrollOffset);
          }
          break;

        case "down":
          if (sel < items.length - 1) {
            sel++;
            if (sel >= scrollOffset + MAX_VISIBLE) {
              scrollOffset = sel - MAX_VISIBLE + 1;
            }
            drawListMenu(title, items, render, sel, scrollOffset);
          }
          break;

        case "enter":
          return items[sel];

        case "esc":
          return null;

        case "ctrlc":
          stdout.write("\n");
          // Propagate so the top-level entrypoint can call process.exit cleanly
          throw new Error("SIGINT");
      }
    }
  } finally {
    stdout.write(CURSOR_SHOW);
    rawOff();
  }
}
