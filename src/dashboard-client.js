// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details

const $ = (s) => document.getElementById(s);

// When opened from disk (file://) or VS Code Preview (vscode-webview:), origin is invalid.
// Fall back to the known proxy address so all API calls reach the running server.
const isLocal =
  typeof location === "undefined" ||
  location.protocol === "file:" ||
  location.protocol === "vscode-webview:" ||
  location.origin === "null";
const API = isLocal ? "http://127.0.0.1:3456" : location.origin;

let metrics = [];
let logCount = 0;
let autoScroll = true;
let logFilter = "all";
let sseConnected = false;
let sseRetryTimer = null;

// ============================================================================
// Format Helpers
// ============================================================================

const fmtNum = (n) =>
  n >= 1e6
    ? (n / 1e6).toFixed(1) + "M"
    : n >= 1e3
      ? (n / 1e3).toFixed(1) + "K"
      : String(n);

const fmtMs = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : ms + "ms");

const fmtTime = (d) => {
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  const s = d.getSeconds().toString().padStart(2, "0");
  return h + ":" + m + ":" + s;
};

const fmtDuration = (sec) => {
  if (sec < 60) return sec + "s";
  if (sec < 3600) return Math.floor(sec / 60) + "m " + (sec % 60) + "s";
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  return h + "h " + m + "m";
};

// ============================================================================
// DOM Helpers
// ============================================================================

function safeEl(id, fn) {
  var el = $(id);
  if (el) fn(el);
}

// ============================================================================
// Packet Animation
// ============================================================================

function pulse(side) {
  var el = $(side);
  if (!el) return;
  el.classList.remove("active");
  void el.offsetWidth; // force reflow
  el.classList.add("active");
  setTimeout(() => el.classList.remove("active"), 1200);
}

// ============================================================================
// Logs
// ============================================================================

function addLog(text, cls) {
  var el = document.createElement("div");
  el.className = "line " + (cls || "");
  el.setAttribute("data-level", cls || "info");
  el.innerHTML = '<span class="ts">' + fmtTime(new Date()) + "</span> " + text;

  var logs = $("logs");
  if (!logs) return;

  // Apply current filter
  if (logFilter !== "all" && cls !== logFilter) {
    el.style.display = "none";
  }

  logs.appendChild(el);
  logCount++;
  safeEl("l-count", (lc) => (lc.textContent = logCount));

  // Trim old logs
  if (logs.children.length > 300) logs.removeChild(logs.firstChild);
  if (autoScroll) logs.scrollTop = logs.scrollHeight;
}

// ============================================================================
// Request History Table
// ============================================================================

function addRow(m) {
  var tb = $("tb-hist");
  if (!tb) return;
  var tr = document.createElement("tr");
  var cls = m.status === "success" ? "ok" : "err";
  var icon = m.status === "success" ? "&#10003;" : "&#10007;";
  var shortModel =
    m.model.length > 20 ? m.model.slice(0, 20) + "&#8230;" : m.model;

  tr.innerHTML =
    "<td>" +
    metrics.length +
    "</td><td title='" +
    m.model +
    "'>" +
    shortModel +
    "</td><td>" +
    fmtNum(m.inputTokens) +
    "</td><td>" +
    fmtNum(m.outputTokens) +
    "</td><td>" +
    fmtMs(m.latencyMs) +
    "</td><td class='" +
    cls +
    "'>" +
    icon +
    "</td><td>" +
    fmtTime(new Date(m.timestamp)) +
    "</td>";

  tr.setAttribute("data-model", m.model);

  tb.appendChild(tr);
  safeEl("h-count", (hc) => (hc.textContent = metrics.length));

  var tbl = $("tbl-hist");
  if (tbl) tbl.scrollTop = tbl.scrollHeight;
}

// ============================================================================
// Stats
// ============================================================================

