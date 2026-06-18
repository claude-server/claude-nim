// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import * as http from "node:http";
import * as vscode from "vscode";
import { streamChatCompletion, fetchModels } from "./api";
import { normalizeNvidiaModels } from "./model-catalog";
import { PROVIDER_DISPLAY_NAME } from "./constants";
import { debugLog } from "./output-channel";
import {
  translateRequest,
  buildMessageStart,
  buildContentBlockStart,
  buildTextDelta,
  buildToolInputDelta,
  buildContentBlockStop,
  buildMessageDelta,
  buildMessageStop,
  buildPing,
  mapStopReason,
  estimateTokens,
} from "./translator";
import { parseTextEmbeddedToolCalls } from "./tool-parser";
import { jsonrepair } from "jsonrepair";
import {
  initModelState,
  getCurrentModel,
  setCurrentModel,
  resetCurrentModel,
  extractUserText,
  parseModelCommand,
} from "./model-switch";
import {
  initDashboard,
  recordMetric,
  getMetricsHistory,
  getMetricsSSE,
  getStats,
} from "./dashboard";
import type { AnthropicMessagesRequest } from "./anthropic-types";
import { DASHBOARD_HTML, DASHBOARD_JS } from "./dashboard-assets";
let server: http.Server | null = null;
let currentPort: number | null = null;
let activeApiKey: string | null = null;
let showReasoningEnabled: boolean = false;
let modelsCacheTTLMs: number = 5 * 60 * 1000;
let requestTimeoutMs: number = 120_000;
let activeDefaultModel: string | undefined = undefined;

export function setShowReasoning(enabled: boolean) {
  showReasoningEnabled = enabled;
}

export function setModelsCacheTTL(minutes: number) {
  modelsCacheTTLMs = Math.max(1, minutes) * 60 * 1000;
}

export function setRequestTimeout(seconds: number) {
  requestTimeoutMs = Math.max(10, seconds) * 1000;
}

export function setDefaultModel(model: string | undefined) {
  activeDefaultModel = model;
}

export function getStreamIdleTimeout(): number {
  return requestTimeoutMs;
}

const activeStreams = new Set<AbortController>();
const activeSockets = new Set<import("node:net").Socket>();
let modelsCache: {
  data: Record<string, unknown>;
  timestamp: number;
  apiKey: string;
} | null = null;

