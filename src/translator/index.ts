// ── Anthropic Messages API ↔ OpenAI Chat Completions ──────────────────────
//
// Features:
//   1. Multi tool_result blocks — iterate all, not just firstBlock
//   2. JSON.parse on tool arguments — wrapped in try/catch
//   3. tool_choice: "auto" injected whenever tools are present
//   4. NIM extra_body params (temperature, top_p, etc.)
//   5. Tool schema sanitization (remove boolean subschemas, alias reserved names)
//   6. Thinking block support in streaming
//   7. Text-embedded tool call detection (DeepSeek, OpenAI token formats)
//   8. Tool argument validation and repair

import type { NimSettings } from "../server/nim-settings";
import { nimExtraBody } from "../server/nim-settings";
import { parseTextEmbeddedToolCalls } from "./tool-parser";
import {
  hasRequiredToolArguments,
  repairToolArguments,
  buildInvalidToolCallRetryMessage,
} from "./tool-validator";
import type { ToolSchema, SkippedToolCall } from "./tool-validator";
import type {
  AnthropicContent,
  AnthropicTool,
  AnthropicResponse,
} from "./anthropic-types";

const TE = new TextEncoder();

// ── Tool schema cache ──────────────────────────────────────────────────────
interface SchemaCacheEntry {
  cleaned: Record<string, unknown>;
  raw: string;
}
const sanitizedSchemaCache = new Map<string, SchemaCacheEntry>();
const SCHEMA_CACHE_MAX = 64;

export function clearToolSchemaCache(): void {
  sanitizedSchemaCache.clear();
}

// ── Helpers ────────────────────────────────────────────────────────────────

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b: { type?: string; text?: string; content?: unknown }) => {
        if (b.type === "text" && b.text) return b.text;
        if (b.type === "image") return "[Image]";
        if (b.content) return extractText(b.content);
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return String(content ?? "");
}

// ── Schema sanitization helpers ────────────────────────────────────────────

const SCHEMA_VALUE_KEYS = new Set([
  "additionalProperties",
  "additionalItems",
  "unevaluatedProperties",
  "unevaluatedItems",
  "items",
  "contains",
  "propertyNames",
  "if",
  "then",
  "else",
  "not",
]);
const SCHEMA_LIST_KEYS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const SCHEMA_MAP_KEYS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
]);

function hasBooleanSchema(value: unknown): boolean {
  if (typeof value === "boolean") return true;
  if (value && typeof value === "object") {
    if (Array.isArray(value)) return value.some(hasBooleanSchema);
    for (const v of Object.values(value as Record<string, unknown>)) {
      if (hasBooleanSchema(v)) return true;
    }
  }
  return false;
}

function sanitizeSchemaNode(value: unknown): [boolean, unknown] {
  if (typeof value === "boolean") return [false, null];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (SCHEMA_VALUE_KEYS.has(key)) {
        const [keep, s] = sanitizeSchemaNode(item);
        if (keep) sanitized[key] = s;
      } else if (SCHEMA_LIST_KEYS.has(key) && Array.isArray(item)) {
        const items: unknown[] = [];
        for (const si of item) {
          const [keep, s] = sanitizeSchemaNode(si);
          if (keep) items.push(s);
        }
        if (items.length > 0) sanitized[key] = items;
      } else if (
        SCHEMA_MAP_KEYS.has(key) &&
        item &&
        typeof item === "object" &&
        !Array.isArray(item)
      ) {
        const map: Record<string, unknown> = {};
        for (const [mk, mv] of Object.entries(
          item as Record<string, unknown>,
        )) {
          const [keep, s] = sanitizeSchemaNode(mv);
          if (keep) map[mk] = s;
        }
        sanitized[key] = map;
      } else {
        sanitized[key] = item;
      }
    }
    return [true, sanitized];
  }
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value) {
      const [keep, s] = sanitizeSchemaNode(item);
      if (keep) items.push(s);
    }
    return [true, items];
  }
  return [true, value];
}

// ── Tool argument validation ───────────────────────────────────────────────

function buildToolSchemasFromRequest(
  body: Record<string, unknown>,
): Map<string, ToolSchema> {
  const schemas = new Map<string, ToolSchema>();
  const tools = body.tools as AnthropicTool[] | undefined;
  if (!Array.isArray(tools)) return schemas;

  for (const tool of tools) {
    if (!tool?.name || !tool.input_schema) continue;
    const required = tool.input_schema.required;
    if (Array.isArray(required)) {
      schemas.set(tool.name, { required });
    }
  }
  return schemas;
}