function updateStats() {
  var tot = 0,
    tok = 0,
    totLat = 0,
    peak = 0,
    errs = 0;
  for (var i = 0; i < metrics.length; i++) {
    var m = metrics[i];
    tot++;
    tok += m.inputTokens + m.outputTokens;
    totLat += m.latencyMs;
    if (m.status === "error") errs++;
    var tps =
      m.latencyMs > 0
        ? ((m.inputTokens + m.outputTokens) / m.latencyMs) * 1000
        : 0;
    if (tps > peak) peak = tps;
  }
  safeEl("s-req", (el) => (el.textContent = fmtNum(tot)));
  safeEl("s-tok", (el) => (el.textContent = fmtNum(tok)));
  safeEl(
    "s-lat",
    (el) => (el.textContent = tot ? fmtMs(Math.round(totLat / tot)) : "0ms"),
  );
  safeEl("s-tps", (el) => (el.textContent = Math.round(peak)));
  safeEl(
    "s-err",
    (el) =>
      (el.textContent = tot ? Math.round((errs / tot) * 100) + "%" : "0%"),
  );
}

// ============================================================================
// Uptime & Connection State
// ============================================================================

let serverOffline = false;

function updateUptime() {
  if (serverOffline) return;
  fetch(API + "/api/stats")
    .then((r) => r.json())
    .then((s) => {
      var sec = Math.floor(s.uptimeMs / 1000);
      safeEl("s-up", (el) => (el.textContent = fmtDuration(sec)));

      // Context window bar
      if (s.totalTokens > 0) {
        var pct = Math.min(100, Math.round((s.totalTokens / 200000) * 100));
        var bar = $("ctx-bar");
        if (bar) {
          bar.style.width = pct + "%";
          bar.title = fmtNum(s.totalTokens) + " / 200K tokens";
        }
        var lbl = $("ctx-label");
        if (lbl) lbl.textContent = fmtNum(s.totalTokens) + " tokens used";
      }
    })
    .catch(() => {
      // If server is offline, pause polling to prevent ERR_CONNECTION_REFUSED spam
      serverOffline = true;
      safeEl("conn-status", (el) => {
        el.textContent = "Offline";
        el.style.color = "var(--err)";
      });
      setTimeout(() => {
        serverOffline = false;
        updateUptime();
        if (!sseConnected) connectSSE();
      }, 5000);
    });
}