// ============================================================================
// Request body reader
// ============================================================================

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        req.unpipe();
        req.resume(); // Drain the rest to keep socket alive for the 413 response
        reject(new Error("Payload too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  data: unknown,
): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function sendRaw(
  res: http.ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function sendError(
  res: http.ServerResponse,
  status: number,
  type: string,
  message: string,
): void {
  sendJson(res, status, {
    type: "error",
    error: { type, message },
  });
}

// ============================================================================
// Reasoning Stripper
// ============================================================================

class ReasoningStripper {
  private buffer = "";
  private insideThink = false;

  process(chunk: string): string {
    this.buffer += chunk;
    let output = "";

    while (this.buffer.length > 0) {
      if (this.insideThink) {
        const endIndex = this.buffer.indexOf("</think>");
        if (endIndex !== -1) {
          this.insideThink = false;
          this.buffer = this.buffer.slice(endIndex + 8);
        } else {
          this.buffer = "";
          break;
        }
      } else {
        const startIndex = this.buffer.indexOf("<think>");
        if (startIndex !== -1) {
          output += this.buffer.slice(0, startIndex);
          this.insideThink = true;
          this.buffer = this.buffer.slice(startIndex + 7);
        } else {
          const possiblePartial = this.buffer.lastIndexOf("<");
          if (
            possiblePartial !== -1 &&
            "<think>".startsWith(this.buffer.slice(possiblePartial))
          ) {
            output += this.buffer.slice(0, possiblePartial);
            this.buffer = this.buffer.slice(possiblePartial);
            break;
          } else {
            output += this.buffer;
            this.buffer = "";
          }
        }
      }
    }
    return output;
  }

  flush(): string {
    const out = this.buffer;
    this.buffer = "";
    this.insideThink = false;
    return out;
  }
}

// ============================================================================
// Streaming handler
// ============================================================================

async function handleMessagesStream(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: AnthropicMessagesRequest,
  apiKey: string,
  defaultModel?: string,
): Promise<void> {
  // Map "NVIDIA-NIM-Proxy" (provider name from .claude/settings.json) to the
  // actual NIM model. Claude Code sends this as the model name when the user
  // hasn't explicitly picked a NIM model via /model.
  if (!body.model || body.model === "NVIDIA-NIM-Proxy") {
    body.model = defaultModel || getCurrentModel() || "";
  }

  // Always override model when a default is configured — Claude Code sends
  // "claude-opus-4-8" which doesn't exist on NIM.
  if (defaultModel) {
    body.model = defaultModel;
  }

  if (!body.model) {
    sendError(res, 400, "invalid_request_error", "model is required");
    return;
  }

  const requestModel = body.model;
  debugLog(
    "proxy",
    `→ ${requestModel} (stream, max_tokens=${body.max_tokens})`,
  );

  const openaiRequest = translateRequest(body);
  openaiRequest.stream = true;

  const abortController = new AbortController();
  activeStreams.add(abortController);

  // Metrics capture
  const metricStart = Date.now();
  const metricId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  req.on("close", () => {
    abortController.abort();
    activeStreams.delete(abortController);
  });

  try {
    const stream = streamChatCompletion(
      apiKey,
      openaiRequest,
      abortController.signal,
      "claude-nim-proxy/1.0",
      { requestTimeoutMs },
    );
    let firstResult: IteratorResult<import("./types").OcGoStreamResponse>;
    try {
      firstResult = await stream.next();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      let status = 502;
      let type = "api_error";
      if (msg.includes("[AUTH_FAILED]")) {
        status = 401;
        type = "authentication_error";
      } else if (msg.includes("[RATE_LIMITED]")) {
        status = 429;
        type = "rate_limit_error";
      }
      sendError(res, status, type, msg);
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no",
    });

    res.write(buildPing());

    const inputText = JSON.stringify(openaiRequest.messages);
    const inputTokens = estimateTokens(inputText);

    res.write(buildMessageStart(requestModel, inputTokens));

    let contentBlockIndex = 0;
    let textBlockStarted = false;
    const activeToolCalls = new Map<
      number,
      { id: string; name: string; argsBuf: string; blockIndex: number }
    >();
    let outputTokens = 0;
    let hasToolCalls = false;
    let lastFinishReason: string | null = null;

    let pendingText = "";
    const stripper = new ReasoningStripper();

    const flushTextSegments = (force = false) => {
      if (!pendingText) return;

      // Parse the pending text
      const { segments, incompleteText } =
        parseTextEmbeddedToolCalls(pendingText);
      pendingText = incompleteText;

      // If forced (end of stream), emit any remaining incomplete text as plain text
      if (force && pendingText) {
        segments.push({ type: "text", text: pendingText });
        pendingText = "";
      }

      for (const seg of segments) {
        if (seg.type === "text" && seg.text) {
          if (!textBlockStarted) {
            res.write(buildContentBlockStart(contentBlockIndex, "text"));
            textBlockStarted = true;
          }
          res.write(buildTextDelta(contentBlockIndex, seg.text));
          outputTokens += estimateTokens(seg.text);
        } else if (seg.type === "toolCall") {
          if (textBlockStarted) {
            res.write(buildContentBlockStop(contentBlockIndex));
            contentBlockIndex++;
            textBlockStarted = false;
          }

          const toolId = `toolu_${Date.now().toString(36)}_${contentBlockIndex}`;
          res.write(
            buildContentBlockStart(contentBlockIndex, "tool_use", {
              id: toolId,
              name: seg.toolCall.name,
            }),
          );
          res.write(
            buildToolInputDelta(
              contentBlockIndex,
              JSON.stringify(seg.toolCall.args),
            ),
          );
          res.write(buildContentBlockStop(contentBlockIndex));
          contentBlockIndex++;
          hasToolCalls = true;
        }
      }
    };

    while (!firstResult.done) {
      const chunk = firstResult.value;
      const choice = chunk.choices?.[0];
      if (!choice) {
        firstResult = await stream.next();
        continue;
      }

      const delta = choice.delta;

      if (delta.content) {
        const textToProcess = showReasoningEnabled
          ? delta.content
          : stripper.process(delta.content);
        if (textToProcess) {
          pendingText += textToProcess;
          flushTextSegments();
        }
      }

      if (delta.tool_calls) {
        // Native tool calls received; flush any pending text first
        if (pendingText) {
          flushTextSegments(true);
        }

        for (const tc of delta.tool_calls) {
          const tcIndex = tc.index ?? 0;

          if (!activeToolCalls.has(tcIndex)) {
            if (textBlockStarted) {
              res.write(buildContentBlockStop(contentBlockIndex));
              contentBlockIndex++;
              textBlockStarted = false;
            }

            const toolId =
              tc.id || `toolu_${Date.now().toString(36)}_${tcIndex}`;
            const toolName = tc.function?.name || "unknown";
            activeToolCalls.set(tcIndex, {
              id: toolId,
              name: toolName,
              argsBuf: "",
              blockIndex: contentBlockIndex,
            });
            res.write(
              buildContentBlockStart(contentBlockIndex, "tool_use", {
                id: toolId,
                name: toolName,
              }),
            );
            hasToolCalls = true;
            contentBlockIndex++;
          }

          const tool = activeToolCalls.get(tcIndex)!;
          if (tc.function?.arguments) {
            tool.argsBuf += tc.function.arguments;
          }
        }
      }

      if (choice.finish_reason) {
        lastFinishReason = choice.finish_reason;
      }

      if (chunk.usage?.completion_tokens) {
        outputTokens = chunk.usage.completion_tokens;
      }

      firstResult = await stream.next();
    }

    // Flush any remaining text
    if (!showReasoningEnabled) {
      const remainingText = stripper.flush();
      if (remainingText) {
        pendingText += remainingText;
      }
    }
    flushTextSegments(true);

    if (textBlockStarted) {
      res.write(buildContentBlockStop(contentBlockIndex));
    }

    // Repair and send buffered tool calls
    for (const [, tool] of activeToolCalls) {
      let finalArgs = tool.argsBuf;
      try {
        finalArgs = jsonrepair(finalArgs);
      } catch {
        // If repair fails, send as is and hope for the best
      }
      if (finalArgs) {
        res.write(buildToolInputDelta(tool.blockIndex, finalArgs));
      }
      res.write(buildContentBlockStop(tool.blockIndex));
    }

    const stopReason = mapStopReason(lastFinishReason, hasToolCalls);
    res.write(buildMessageDelta(stopReason, outputTokens));
    res.write(buildMessageStop());

    // Record metric
    recordMetric({
      id: metricId,
      timestamp: metricStart,
      model: requestModel,
      stream: true,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - metricStart,
      timeToFirstTokenMs: 0,
      status: "success",
      messageCount: body.messages?.length ?? 0,
      contextCharCount: JSON.stringify(body).length,
    });

    debugLog(
      "proxy",
      `← ${requestModel} (${stopReason}, ~${outputTokens} tokens)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("AbortError") || msg.includes("aborted")) {
      debugLog("proxy", "Client disconnected");
    } else {
      // Record error metric
      recordMetric({
        id: metricId,
        timestamp: metricStart,
        model: requestModel,
        stream: true,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - metricStart,
        timeToFirstTokenMs: 0,
        status: "error",
        error: msg,
        messageCount: body.messages?.length ?? 0,
        contextCharCount: JSON.stringify(body).length,
      });

      debugLog("proxy", `Stream error: ${msg}`);
      try {
        vscode.window.showErrorMessage(`Claude-NIM Proxy stream error: ${msg}`);
      } catch {
        // Ignored if VS Code not available
      }
      try {
        const errorEvent = {
          type: "error",
          error: { type: "api_error", message: msg },
        };
        res.write(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`);
      } catch {
        // Ignored
      }
    }
  } finally {
    activeStreams.delete(abortController);
    res.end();
  }
}