function validateAndRepairToolCalls(
  toolCalls: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>,
  toolSchemas: Map<string, ToolSchema>,
): { valid: typeof toolCalls; skipped: SkippedToolCall[] } {
  const valid: typeof toolCalls = [];
  const skipped: SkippedToolCall[] = [];

  for (const tc of toolCalls) {
    const schema = toolSchemas.get(tc.name);
    const repaired = repairToolArguments(tc.input, schema) as Record<
      string,
      unknown
    >;
    if (hasRequiredToolArguments(repaired, schema)) {
      valid.push({ ...tc, input: repaired });
    } else {
      skipped.push({
        name: tc.name,
        required: schema?.required ?? [],
      });
    }
  }

  return { valid, skipped };
}

// ── Request conversion ─────────────────────────────────────────────────────

export function toOpenAIRequest(
  body: Record<string, unknown>,
  nimModel: string,
  nimSettings?: Partial<NimSettings>,
): Record<string, unknown> {
  const messages: unknown[] = [];

  // System prompt
  if (body.system) {
    const text =
      typeof body.system === "string"
        ? body.system
        : Array.isArray(body.system)
          ? (body.system as Array<{ text?: string }>)
              .map((b) => b.text ?? "")
              .join("\n")
          : String(body.system);
    messages.push({ role: "system", content: text });
  }

  // Conversation turns
  for (const msg of (body.messages as Array<{
    role: string;
    content: unknown;
  }>) ?? []) {
    if (msg.role === "user") {
      const blocks = Array.isArray(msg.content)
        ? (msg.content as Array<{
            type: string;
            tool_use_id?: string;
            content?: unknown;
          }>)
        : null;
      const toolResults = blocks?.filter((b) => b.type === "tool_result") ?? [];

      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          messages.push({
            role: "tool",
            tool_call_id: tr.tool_use_id ?? "",
            content: extractText(tr.content),
          });
        }
      } else {
        messages.push({ role: "user", content: extractText(msg.content) });
      }
    } else if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        messages.push({ role: "assistant", content: msg.content });
      } else {
        let text = "";
        const toolCalls: unknown[] = [];

        for (const block of (msg.content as Array<{
          type: string;
          text?: string;
          id?: string;
          name?: string;
          input?: unknown;
        }>) ?? []) {
          if (block.type === "text") text += block.text ?? "";
          else if (block.type === "tool_use") {
            toolCalls.push({
              id: block.id,
              type: "function",
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input ?? {}),
              },
            });
          }
        }

        const m: Record<string, unknown> = { role: "assistant" };
        if (text) m.content = text;
        if (toolCalls.length) m.tool_calls = toolCalls;
        messages.push(m);
      }
    }
  }

  // Tools with schema sanitization
  const rawTools = (
    (body.tools ?? []) as Array<{
      name: string;
      description?: string;
      input_schema?: unknown;
    }>
  ).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.input_schema ?? {},
    },
  }));

  // Sanitize each tool schema (remove boolean subschemas)
  const sanitizedTools = rawTools.map((t) => {
    const params = t.function.parameters as Record<string, unknown>;
    if (!hasBooleanSchema(params)) return t;

    const key = t.function.name;
    const raw = JSON.stringify(params);
    const cached = sanitizedSchemaCache.get(key);
    if (cached && cached.raw === raw) {
      return { ...t, function: { ...t.function, parameters: cached.cleaned } };
    }

    const [, cleaned] = sanitizeSchemaNode(params);
    if (sanitizedSchemaCache.size >= SCHEMA_CACHE_MAX) {
      const first = sanitizedSchemaCache.keys().next().value;
      if (first !== undefined) sanitizedSchemaCache.delete(first);
    }
    sanitizedSchemaCache.set(key, {
      cleaned: (cleaned ?? {}) as Record<string, unknown>,
      raw,
    });
    return { ...t, function: { ...t.function, parameters: cleaned ?? {} } };
  });

  // Build the request body
  const result: Record<string, unknown> = {
    model: nimModel,
    messages,
    stream: body.stream ?? true,
    max_tokens: body.max_tokens ?? 4096,
    ...(body.temperature !== undefined && { temperature: body.temperature }),
    ...(body.top_p !== undefined && { top_p: body.top_p }),
    ...((body.stop_sequences as unknown[])?.length && {
      stop: body.stop_sequences,
    }),
    ...(sanitizedTools.length && {
      tools: sanitizedTools,
      tool_choice: "auto",
    }),
  };

  // NIM extra_body params
  if (nimSettings) {
    const ns = nimSettings as NimSettings;
    const extra = nimExtraBody(ns);

    // Apply NIM-specific overrides when request doesn't set them
    if (result.temperature === undefined && ns.temperature !== 1.0)
      result.temperature = ns.temperature;
    if (result.top_p === undefined && ns.top_p !== 1.0) result.top_p = ns.top_p;
    if (!result.stop && ns.stop) result.stop = ns.stop;

    if (ns.presence_penalty !== 0.0)
      result.presence_penalty = ns.presence_penalty;
    if (ns.frequency_penalty !== 0.0)
      result.frequency_penalty = ns.frequency_penalty;
    if (ns.seed !== null) result.seed = ns.seed;
    if (!ns.parallel_tool_calls) result.parallel_tool_calls = false;

    // Cap max_tokens
    if (
      typeof result.max_tokens === "number" &&
      result.max_tokens > ns.max_tokens
    ) {
      result.max_tokens = ns.max_tokens;
    }

    if (Object.keys(extra).length > 0) {
      result.extra_body = extra;
    }

    // Thinking via chat_template_kwargs
    if (body.enable_thinking && body.stream !== false) {
      const eb = (result.extra_body ?? {}) as Record<string, unknown>;
      const ctk = (eb.chat_template_kwargs ?? {}) as Record<string, unknown>;
      ctk.thinking = true;
      ctk.enable_thinking = true;
      if (!ctk.reasoning_budget) ctk.reasoning_budget = result.max_tokens;
      eb.chat_template_kwargs = ctk;
      result.extra_body = eb;
    }
  }

  return result;
}