// Complete NIM model list — sourced from live API, updated June 2026
// 110+ models across all providers. Auto-refreshed by proxy when online.
var FALLBACK_MODELS = [
  // ── 01-AI ─────────────────────────────────────────────
  { id: "01-ai/yi-large",                                         name: "Yi Large" },
  // ── AbacusAI ──────────────────────────────────────────
  { id: "abacusai/dracarys-llama-3.1-70b-instruct",               name: "Dracarys Llama 3.1 70B" },
  // ── AI Singapore ──────────────────────────────────────
  { id: "aisingapore/sea-lion-7b-instruct",                       name: "SEA-LION 7B" },
  // ── AI21 Labs ─────────────────────────────────────────
  { id: "ai21labs/jamba-1.5-large-instruct",                      name: "Jamba 1.5 Large" },
  // ── BigCode ───────────────────────────────────────────
  { id: "bigcode/starcoder2-15b",                                 name: "StarCoder2 15B" },
  // ── ByteDance ─────────────────────────────────────────
  { id: "bytedance/seed-oss-36b-instruct",                        name: "Seed OSS 36B" },
  // ── Databricks ────────────────────────────────────────
  { id: "databricks/dbrx-instruct",                               name: "DBRX Instruct" },
  // ── DeepSeek ──────────────────────────────────────────
  { id: "deepseek-ai/deepseek-coder-6.7b-instruct",               name: "DeepSeek Coder 6.7B" },
  { id: "deepseek-ai/deepseek-r1",                                name: "DeepSeek R1" },
  { id: "deepseek-ai/deepseek-r1-distill-llama-70b",              name: "DeepSeek R1 Distill Llama 70B" },
  { id: "deepseek-ai/deepseek-r1-distill-qwen-32b",               name: "DeepSeek R1 Distill Qwen 32B" },
  { id: "deepseek-ai/deepseek-v4-flash",                          name: "DeepSeek V4 Flash" },
  { id: "deepseek-ai/deepseek-v4-pro",                            name: "DeepSeek V4 Pro" },
  // ── Google Gemma (ALL variants) ───────────────────────
  { id: "google/codegemma-1.1-7b",                                name: "CodeGemma 1.1 7B" },
  { id: "google/codegemma-7b",                                    name: "CodeGemma 7B" },
  { id: "google/diffusiongemma-26b-a4b-it",                       name: "DiffusionGemma 26B" },
  { id: "google/gemma-2b",                                        name: "Gemma 2B" },
  { id: "google/gemma-2-2b-it",                                   name: "Gemma 2 2B" },
  { id: "google/gemma-2-9b-it",                                   name: "Gemma 2 9B" },
  { id: "google/gemma-2-27b-it",                                  name: "Gemma 2 27B" },
  { id: "google/gemma-3-4b-it",                                   name: "Gemma 3 4B" },
  { id: "google/gemma-3-12b-it",                                  name: "Gemma 3 12B" },
  { id: "google/gemma-3-27b-it",                                  name: "Gemma 3 27B" },
  { id: "google/gemma-3n-e2b-it",                                 name: "Gemma 3n E2B" },
  { id: "google/gemma-3n-e4b-it",                                 name: "Gemma 3n E4B" },
  { id: "google/gemma-4-31b-it",                                  name: "Gemma 4 31B" },
  { id: "google/recurrentgemma-2b",                               name: "RecurrentGemma 2B" },
  // ── IBM Granite ───────────────────────────────────────
  { id: "ibm/granite-3.0-3b-a800m-instruct",                      name: "Granite 3.0 3B" },
  { id: "ibm/granite-3.0-8b-instruct",                            name: "Granite 3.0 8B" },
  { id: "ibm/granite-34b-code-instruct",                          name: "Granite 34B Code" },
  { id: "ibm/granite-8b-code-instruct",                           name: "Granite 8B Code" },
  // ── Meta Llama ────────────────────────────────────────
  { id: "meta/codellama-70b",                                     name: "Code Llama 70B" },
  { id: "meta/llama2-70b",                                        name: "Llama 2 70B" },
  { id: "meta/llama-3.1-8b-instruct",                             name: "Llama 3.1 8B" },
  { id: "meta/llama-3.1-70b-instruct",                            name: "Llama 3.1 70B" },
  { id: "meta/llama-3.2-1b-instruct",                             name: "Llama 3.2 1B" },
  { id: "meta/llama-3.2-3b-instruct",                             name: "Llama 3.2 3B" },
  { id: "meta/llama-3.2-11b-vision-instruct",                     name: "Llama 3.2 11B Vision" },
  { id: "meta/llama-3.2-90b-vision-instruct",                     name: "Llama 3.2 90B Vision" },
  { id: "meta/llama-3.3-70b-instruct",                            name: "Llama 3.3 70B" },
  { id: "meta/llama-4-maverick-17b-128e-instruct",                name: "Llama 4 Maverick 17B" },
  // ── Microsoft ─────────────────────────────────────────
  { id: "microsoft/phi-3.5-moe-instruct",                         name: "Phi 3.5 MoE" },
  { id: "microsoft/phi-4-mini-instruct",                          name: "Phi 4 Mini" },
  { id: "microsoft/phi-4-multimodal-instruct",                    name: "Phi 4 Multimodal" },
  // ── MiniMax (ALL) ─────────────────────────────────────
  { id: "minimaxai/minimax-m2.7",                                 name: "MiniMax M2.7" },
  { id: "minimaxai/minimax-m3",                                   name: "MiniMax M3" },
  // ── Mistral AI ────────────────────────────────────────
  { id: "mistralai/codestral-22b-instruct-v0.1",                  name: "Codestral 22B" },
  { id: "mistralai/ministral-14b-instruct-2512",                  name: "Ministral 14B" },
  { id: "mistralai/mistral-7b-instruct-v0.3",                     name: "Mistral 7B v0.3" },
  { id: "mistralai/mistral-large",                                name: "Mistral Large" },
  { id: "mistralai/mistral-large-2-instruct",                     name: "Mistral Large 2" },
  { id: "mistralai/mistral-large-3-675b-instruct-2512",           name: "Mistral Large 3 675B" },
  { id: "mistralai/mistral-medium-3.5-128b",                      name: "Mistral Medium 3.5 128B" },
  { id: "mistralai/mistral-nemotron",                             name: "Mistral Nemotron" },
  { id: "mistralai/mistral-small-4-119b-2603",                    name: "Mistral Small 4 119B" },
  { id: "mistralai/mixtral-8x7b-instruct-v0.1",                   name: "Mixtral 8x7B" },
  { id: "mistralai/mixtral-8x22b-v0.1",                           name: "Mixtral 8x22B" },
  { id: "nv-mistralai/mistral-nemo-12b-instruct",                 name: "Mistral Nemo 12B" },
  // ── MoonShot ──────────────────────────────────────────
  { id: "moonshotai/kimi-k2.6",                                   name: "Kimi K2.6" },
  // ── NVIDIA Nemotron ───────────────────────────────────
  { id: "nvidia/cosmos-reason2-8b",                               name: "Cosmos Reason2 8B" },
  { id: "nvidia/llama-3.1-nemotron-51b-instruct",                 name: "Nemotron 51B" },
  { id: "nvidia/llama-3.1-nemotron-70b-instruct",                 name: "Nemotron 70B" },
  { id: "nvidia/llama-3.1-nemotron-nano-8b-v1",                   name: "Nemotron Nano 8B" },
  { id: "nvidia/llama-3.1-nemotron-ultra-253b-v1",                name: "Nemotron Ultra 253B" },
  { id: "nvidia/llama-3.3-nemotron-super-49b-v1",                 name: "Nemotron Super 49B" },
  { id: "nvidia/llama-3.3-nemotron-super-49b-v1.5",               name: "Nemotron Super 49B v1.5" },
  { id: "nvidia/llama3-chatqa-1.5-70b",                           name: "ChatQA 1.5 70B" },
  { id: "nvidia/mistral-nemo-minitron-8b-8k-instruct",            name: "Mistral Nemo Minitron 8B" },
  { id: "nvidia/nemotron-3-nano-30b-a3b",                         name: "Nemotron 3 Nano 30B" },
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",          name: "Nemotron 3 Nano Omni 30B" },
  { id: "nvidia/nemotron-3-super-120b-a12b",                      name: "Nemotron 3 Super 120B" },
  { id: "nvidia/nemotron-3-ultra-550b-a55b",                      name: "Nemotron 3 Ultra 550B" },
  { id: "nvidia/nemotron-4-340b-instruct",                        name: "Nemotron 4 340B" },
  { id: "nvidia/nemotron-mini-4b-instruct",                       name: "Nemotron Mini 4B" },
  { id: "nvidia/nemotron-nano-3-30b-a3b",                         name: "Nemotron Nano 3 30B" },
  { id: "nvidia/nvidia-nemotron-nano-9b-v2",                      name: "Nemotron Nano 9B v2" },
  { id: "nvidia/ising-calibration-1-35b-a3b",                     name: "Ising Calibration 35B" },
  // ── OpenAI OSS (via NIM) ──────────────────────────────
  { id: "openai/gpt-oss-20b",                                     name: "GPT OSS 20B" },
  { id: "openai/gpt-oss-120b",                                    name: "GPT OSS 120B" },
  // ── Qwen (ALL) ────────────────────────────────────────
  { id: "qwen/qwen3-next-80b-a3b-instruct",                       name: "Qwen3 Next 80B" },
  { id: "qwen/qwen3.5-122b-a10b",                                 name: "Qwen3.5 122B" },
  { id: "qwen/qwen3.5-397b-a17b",                                 name: "Qwen3.5 397B" },
  // ── Sarvam ────────────────────────────────────────────
  { id: "sarvamai/sarvam-m",                                      name: "Sarvam M" },
  // ── StepFun ───────────────────────────────────────────
  { id: "stepfun-ai/step-3.5-flash",                              name: "Step 3.5 Flash" },
  { id: "stepfun-ai/step-3.7-flash",                              name: "Step 3.7 Flash" },
  // ── Stockmark ─────────────────────────────────────────
  { id: "stockmark/stockmark-2-100b-instruct",                    name: "Stockmark 2 100B" },
  // ── Upstage ───────────────────────────────────────────
  { id: "upstage/solar-10.7b-instruct",                           name: "Solar 10.7B" },
  // ── Writer ────────────────────────────────────────────
  { id: "writer/palmyra-creative-122b",                           name: "Palmyra Creative 122B" },
  { id: "writer/palmyra-fin-70b-32k",                             name: "Palmyra Fin 70B" },
  { id: "writer/palmyra-med-70b",                                 name: "Palmyra Med 70B" },
  { id: "writer/palmyra-med-70b-32k",                             name: "Palmyra Med 70B 32K" },
  // ── Z-AI ──────────────────────────────────────────────
  { id: "z-ai/glm-5.1",                                           name: "GLM 5.1" },
  // ── Zyphra ────────────────────────────────────────────
  { id: "zyphra/zamba2-7b-instruct",                              name: "Zamba2 7B" },
];