// ============================================================================
// Non-streaming handler
// ============================================================================

async function handleMessagesNonStream(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: AnthropicMessagesRequest,
  apiKey: string,
  defaultModel?: string,
): Promise<void> {
  // Map "NVIDIA-NIM-Proxy" to actual NIM model
  if (!body.model || body.model === "NVIDIA-NIM-Proxy") {
    body.model = defaultModel || getCurrentModel() || "";
  }

  // Always override model when a default is configured
  if (defaultModel) {
    body.model = defaultModel;
  }

  if (!body.model) {
    sendError(res, 400, "invalid_request_error", "model is required");
    return;
  }

  const requestModel = body.model;
  debugLog(
    "proxy",
    `→ ${requestModel} (non-stream, max_tokens=${body.max_tokens})`,
  );

  const openaiRequest = translateRequest(body);
  openaiRequest.stream = true;

  const metricStart = Date.now();
  const metricId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  const contentBlocks: unknown[] = [];
  let textContent = "";
  const stripper = new ReasoningStripper();
  const toolCalls: Array<{ id: string; name: string; args: string }> = [];
  let outputTokens = 0;
  let lastFinishReason: string | null = null;

  try {
    for await (const chunk of streamChatCompletion(
      apiKey,
      openaiRequest,
      undefined,
      "claude-nim-proxy/1.0",
      { requestTimeoutMs },
    )) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;

      if (choice.delta.content) {
        const textToProcess = showReasoningEnabled
          ? choice.delta.content
          : stripper.process(choice.delta.content);
        if (textToProcess) {
          textContent += textToProcess;
        }
        outputTokens += estimateTokens(choice.delta.content);
      }

      if (choice.delta.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCalls[idx]) {
            toolCalls[idx] = {
              id: tc.id || `toolu_${Date.now().toString(36)}_${idx}`,
              name: tc.function?.name || "unknown",
              args: "",
            };
          }
          if (tc.function?.arguments) {
            toolCalls[idx].args += tc.function.arguments;
          }
        }
      }

      if (choice.finish_reason) lastFinishReason = choice.finish_reason;
      if (chunk.usage?.completion_tokens)
        outputTokens = chunk.usage.completion_tokens;
    }

    if (!showReasoningEnabled) {
      const remainingText = stripper.flush();
      if (remainingText) {
        textContent += remainingText;
      }
    }

    if (textContent) {
      // Parse any embedded tools in the final non-streamed text
      const { segments } = parseTextEmbeddedToolCalls(textContent);
      for (const seg of segments) {
        if (seg.type === "text") {
          contentBlocks.push({ type: "text", text: seg.text });
        } else if (seg.type === "toolCall") {
          contentBlocks.push({
            type: "tool_use",
            id: `toolu_${Date.now().toString(36)}`,
            name: seg.toolCall.name,
            input: seg.toolCall.args,
          });
        }
      }
    }
    for (const tc of toolCalls) {
      if (!tc) continue;
      let input: unknown = {};
      try {
        input = JSON.parse(jsonrepair(tc.args));
      } catch {
        try {
          input = JSON.parse(tc.args);
        } catch {
          input = {};
        }
      }
      contentBlocks.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input,
      });
    }

    const hasTools = toolCalls.some(Boolean);
    const stopReason = mapStopReason(lastFinishReason, hasTools);
    const inputTokens = estimateTokens(JSON.stringify(openaiRequest.messages));

    sendJson(res, 200, {
      id: `msg_nim_${Date.now().toString(36)}`,
      type: "message",
      role: "assistant",
      content: contentBlocks,
      model: requestModel,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      },
    });

    // Record metric
    recordMetric({
      id: metricId,
      timestamp: metricStart,
      model: requestModel,
      stream: false,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - metricStart,
      timeToFirstTokenMs: 0,
      status: "success",
      messageCount: body.messages?.length ?? 0,
      contextCharCount: JSON.stringify(body).length,
    });

    debugLog(
      "proxy",
      `← ${requestModel} (${stopReason}, ~${outputTokens} tokens)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    debugLog("proxy", `Request error: ${msg}`);
    try {
      vscode.window.showErrorMessage(`Claude-NIM Proxy error: ${msg}`);
    } catch {
      // Ignored if VS Code not available
    }
    let status = 502;
    let type = "api_error";
    if (msg.includes("[AUTH_FAILED]")) {
      status = 401;
      type = "authentication_error";
    } else if (msg.includes("[RATE_LIMITED]")) {
      status = 429;
      type = "rate_limit_error";
    }
    sendError(res, status, type, msg);

    // Record error metric
    recordMetric({
      id: metricId,
      timestamp: metricStart,
      model: requestModel,
      stream: false,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - metricStart,
      timeToFirstTokenMs: 0,
      status: "error",
      error: msg,
      messageCount: body.messages?.length ?? 0,
      contextCharCount: JSON.stringify(body).length,
    });
  }
}

// ============================================================================
// Model command helpers
// ============================================================================

function sendFakeResponse(res: http.ServerResponse, text: string): void {
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(
    JSON.stringify({
      id: `msg_${Date.now().toString(36)}`,
      type: "message",
      role: "assistant",
      content: [{ type: "text", text }],
      model: "model-switch",
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: Math.ceil(text.length / 4) },
    }),
  );
}

async function getModelListForUser(
  apiKey: string,
  res: http.ServerResponse,
): Promise<void> {
  const raw = await fetchModels(
    apiKey,
    undefined,
    "claude-nim-proxy/1.0",
    requestTimeoutMs,
  );
  if (!raw) {
    sendFakeResponse(res, "Failed to fetch model list from NVIDIA NIM.");
    return;
  }
  const models = normalizeNvidiaModels(raw);
  const list = models.map((m, i) => `${i + 1}. ${m.id}`).join("\n");
  sendFakeResponse(
    res,
    `Available NVIDIA NIM models:\n\n${list}\n\nUse /model <name> or /model <#> to switch.`,
  );
}