// ── Non-streaming response conversion ──────────────────────────────────────

export function toAnthropicResponse(
  openaiBody: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  const choice = (
    openaiBody.choices as Array<{
      message?: {
        content?: string;
        tool_calls?: Array<{
          id: string;
          function: { name: string; arguments: string };
        }>;
      };
      finish_reason?: string;
    }>
  )?.[0];

  const content: AnthropicContent[] = [];

  if (choice?.message?.content) {
    content.push({ type: "text", text: choice.message.content });
  }

  if (choice?.message?.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input: safeParseJson(tc.function.arguments ?? "{}"),
      });
    }
  }

  let stopReason: AnthropicResponse["stop_reason"] =
    choice?.finish_reason === "tool_calls"
      ? "tool_use"
      : choice?.finish_reason === "stop"
        ? "end_turn"
        : choice?.finish_reason === "length"
          ? "max_tokens"
          : null;

  // Detect text-embedded tool calls when no structured tool_calls were found
  if (!choice?.message?.tool_calls && choice?.message?.content) {
    const parsed = parseTextEmbeddedToolCalls(choice.message.content);
    const toolSegments = parsed.segments.filter((s) => s.type === "toolCall");
    if (toolSegments.length > 0) {
      content.length = 0;

      for (const seg of parsed.segments) {
        if (seg.type === "text" && seg.text) {
          content.push({ type: "text", text: seg.text });
        } else if (seg.type === "toolCall") {
          content.push({
            type: "tool_use",
            id: `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: seg.toolCall.name,
            input: seg.toolCall.args as Record<string, unknown>,
          });
        }
      }

      stopReason = "tool_use";
    }
  }

  // Validate and repair tool arguments
  const toolCalls = content.filter(
    (
      c,
    ): c is AnthropicContent & {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    } => c.type === "tool_use" && typeof (c as { id?: string }).id === "string",
  );
  if (toolCalls.length > 0) {
    const toolSchemas = buildToolSchemasFromRequest(openaiBody);
    const { valid, skipped } = validateAndRepairToolCalls(
      toolCalls.map((tc) => ({ id: tc.id, name: tc.name, input: tc.input })),
      toolSchemas,
    );

    if (skipped.length > 0) {
      const retryMsg = buildInvalidToolCallRetryMessage(skipped);
      if (retryMsg) {
        content.push({ type: "text", text: retryMsg });
        stopReason = "end_turn";
      }
    }

    // Replace tool_use blocks with repaired versions
    const validMap = new Map(valid.map((v) => [v.id, v]));
    for (let i = 0; i < content.length; i++) {
      const block = content[i];
      if (block.type === "tool_use") {
        const tc = block as {
          type: "tool_use";
          id: string;
          name: string;
          input: Record<string, unknown>;
        };
        const repaired = validMap.get(tc.id);
        if (repaired) {
          content[i] = {
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: repaired.input,
          };
        } else {
          content.splice(i, 1);
          i--;
        }
      }
    }
  }

  const usage = openaiBody.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;

  return {
    id: `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    content,
    model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: usage?.prompt_tokens ?? 0,
      output_tokens: usage?.completion_tokens ?? 0,
    },
  };
}

// ── Streaming response conversion ──────────────────────────────────────────

function emitMinimalMessage(
  controller: ReadableStreamDefaultController,
  model: string,
): void {
  const te = TE;
  const id = `msg_${Date.now()}`;
  controller.enqueue(
    te.encode(
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id, type: "message", role: "assistant", content: [], model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } })}\n\n`,
    ),
  );
  controller.enqueue(
    te.encode(
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 0 } })}\n\n`,
    ),
  );
  controller.enqueue(
    te.encode(
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ),
  );
}