function loadModels() {
  var sel = $("sel-model");
  if (!sel) return;

  function populateSelect(models) {
    sel.innerHTML = "";
    var groups = {};
    models.forEach(function (m) {
      var parts = m.id.split("/");
      var provider = parts.length > 1 ? parts[0] : "other";
      if (!groups[provider]) groups[provider] = [];
      groups[provider].push(m);
    });
    Object.keys(groups).sort().forEach(function (provider) {
      var og = document.createElement("optgroup");
      og.label = provider + " (" + groups[provider].length + ")";
      groups[provider].forEach(function (m) {
        var o = document.createElement("option");
        o.value = m.id;
        o.textContent = (m.display_name || m.name || m.id.split("/").pop()) + " (" + m.id + ")";
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
  }

  // Always populate with the embedded list first — zero network needed
  populateSelect(FALLBACK_MODELS);

  // If the proxy is online, ask it for the current active model and its
  // (potentially more up-to-date) model list. Never fetch NIM directly from
  // a null/file:// origin — that always fails with a CORS error.
  if (!serverOffline) {
    fetch(API + "/api/models", { signal: AbortSignal.timeout(3000) })
      .then(function (r) {
        if (!r.ok) throw new Error("proxy offline");
        return r.json();
      })
      .then(function (arr) {
        if (Array.isArray(arr) && arr.length) populateSelect(arr);
        return fetch(API + "/api/model", { signal: AbortSignal.timeout(3000) });
      })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.model && sel) {
          sel.value = d.model;
          // Update active model display
          var am = $("active-model");
          if (am) am.textContent = d.model;
        }
      })
      .catch(function () {
        // Proxy isn't running — keep the embedded fallback list visible.
        // The uptime poller will retry and reload models when it comes back.
      });
  }
}

// ============================================================================
// SSE — Smart Reconnection with Exponential Backoff
// ============================================================================

function connectSSE() {
  if (serverOffline) return;

  if (sseRetryTimer) {
    clearTimeout(sseRetryTimer);
    sseRetryTimer = null;
  }

  var es = new EventSource(API + "/api/metrics");

  es.onopen = () => {
    if (!sseConnected) {
      addLog("SSE connected", "ok");
      sseConnected = true;
    }
    // Update connection indicator
    var ci = $("conn-status");
    if (ci) {
      ci.textContent = "Connected";
      ci.style.color = "var(--ok)";
    }
  };

  es.onmessage = (e) => {
    try {
      var m = JSON.parse(e.data);
      metrics.push(m);
      addRow(m);
      updateStats();
      pulse(m.stream ? "conn-right" : "conn-left");
      var cls = m.status === "success" ? "ok" : "err";
      addLog(
        (m.stream ? "&#8594; " : "&#8592; ") +
          m.model +
          " " +
          fmtNum(m.inputTokens + m.outputTokens) +
          " tok " +
          fmtMs(m.latencyMs),
        cls,
      );
    } catch {}
  };

  es.onerror = () => {
    es.close();
    sseConnected = false;
    serverOffline = true;

    // Update connection indicator
    var ci = $("conn-status");
    if (ci) {
      ci.textContent = "Offline";
      ci.style.color = "var(--err)";
    }

    if (sseRetryTimer) {
      clearTimeout(sseRetryTimer);
      sseRetryTimer = null;
    }

    addLog("SSE disconnected. Server is offline.", "warn");
  };
}

// ============================================================================
// Controls — Model Apply
// ============================================================================

var btnApply = $("btn-apply");
if (btnApply) {
  btnApply.onclick = () => {
    var sel = $("sel-model");
    if (!sel) return;
    var model = sel.value;
    if (!model) return;
    btnApply.textContent = "Applying...";
    btnApply.disabled = true;
    fetch(API + "/api/model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          addLog("Model set: " + model, "ok");
          var am = $("active-model");
          if (am) am.textContent = model;
        } else addLog("Failed to set model: " + (d.error || "unknown"), "err");
      })
      .catch(() => addLog("Failed to set model", "err"))
      .finally(() => {
        btnApply.textContent = "Apply";
        btnApply.disabled = false;
      });
  };
}