// ============================================================================
// Server export
// ============================================================================

export function startProxyServer(
  port: number,
  apiKey: string,
  defaultModel?: string,
  onStatus?: (running: boolean, port?: number) => void,
): void {
  if (server) {
    vscode.window.showInformationMessage(
      `Claude-NIM Proxy is already running on port ${currentPort}`,
    );
    return;
  }

  activeApiKey = apiKey;
  currentPort = port;
  initModelState();
  initDashboard();
  if (defaultModel) {
    activeDefaultModel = defaultModel;
    setCurrentModel(defaultModel);
  } else {
    activeDefaultModel = getCurrentModel() || undefined;
  }

  server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, x-api-key, anthropic-version, anthropic-beta",
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return;
    }

    if (url === "/" || url === "/health") {
      sendJson(res, 200, { status: "ok", service: "Claude-NIM Proxy" });
      return;
    }

    if (url === "/v1/messages" && method === "POST") {
      readBody(req)
        .then((raw) => JSON.parse(raw) as AnthropicMessagesRequest)
        .then(async (body) => {
          // --- Model switch command interception ---
          const lastMsg = body.messages?.[body.messages.length - 1];
          const userText = extractUserText(lastMsg);
          const modelCmd = parseModelCommand(userText);

          if (modelCmd) {
            if (modelCmd.cmd === "current") {
              const cur = getCurrentModel() || activeDefaultModel || "not set";
              return sendFakeResponse(
                res,
                `Current model: ${cur}\n\nUse /model <name> to switch.`,
              );
            }
            if (modelCmd.cmd === "list") {
              return getModelListForUser(activeApiKey!, res);
            }
            if (modelCmd.cmd === "switch" && modelCmd.model) {
              const idx = parseInt(modelCmd.model, 10);
              if (!isNaN(idx) && idx > 0) {
                const raw = await fetchModels(
                  activeApiKey!,
                  undefined,
                  "claude-nim-proxy/1.0",
                  requestTimeoutMs,
                );
                if (!raw) {
                  return sendFakeResponse(
                    res,
                    "Failed to fetch model list from NVIDIA NIM.",
                  );
                }
                const models = normalizeNvidiaModels(raw);
                const resolved = models[idx - 1]?.id;
                if (!resolved) {
                  return sendFakeResponse(
                    res,
                    `Model #${idx} not found. Use /models to see available models.`,
                  );
                }
                setCurrentModel(resolved);
                activeDefaultModel = resolved;
                return sendFakeResponse(res, `Switched to: ${resolved}`);
              }
              setCurrentModel(modelCmd.model);
              activeDefaultModel = modelCmd.model;
              return sendFakeResponse(res, `Switched to: ${modelCmd.model}`);
            }
          }

          if (body.stream === false) {
            return handleMessagesNonStream(
              req,
              res,
              body,
              activeApiKey!,
              activeDefaultModel,
            );
          } else {
            return handleMessagesStream(
              req,
              res,
              body,
              activeApiKey!,
              activeDefaultModel,
            );
          }
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg === "Payload too large") {
            sendError(
              res,
              413,
              "invalid_request_error",
              "Request body exceeds 10 MB limit",
            );
          } else if (msg.includes("JSON")) {
            sendError(
              res,
              400,
              "invalid_request_error",
              `Invalid JSON: ${msg}`,
            );
          } else {
            sendError(
              res,
              400,
              "invalid_request_error",
              `Invalid request: ${msg}`,
            );
          }
        });
      return;
    }

    if (url === "/v1/models" && method === "GET") {
      if (!activeApiKey) {
        sendError(res, 401, "authentication_error", "No API key configured");
        return;
      }
      const cached = modelsCache;
      if (
        cached &&
        cached.apiKey === activeApiKey &&
        Date.now() - cached.timestamp < modelsCacheTTLMs
      ) {
        const responseData = cached.data as {
          data: unknown[];
          has_more: boolean;
        };
        sendJson(res, 200, cached.data);
        debugLog(
          "proxy",
          `Fetched ${responseData.data.length} normalized models for Claude Code. (Cached)`,
        );
        return;
      }
      fetchModels(
        activeApiKey,
        undefined,
        "claude-nim-proxy/1.0",
        requestTimeoutMs,
      )
        .then((rawModels) => {
          if (!rawModels) {
            sendError(
              res,
              502,
              "api_error",
              "Failed to fetch models from NVIDIA NIM",
            );
            return;
          }
          const normalized = normalizeNvidiaModels(rawModels);
          const data = normalized.map((m) => ({
            type: "model" as const,
            id: m.id,
            display_name: m.displayName,
            created_at: new Date(Date.now() - 86400000).toISOString(),
          }));

          // Add the proxy model entry so Claude Code accepts "NVIDIA-NIM-Proxy"
          // from .claude/settings.json. This maps to whatever NIM model is active.
          const currentNim = activeDefaultModel || getCurrentModel() || normalized[0]?.id || "";
          if (currentNim) {
            data.unshift({
              type: "model" as const,
              id: "NVIDIA-NIM-Proxy",
              display_name: `NVIDIA NIM (${currentNim})`,
              created_at: new Date(Date.now() - 86400000).toISOString(),
            });
          }

          const responseData = {
            data,
            has_more: false,
            first_id: data[0]?.id ?? "",
            last_id: data[data.length - 1]?.id ?? "",
          };
          modelsCache = {
            data: responseData,
            timestamp: Date.now(),
            apiKey: activeApiKey!,
          };
          sendJson(res, 200, responseData);
          debugLog(
            "proxy",
            `Fetched ${data.length} normalized models for Claude Code.`,
          );
        })
        .catch((err) => {
          sendError(
            res,
            500,
            "api_error",
            err instanceof Error ? err.message : String(err),
          );
        });
      return;
    }

    // --- New API routes ---

    // GET /api/models — cached model list as JSON array
    if (url === "/api/models" && method === "GET") {
      if (modelsCache && modelsCache.apiKey === activeApiKey) {
        const data = modelsCache.data as {
          data: Array<{ id: string; display_name: string }>;
        };
        sendJson(res, 200, data.data);
        return;
      }
      sendJson(res, 503, { error: "Models not loaded yet" });
      return;
    }

    // GET /api/model — current default model
    if (url === "/api/model" && method === "GET") {
      sendJson(res, 200, {
        model: getCurrentModel() || activeDefaultModel || "",
      });
      return;
    }

    // POST /api/model — set default model
    if (url === "/api/model" && method === "POST") {
      readBody(req).then((raw) => {
        const { model } = JSON.parse(raw) as { model?: string };
        if (model === "") {
          resetCurrentModel();
          activeDefaultModel = undefined;
          sendJson(res, 200, { ok: true, model: null });
        } else if (model) {
          setCurrentModel(model);
          activeDefaultModel = model;
          sendJson(res, 200, { ok: true, model });
        } else {
          sendJson(res, 400, { error: "Missing model" });
        }
      });
      return;
    }

    // POST /api/key — update API key (accepts any key; proxy uses it immediately)
    if (url === "/api/key" && method === "POST") {
      readBody(req).then((raw) => {
        const { apiKey } = JSON.parse(raw) as { apiKey?: string };
        if (!apiKey) {
          sendJson(res, 400, { error: "Missing apiKey" });
          return;
        }
        activeApiKey = apiKey;
        modelsCache = null; // invalidate cache on key change
        sendJson(res, 200, { ok: true });
      });
      return;
    }

    // GET /api/status — proxy status
    if (url === "/api/status" && method === "GET") {
      sendJson(res, 200, {
        running: true,
        port: currentPort,
        model: getCurrentModel() || activeDefaultModel || "",
        hasApiKey: !!activeApiKey,
      });
      return;
    }

    // GET /dashboard — serve dashboard HTML
    if (url === "/dashboard" || url === "/dashboard/") {
      sendRaw(res, 200, "text/html", DASHBOARD_HTML);
      return;
    }

    // GET /dashboard-client.js — serve dashboard JS
    if (url === "/dashboard-client.js") {
      sendRaw(res, 200, "application/javascript", DASHBOARD_JS);
      return;
    }

    // GET /api/metrics — SSE stream
    if (url === "/api/metrics" && method === "GET") {
      getMetricsSSE(req, res);
      return;
    }

    // GET /api/metrics/history — JSON array of recent metrics
    if (url === "/api/metrics/history" && method === "GET") {
      sendJson(res, 200, getMetricsHistory());
      return;
    }

    // GET /api/stats — aggregated stats
    if (url === "/api/stats" && method === "GET") {
      sendJson(res, 200, getStats());
      return;
    }

    sendError(res, 404, "not_found_error", `Route not found: ${method} ${url}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    let msg = `Failed to start ${PROVIDER_DISPLAY_NAME} Proxy: ${err.message}`;
    if (err.code === "EADDRINUSE") {
      msg = `Port ${port} is already in use. Please configure a different proxyPort in settings.`;
    }
    vscode.window.showErrorMessage(msg);
    debugLog("proxy", msg);
    server = null;
    currentPort = null;
    activeApiKey = null;
    onStatus?.(false);
  });

  server.listen(port, "127.0.0.1", () => {
    vscode.window.showInformationMessage(
      `${PROVIDER_DISPLAY_NAME} Proxy started on port ${port}`,
    );
    debugLog("proxy", `Server started on 127.0.0.1:${port}`);
    onStatus?.(true, port);
  });

  // Track connected sockets so we can force-close them on stop
  server.on("connection", (socket) => {
    activeSockets.add(socket);
    socket.on("close", () => activeSockets.delete(socket));
  });
}

export function stopProxyServer(): void {
  for (const stream of activeStreams) {
    stream.abort();
  }
  activeStreams.clear();

  // Force-close all keep-alive sockets so server.close() completes immediately
  for (const socket of activeSockets) {
    socket.destroy();
  }
  activeSockets.clear();

  if (server) {
    server.close(() => {
      vscode.window.showInformationMessage(
        `${PROVIDER_DISPLAY_NAME} Proxy stopped`,
      );
      debugLog("proxy", "Server stopped");
    });
    server = null;
    currentPort = null;
    activeApiKey = null;
  }
}

export function isProxyRunning(): boolean {
  return server !== null;
}