export async function toAnthropicStream(
  openaiResponse: Response,
  controller: ReadableStreamDefaultController,
  tokenCounts?: { inputTokens: number; completionTokens: number },
): Promise<void> {
  if (!openaiResponse.body) {
    emitMinimalMessage(controller, "");
    return;
  }
  const reader = openaiResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // State machine
  let started = false;
  let textBlockOpen = false;
  let textBlockIndex = -1;
  let thinkingBlockOpen = false;
  let thinkingBlockIndex = -1;
  const toolBlockMap = new Map<number, { blockIndex: number; id: string }>();
  let nextBlockIndex = 0;
  let finished = false;
  let inputTokens = 0;
  let streamClosed = false;
  let accumulatedText = "";
  let finishReason: string | null = null;
  let completionTokens = 0;
  const stoppedBlocks = new Set<number>();

  function emit(event: string, data: unknown): void {
    if (streamClosed) return;
    try {
      controller.enqueue(
        TE.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
      );
    } catch {
      streamClosed = true;
    }
  }

  function stopBlock(index: number): void {
    if (stoppedBlocks.has(index)) return;
    stoppedBlocks.add(index);
    emit("content_block_stop", { type: "content_block_stop", index });
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || streamClosed) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") continue;

        let chunk: Record<string, unknown>;
        try {
          chunk = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          continue;
        }

        const chunkUsage = chunk.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
        if (chunkUsage?.prompt_tokens !== undefined)
          inputTokens = chunkUsage.prompt_tokens;
        if (chunkUsage?.completion_tokens !== undefined)
          completionTokens = chunkUsage.completion_tokens;

        const choices = chunk.choices as Array<{
          delta?: {
            content?: string;
            reasoning_content?: string;
            tool_calls?: Array<{
              index: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
          finish_reason?: string | null;
        }>;
        const choice = choices?.[0];
        if (!choice) continue;

        const delta = choice.delta ?? {};
        const finish = choice.finish_reason;

        if (!started) {
          emit("message_start", {
            type: "message_start",
            message: {
              id: randomId("msg"),
              type: "message",
              role: "assistant",
              content: [],
              model: chunk.model ?? "",
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: inputTokens, output_tokens: 0 },
            },
          });
          started = true;
        }

        // Reasoning content (thinking block)
        if (delta.reasoning_content) {
          if (!thinkingBlockOpen) {
            thinkingBlockIndex = nextBlockIndex++;
            thinkingBlockOpen = true;
            emit("content_block_start", {
              type: "content_block_start",
              index: thinkingBlockIndex,
              content_block: { type: "thinking", thinking: "" },
            });
          }
          emit("content_block_delta", {
            type: "content_block_delta",
            index: thinkingBlockIndex,
            delta: {
              type: "thinking_delta",
              thinking: delta.reasoning_content,
            },
          });
        }

        // Text delta
        if (delta.content) {
          accumulatedText += delta.content;
          if (!textBlockOpen) {
            // Close thinking block before opening text block (same SSE event)
            if (thinkingBlockOpen) {
              stopBlock(thinkingBlockIndex);
              thinkingBlockOpen = false;
            }
            textBlockIndex = nextBlockIndex++;
            textBlockOpen = true;
            emit("content_block_start", {
              type: "content_block_start",
              index: textBlockIndex,
              content_block: { type: "text", text: "" },
            });
          }
          emit("content_block_delta", {
            type: "content_block_delta",
            index: textBlockIndex,
            delta: { type: "text_delta", text: delta.content },
          });
        }

        // Tool call deltas
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.function?.name && !toolBlockMap.has(tc.index)) {
              const blockIndex = nextBlockIndex++;
              const id = tc.id ?? randomId("toolu");
              toolBlockMap.set(tc.index, { blockIndex, id });
              emit("content_block_start", {
                type: "content_block_start",
                index: blockIndex,
                content_block: {
                  type: "tool_use",
                  id,
                  name: tc.function.name,
                  input: {},
                },
              });
            }

            if (tc.function?.arguments) {
              const entry = toolBlockMap.get(tc.index);
              if (entry) {
                emit("content_block_delta", {
                  type: "content_block_delta",
                  index: entry.blockIndex,
                  delta: {
                    type: "input_json_delta",
                    partial_json: tc.function.arguments,
                  },
                });
              }
            }
          }
        }

        if (finish && !finished) {
          finished = true;
          finishReason = finish;

          // Detect text-embedded tool calls when no structured tool_calls received
          if (!toolBlockMap.size && accumulatedText) {
            const parsed = parseTextEmbeddedToolCalls(accumulatedText);
            const toolSegments = parsed.segments.filter(
              (s) => s.type === "toolCall",
            );

            if (toolSegments.length > 0) {
              // Close the text block first
              stopBlock(textBlockIndex);

              // Emit tool_use blocks for each embedded tool call
              for (const seg of parsed.segments) {
                if (seg.type === "toolCall") {
                  const blockIndex = nextBlockIndex++;
                  const id = randomId("toolu");
                  emit("content_block_start", {
                    type: "content_block_start",
                    index: blockIndex,
                    content_block: {
                      type: "tool_use",
                      id,
                      name: seg.toolCall.name,
                      input: {},
                    },
                  });
                  emit("content_block_delta", {
                    type: "content_block_delta",
                    index: blockIndex,
                    delta: {
                      type: "input_json_delta",
                      partial_json: JSON.stringify(seg.toolCall.args),
                    },
                  });
                  stopBlock(blockIndex);
                }
              }

              finishReason = "tool_calls";
            }
          }

          // Close any remaining open blocks (skip ones already stopped)
          for (let i = 0; i < nextBlockIndex; i++) {
            stopBlock(i);
          }

          const mappedReason =
            finishReason === "tool_calls"
              ? "tool_use"
              : finishReason === "stop"
                ? "end_turn"
                : finishReason === "length"
                  ? "max_tokens"
                  : null;

          if (completionTokens === 0 && accumulatedText.length > 0) {
            completionTokens = Math.round(accumulatedText.length / 4);
          }

          emit("message_delta", {
            type: "message_delta",
            delta: {
              stop_reason: mappedReason,
              stop_sequence: null,
            },
            usage: { output_tokens: completionTokens },
          });

          emit("message_stop", { type: "message_stop" });
        }
      }
    }

    // If the stream ended without emitting any content (empty body),
    // send a minimal valid response so the client doesn't see an empty 200
    if (!streamClosed) {
      if (!started) {
        emitMinimalMessage(controller, "");
      } else if (!finished) {
        // Post-stream: detect text-embedded tool calls from accumulated text
        if (!toolBlockMap.size && accumulatedText) {
          const parsed = parseTextEmbeddedToolCalls(accumulatedText);
          const toolSegments = parsed.segments.filter(
            (s) => s.type === "toolCall",
          );

          if (toolSegments.length > 0) {
            if (textBlockOpen) {
              stopBlock(textBlockIndex);
            }

            for (const seg of parsed.segments) {
              if (seg.type === "toolCall") {
                const blockIndex = nextBlockIndex++;
                const id = randomId("toolu");
                emit("content_block_start", {
                  type: "content_block_start",
                  index: blockIndex,
                  content_block: {
                    type: "tool_use",
                    id,
                    name: seg.toolCall.name,
                    input: {},
                  },
                });
                emit("content_block_delta", {
                  type: "content_block_delta",
                  index: blockIndex,
                  delta: {
                    type: "input_json_delta",
                    partial_json: JSON.stringify(seg.toolCall.args),
                  },
                });
                stopBlock(blockIndex);
              }
            }

            finishReason = "tool_calls";
          }
        }

        for (let i = 0; i < nextBlockIndex; i++) {
          stopBlock(i);
        }

        const mappedReason =
          finishReason === "tool_calls" ? "tool_use" : "end_turn";

        // Estimate completion tokens if NIM didn't provide them
        if (completionTokens === 0 && accumulatedText.length > 0) {
          completionTokens = Math.round(accumulatedText.length / 4);
        }

        emit("message_delta", {
          type: "message_delta",
          delta: {
            stop_reason: mappedReason,
            stop_sequence: null,
          },
          usage: { output_tokens: completionTokens },
        });
        emit("message_stop", { type: "message_stop" });
      }
    }
  } finally {
    if (tokenCounts) {
      // Fallback: estimate completion tokens from text length when NIM omits usage
      if (completionTokens === 0 && accumulatedText.length > 0) {
        completionTokens = Math.round(accumulatedText.length / 4);
      }
      tokenCounts.inputTokens = inputTokens;
      tokenCounts.completionTokens = completionTokens;
    }
    reader.releaseLock();
  }
}
