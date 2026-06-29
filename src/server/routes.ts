import type { Config } from "./config";
import {
  toOpenAIRequest,
  toAnthropicResponse,
  toAnthropicStream,
  clearToolSchemaCache,
} from "../translator/index";
import { logError } from "./logger";
import type { ModelRouter } from "./model-router";
import type { NimSettings } from "./nim-settings";
import { DEFAULT_NIM_SETTINGS } from "./nim-settings";
import { getRetryBody } from "./retry";
import { stripAliasesFromBody } from "../translator/tool-alias";
import { injectProxyTools, interceptProxyToolResults } from "./proxy-tool";
import { handleModelsRequest } from "./models-handler";
import { FixedWindowRateLimiter } from "./rate-limiter";
import { DASHBOARD_HTML, DASHBOARD_JS } from "../dashboard/dashboard-assets";
import {
  getStats,
  getMetricsSSEStream,
  recordSessionRequest,
  addSessionTokens,
  recordMetric,
} from "../dashboard/index";
import { getCurrentModel, setCurrentModel } from "../api/model-switch";
import {
  encodeNimGatewayModelId,
  decodeNimGatewayModelId,
} from "./gateway-model-ids";
import { state as proxyState } from "./proxy-state";

const NIM_BASE = "https://integrate.api.nvidia.com/v1";
const NIM_CHAT_URL = `${NIM_BASE}/chat/completions`;
export const PORT = 3456;
export const HOST = "127.0.0.1";
const TE = new TextEncoder();