// ============================================================================
// Controls — API Key
// ============================================================================

var btnKey = $("btn-key");
if (btnKey) {
  btnKey.onclick = () => {
    var inp = $("inp-key");
    if (!inp) return;
    var apiKey = inp.value.trim();
    if (!apiKey) return;
    btnKey.textContent = "Updating...";
    btnKey.disabled = true;
    fetch(API + "/api/key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          addLog("API key updated", "ok");
          inp.value = "";
        } else {
          addLog("Failed to update key: " + (d.error || "unknown"), "err");
        }
      })
      .catch(() => addLog("Failed to update key", "err"))
      .finally(() => {
        btnKey.textContent = "Update";
        btnKey.disabled = false;
      });
  };
}

// ============================================================================
// Controls — Clear History
// ============================================================================

var btnClear = $("btn-clear");
if (btnClear) {
  btnClear.onclick = () => {
    metrics = [];
    var tb = $("tb-hist");
    if (tb) tb.innerHTML = "";
    logCount = 0;
    var lc = $("l-count");
    if (lc) lc.textContent = "0";
    var logs = $("logs");
    if (logs) logs.innerHTML = "";
    updateStats();
    addLog("History cleared", "info");
  };
}

// ============================================================================
// Controls — Auto-Scroll Toggle
// ============================================================================

var btnScroll = $("btn-scroll");
if (btnScroll) {
  btnScroll.onclick = () => {
    autoScroll = !autoScroll;
    btnScroll.textContent = autoScroll ? "Auto-Scroll: ON" : "Auto-Scroll: OFF";
    btnScroll.style.color = autoScroll ? "var(--ok)" : "var(--dim)";
  };
}

// ============================================================================
// Controls — Export Metrics
// ============================================================================

var btnExport = $("btn-export");
if (btnExport) {
  btnExport.onclick = () => {
    if (!metrics.length) return;
    var blob = new Blob([JSON.stringify(metrics, null, 2)], {
      type: "application/json",
    });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download =
      "claude-nim-metrics-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(url);
    addLog("Exported " + metrics.length + " metrics", "ok");
  };
}

// ============================================================================
// Init
// ============================================================================

window.addEventListener("DOMContentLoaded", () => {
  loadModels();
  connectSSE();
  setInterval(updateUptime, 1000);
  updateUptime();
  addLog("Dashboard connected", "info");
});
