<!--
  Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
  Licensed under the MIT License - see LICENSE for details
-->

# Changelog

All notable changes to the Claude-NIM Proxy extension will be documented in this file.

## [1.0.20] - 2026-06-29

### Fixed
- ReadableStream `cancel()` no longer crashes with `TypeError: undefined is not an object` when the stream is cancelled without a reason argument — now uses closure variable directly instead of accessing `reason.__heartbeat`
- Removed unused `ControllerWithHeartbeat` type from dashboard

### Changed
- Added `.prettierrc` with explicit `printWidth: 80` config for deterministic CI formatting

## [1.0.19] - 2026-06-29

### Added
- Professional terminal UI (`src/cli/cli-menu.ts`): colorful main menu, list menu with ESC navigation, ASCII art banner
- Raw-mode `promptForInput()` (replaces `readline`): ESC returns `null`, Enter submits, Backspace works, Ctrl+C exits
- `clearScreen()` and `promptEnterToContinue()` for clean terminal transitions
- Streaming token fallback: when `completionTokens === 0`, estimates via `Math.round(text.length / 4)`
- `recordMetric()` in dashboard: pushes request metrics to ring buffer and appends to `metrics.jsonl` for persistence
- `stopBlock()` dedup helper prevents duplicate `content_block_stop` emissions in streaming

### Changed
- CLI now uses chalk ASCII art header (`#CC5500` dark orange + dim gray theme) throughout
- All menu renders clear screen fully (`\x1b[2J\x1b[H`) instead of save/restore cursor
- Auth headers computed per-request instead of frozen at server start — dashboard API key changes take effect immediately
- `streamAbortController` created before NIM fetch, signal passed to both NIM fetch and retry via `AbortSignal.any()`
- `handleCountTokens` now estimates from actual request body (`JSON.stringify(messages).length / 4`) instead of hardcoded `1000`
- `repairToolArguments()` signature simplified: removed unused `_toolName` and `_requestContext` params
- `stripReasoningBudget()` returns `true` for nested `chat_template_kwargs` removal
- `safeJsonParse()` accepts any valid JSON (not just objects), returns parsed value directly
- Pre-compiled regexes in `getRetryBody()` moved to module-level constants for performance
- Disk cache proxy path uses `push` (not `unshift`), consistent with NIM API path order
- `proxy-state.reset()` aborts all active streams and clears the Set
- `created: 0` in models-handler replaced with `Math.floor(Date.now() / 1000)`
- Rate limiter stallers check if window already expired before resetting; added `sleepOrAbort()` helper
- Gateway model IDs decode with trimmed trailing slashes, provider validated as `nvidia_nim`
- `setNimModel("")` now throws `Error("Model name cannot be empty")`
- Ctrl+C exits consistently from both main menu and sub-menus via `process.exit(0)`
- `cleanupAndExit()` accepts optional `exitCode` parameter, fatal errors pass `1`

### Fixed
- Double `content_block_stop` for text-embedded tool calls (both finish and post-stream paths)
- Hardcoded `0` output tokens in post-stream `message_delta` now uses `completionTokens`
- `"length"` finish_reason maps to `"max_tokens"` in both streaming and non-streaming paths
- Missing `content_block_stop` between thinking and text blocks when both appear in same SSE event
- `readKey` no longer hangs on unknown escape sequences (Delete, Home, F-keys) — 50ms timeout resolves as ESC
- Falsy token check (`if (chunkUsage?.prompt_tokens)`) → `!== undefined` so legitimate `0` values are captured
- Auth header staleness removed — `authHeaders(config.apiKey)` called on each request
- `handleCountTokens` now parses request body instead of returning hardcoded `1000`
- `reader.releaseLock()` on timeout wrapped in try/catch to prevent error masking
- AbortSignal listener leak fixed with `{ once: true }` and early check for already-aborted signal
- `registerInstallation()` always passes resolved `apiKey` instead of potentially `undefined` `cliApiKey`
- Reasoning stripper `<think>` heuristic: only strips blocks with `< 200` non-whitespace chars emitted (avoids stripping mid-content tags)
- Dead `enumValues` removed from `ToolSchema` interface
- Dead `sessionId` removed from `WebSearchConfig`; `source` type relaxed to `string`
- Model catalog overrides now take priority over API values for `contextWindow`/`maxOutputTokens`
- Model adapter system fully removed (no `src/adapters/` directory) — model handling now via `model-router.ts` + `gateway-model-ids.ts`
- AGENTS.md paths corrected (`src/dashboard/dashboard-assets.ts`, `src/extension/index.ts`, etc.)
- `ExtensionContext` mock in tests is now a proper class with all required properties
- `jest.config.js` added `testTimeout: 30000`, `restoreMocks: true`
- Bun mock: synchronous server creation (no race), `Bun.write` returns byte count, no `Function` cast on fetch
- ESLint config uses `tsPlugin.config()` syntax compatible with ESLint v10 + typescript-eslint v8

## [1.0.18] - 2026-06-29

### Added
- Creator module for update distribution and anonymous usage tracking
- Hybrid activation for faster startup (lightweight status bar, lazy full init)
- Keyboard shortcuts: `Ctrl+Shift+N` (toggle proxy), `Ctrl+Shift+Alt+N` (launch Claude Code)
- Command Palette menu integration for all commands
- Extension host E2E test framework (`@vscode/test-electron`)
- Bundle size reporting in build output

### Changed
- Activation strategy: commands trigger lazy initialization instead of full startup on load
- esbuild drops console.log in extension bundle for smaller size
- Build script supports `--watch` mode for development
- Rate limiter enforces 2-second minimum gap between requests (40 req/min ceiling)

### Fixed
- CORS headers on OPTIONS response
- Gateway-encoded model IDs in `/v1/models` and `/api/model` endpoints
- Text-embedded tool call detection for DeepSeek and OpenAI token formats

## [1.0.17] - 2026-06-25

### Added
- Tool argument validation and repair via `tool-validator.ts`
- Heuristic tool parser integration for text-embedded tool calls
- Anthropic type definitions replacing inline types

### Changed
- Translator module now imports and uses `tool-parser.ts`, `tool-validator.ts`, `anthropic-types.ts`
- Removed unused exports: `outputLog`, `errorLog`, `warnLog`, `showBanner`, `showIntro`, `recordMetric`

### Fixed
- Removed VS Code-specific tool name hardcoding from tool validator

## [1.0.16] - 2026-06-20

### Added
- 12 model-family adapters (DeepSeek, Kimi, GLM, Llama, Mistral, Qwen, Phi, Yi, Gemma, Nemotron, Claude, GPT)
- Embedded tool call parsing (OpenAI, DeepSeek, DSML formats)
- Stream idle timeout with dynamic scaling
- Graceful shutdown with AbortController tracking

## [1.0.0] - 2025-01-01

### Added
- Initial release of Claude-NIM Proxy
- Anthropic Messages API to OpenAI-compatible translation layer
- Streaming and non-streaming request support
- VS Code status bar proxy indicator
- "Launch Claude Code with Proxy" command
- "Select Default Model" command with QuickPick UI
- "Toggle Show Reasoning" for chain-of-thought visibility
- Standalone CLI mode
- Exponential backoff retry with jitter and Retry-After support
- NVIDIA NIM model catalog with normalization
- Encrypted API key storage (AES-256-GCM)