function anthropicError(status: number, message: string): Response {
  const type =
    status === 429
      ? "rate_limit_error"
      : status === 401
        ? "authentication_error"
        : "api_error";
  return new Response(
    JSON.stringify({ type: "error", error: { type, message } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

export interface ServerState {
  router: ModelRouter;
  nimSettings: NimSettings;
  startTime: number;
  requestCount: number;
  rateLimiter: FixedWindowRateLimiter;
}

async function handleMessages(
  req: Request,
  config: Config,
  state: ServerState,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return anthropicError(400, "Invalid JSON body");
  }

  const isStreaming = body.stream !== false;

  await state.rateLimiter.acquireToken();
  state.requestCount++;
  recordSessionRequest();

  injectProxyTools(body);
  await interceptProxyToolResults(body);

  const claudeModel = String(body.model ?? "unknown");
  const resolved = state.router.resolve(claudeModel);

  const openaiBody = toOpenAIRequest(
    body,
    resolved.providerModel,
    state.nimSettings,
  );
  openaiBody.stream = isStreaming;

  const upstreamBody = stripAliasesFromBody(openaiBody);
  const bodyStr = JSON.stringify(upstreamBody);
  const requestStartTime = Date.now();

  const streamAbortController = new AbortController();
  proxyState.activeStreams.add(streamAbortController);

  let nimResponse: Response;

  try {
    nimResponse = await fetch(NIM_CHAT_URL, {
      method: "POST",
      headers: authHeaders(config.apiKey),
      body: bodyStr,
      signal: AbortSignal.any([
        AbortSignal.timeout(60_000),
        streamAbortController.signal,
      ]),
    });

    if (!nimResponse.ok) {
      const errorText = await nimResponse.text();
      const retryBody = getRetryBody(errorText, upstreamBody);
      if (retryBody) {
        nimResponse = await fetch(NIM_CHAT_URL, {
          method: "POST",
          headers: authHeaders(config.apiKey),
          body: JSON.stringify(retryBody),
          signal: AbortSignal.any([
            AbortSignal.timeout(60_000),
            streamAbortController.signal,
          ]),
        });
        if (!nimResponse.ok) {
          const retryError = await nimResponse.text();
          proxyState.activeStreams.delete(streamAbortController);
          return anthropicError(
            nimResponse.status,
            `NVIDIA NIM error (${nimResponse.status}): ${retryError}`,
          );
        }
      } else {
        proxyState.activeStreams.delete(streamAbortController);
        return anthropicError(
          nimResponse.status,
          `NVIDIA NIM error (${nimResponse.status}): ${errorText}`,
        );
      }
    }
  } catch (err) {
    logError("NIM fetch", err);
    proxyState.activeStreams.delete(streamAbortController);
    return anthropicError(502, "Upstream connection failed");
  }

  if (isStreaming) {
    const tokenCounts = { inputTokens: 0, completionTokens: 0 };

    const stream = new ReadableStream({
      async start(controller) {
        try {
          await toAnthropicStream(nimResponse, controller, tokenCounts);
          addSessionTokens(
            tokenCounts.inputTokens + tokenCounts.completionTokens,
          );
          recordMetric({
            model: resolved.providerModel,
            stream: true,
            inputTokens: tokenCounts.inputTokens,
            outputTokens: tokenCounts.completionTokens,
            latencyMs: Date.now() - requestStartTime,
            timeToFirstTokenMs: 0,
            status: "success",
            messageCount: 0,
            contextCharCount: 0,
          });
        } catch (err) {
          logError("stream translation", err);
          if (!streamAbortController.signal.aborted) {
            try {
              controller.error(err);
            } catch {
              /* already closed */
            }
          }
        } finally {
          proxyState.activeStreams.delete(streamAbortController);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  const openaiResult = (await nimResponse.json()) as Record<string, unknown>;
  proxyState.activeStreams.delete(streamAbortController);
  const usage = openaiResult.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  if (usage) {
    addSessionTokens(
      (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
    );
  }
  recordMetric({
    model: resolved.providerModel,
    stream: false,
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    latencyMs: Date.now() - requestStartTime,
    timeToFirstTokenMs: 0,
    status: "success",
    messageCount: 0,
    contextCharCount: 0,
  });
  const anthropicResult = toAnthropicResponse(
    openaiResult,
    resolved.providerModel,
  );

  return new Response(JSON.stringify(anthropicResult), {
    headers: { "Content-Type": "application/json" },
  });
}

function handleModels(_state: ServerState): Promise<Response> {
  return handleModelsRequest();
}

async function handleCountTokens(req: Request): Promise<Response> {
  let inputTokens = 1000;
  try {
    const body = (await req.json()) as { messages?: unknown[] };
    if (Array.isArray(body.messages)) {
      const text = JSON.stringify(body.messages);
      inputTokens = Math.max(1, Math.round(text.length / 4));
    }
  } catch {
    // use default estimate
  }
  const resp = TE.encode(JSON.stringify({ input_tokens: inputTokens }));
  return new Response(resp, {
    headers: { "Content-Type": "application/json" },
  });
}

export function createServer(
  config: Config,
  state?: ServerState,
  port?: number,
): ReturnType<typeof Bun.serve> {
  const serverState: ServerState = state ?? {
    router: {
      resolve: (m: string) => ({
        originalModel: m,
        providerModel: config.model,
      }),
      nimModel: config.model,
      setNimModel: (_m: string) => {},
      setAvailableModels: (_: string[]) => {},
      availableModels: [] as string[],
    } as unknown as ModelRouter,
    nimSettings: DEFAULT_NIM_SETTINGS,
    startTime: Date.now(),
    requestCount: 0,
    rateLimiter: new FixedWindowRateLimiter(),
  };

  return Bun.serve({
    port: port ?? PORT,
    hostname: HOST,
    idleTimeout: 120,

    async fetch(req: Request) {
      const { pathname } = new URL(req.url);

      if (pathname === "/v1/messages" && req.method === "POST") {
        return handleMessages(req, config, serverState);
      }
      if (
        pathname === "/v1/messages" &&
        (req.method === "HEAD" || req.method === "OPTIONS")
      ) {
        return new Response(null, {
          status: 204,
          headers: {
            Allow: "POST, HEAD, OPTIONS",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      if (pathname === "/v1/models" && req.method === "GET") {
        return await handleModels(serverState);
      }
      if (pathname === "/v1/messages/count_tokens" && req.method === "POST") {
        return handleCountTokens(req);
      }
      if (pathname === "/health" && req.method === "GET") {
        return new Response(
          JSON.stringify({ status: "ok", model: serverState.router.nimModel }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (pathname === "/dashboard" && req.method === "GET") {
        return new Response(DASHBOARD_HTML, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (pathname === "/dashboard-client.js" && req.method === "GET") {
        return new Response(DASHBOARD_JS, {
          headers: { "Content-Type": "application/javascript; charset=utf-8" },
        });
      }

      if (pathname === "/api/stats" && req.method === "GET") {
        return new Response(JSON.stringify(getStats()), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      if (pathname === "/api/metrics" && req.method === "GET") {
        return new Response(getMetricsSSEStream(), {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      if (pathname === "/api/model" && req.method === "GET") {
        const model = getCurrentModel() || serverState.router.nimModel;
        const encoded = model ? encodeNimGatewayModelId(model) : model;
        return new Response(JSON.stringify({ model: encoded }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      if (pathname === "/api/model" && req.method === "POST") {
        try {
          const { model } = (await req.json()) as { model: string };
          if (model) {
            const nimModel = decodeNimGatewayModelId(model) ?? model;
            setCurrentModel(nimModel);
            serverState.router.setNimModel(nimModel);
            clearToolSchemaCache();
            return new Response(JSON.stringify({ ok: true, model }), {
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            });
          }
        } catch {}
        return new Response(
          JSON.stringify({ ok: false, error: "invalid body" }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }
      if (pathname === "/api/models" && req.method === "GET") {
        const models = serverState.router.availableModels.map((id: string) => ({
          id: encodeNimGatewayModelId(id),
          display_name: id.split("/").pop() ?? id,
        }));
        return new Response(JSON.stringify(models), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      if (pathname === "/api/key" && req.method === "POST") {
        try {
          const { apiKey } = (await req.json()) as { apiKey: string };
          if (apiKey) {
            config.apiKey = apiKey;
            return new Response(JSON.stringify({ ok: true }), {
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            });
          }
        } catch {}
        return new Response(
          JSON.stringify({ ok: false, error: "invalid body" }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }

      return new Response("Not Found", { status: 404 });
    },

    error(err: Error) {
      logError("server", err);
      return new Response("Internal Server Error", { status: 500 });
    },
  });
}
