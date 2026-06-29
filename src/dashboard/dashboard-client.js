// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details

const $ = (s) => document.getElementById(s);

const isLocal =
  typeof location === "undefined" ||
  location.protocol === "file:" ||
  location.protocol === "vscode-webview:" ||
  location.origin === "null";
const API = isLocal ? "http://127.0.0.1:3456" : location.origin;

let metrics = [];
let logCount = 0;
let autoScroll = true;
let sseConnected = false;
let sseRetryTimer = null;

const fmtNum = (n) =>
  n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n);

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
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h + "h " + m + "m";
};

const fmtCtx = (n) => (n >= 1048576 ? (n / 1048576) + "M" : (n / 1024).toFixed(0) + "K");

function safeEl(id, fn) { var el = $(id); if (el) fn(el); }

function pulse(side) {
  var el = $(side);
  if (!el) return;
  el.classList.remove("active");
  void el.offsetWidth;
  el.classList.add("active");
  setTimeout(() => el.classList.remove("active"), 1200);
}

function addLog(text, cls) {
  var el = document.createElement("div");
  el.className = "line " + (cls || "");
  el.setAttribute("data-level", cls || "info");
  el.innerHTML = '<span class="ts">' + fmtTime(new Date()) + "</span> " + text;
  var logs = $("logs");
  if (!logs) return;
  logs.appendChild(el);
  logCount++;
  safeEl("l-count", (lc) => (lc.textContent = logCount));
  if (logs.children.length > 300) logs.removeChild(logs.firstChild);
  if (autoScroll) logs.scrollTop = logs.scrollHeight;
}

function addRow(m) {
  var tb = $("tb-hist");
  if (!tb) return;
  var tr = document.createElement("tr");
  var cls = m.status === "success" ? "ok" : "err";
  var icon = m.status === "success" ? "&#10003;" : "&#10007;";
  var shortModel = m.model.length > 25 ? m.model.slice(0, 25) + "&#8230;" : m.model;
  tr.innerHTML = "<td>" + metrics.length + "</td><td title='" + m.model + "'>" + shortModel + "</td><td>" + fmtNum(m.inputTokens) + "</td><td>" + fmtNum(m.outputTokens) + "</td><td>" + fmtMs(m.latencyMs) + "</td><td class='" + cls + "'>" + icon + "</td><td>" + fmtTime(new Date(m.timestamp)) + "</td>";
  tr.setAttribute("data-model", m.model);
  tb.appendChild(tr);
  safeEl("h-count", (hc) => (hc.textContent = metrics.length));
  var tbl = $("tbl-hist");
  if (tbl) tbl.scrollTop = tbl.scrollHeight;
}

function updateStats() {
  var tot = 0, tok = 0, totLat = 0, peak = 0, errs = 0;
  for (var i = 0; i < metrics.length; i++) {
    var m = metrics[i];
    tot++;
    tok += m.inputTokens + m.outputTokens;
    totLat += m.latencyMs;
    if (m.status === "error") errs++;
    var tps = m.latencyMs > 0 ? ((m.inputTokens + m.outputTokens) / m.latencyMs) * 1000 : 0;
    if (tps > peak) peak = tps;
  }
  safeEl("s-req", (el) => (el.textContent = fmtNum(tot)));
  safeEl("s-tok", (el) => (el.textContent = fmtNum(tok)));
  safeEl("s-lat", (el) => (el.textContent = tot ? fmtMs(Math.round(totLat / tot)) : "0ms"));
  safeEl("s-tps", (el) => (el.textContent = Math.round(peak)));
}

let serverOffline = false;

function updateUptime() {
  if (serverOffline) return;
  fetch(API + "/api/stats")
    .then((r) => r.json())
    .then((s) => {
      var sec = Math.floor(s.uptimeMs / 1000);
      safeEl("s-up", (el) => (el.textContent = fmtDuration(sec)));
      if (s.totalTokens > 0) {
        var pct = Math.min(100, Math.round((s.totalTokens / 200000) * 100));
        var bar = $("ctx-bar");
        if (bar) { bar.style.width = pct + "%"; bar.title = fmtNum(s.totalTokens) + " / 200K tokens"; }
        safeEl("ctx-label", (l) => (l.textContent = fmtNum(s.totalTokens) + " tokens used"));
      }
    })
    .catch(() => {
      serverOffline = true;
      safeEl("conn-status", (el) => { el.textContent = "Offline"; el.style.color = "var(--err)"; });
      setTimeout(() => { serverOffline = false; updateUptime(); if (!sseConnected) connectSSE(); }, 5000);
    });
}

// Enhanced model catalog with context windows
var FALLBACK_MODELS = [
  { id: "deepseek-ai/deepseek-r1",                                 name: "DeepSeek R1",                   ctx: 131072, tools: true,  vision: false },
  { id: "deepseek-ai/deepseek-v4-flash",                           name: "DeepSeek V4 Flash",              ctx: 131072, tools: true,  vision: false },
  { id: "deepseek-ai/deepseek-v4-pro",                             name: "DeepSeek V4 Pro",                ctx: 131072, tools: true,  vision: false },
  { id: "deepseek-ai/deepseek-r1-distill-llama-70b",              name: "DeepSeek R1 Distill Llama 70B",  ctx: 131072, tools: true,  vision: false },
  { id: "deepseek-ai/deepseek-r1-distill-qwen-32b",               name: "DeepSeek R1 Distill Qwen 32B",   ctx: 131072, tools: true,  vision: false },
  { id: "deepseek-ai/deepseek-coder-6.7b-instruct",               name: "DeepSeek Coder 6.7B",            ctx: 16384,  tools: true,  vision: false },
  { id: "meta/llama-4-maverick-17b-128e-instruct",                name: "Llama 4 Maverick 17B 128E",      ctx: 1048576,tools: true,  vision: true  },
  { id: "meta/llama-3.3-70b-instruct",                            name: "Llama 3.3 70B",                  ctx: 131072, tools: true,  vision: false },
  { id: "meta/llama-3.1-70b-instruct",                            name: "Llama 3.1 70B",                  ctx: 131072, tools: true,  vision: false },
  { id: "meta/llama-3.1-8b-instruct",                             name: "Llama 3.1 8B",                   ctx: 131072, tools: true,  vision: false },
  { id: "meta/llama-3.2-11b-vision-instruct",                     name: "Llama 3.2 11B Vision",           ctx: 131072, tools: false, vision: true  },
  { id: "meta/llama-3.2-90b-vision-instruct",                     name: "Llama 3.2 90B Vision",           ctx: 131072, tools: false, vision: true  },
  { id: "meta/llama2-70b",                                        name: "Llama 2 70B",                    ctx: 4096,   tools: false, vision: false },
  { id: "meta/codellama-70b",                                     name: "Code Llama 70B",                 ctx: 16384,  tools: false, vision: false },
  { id: "qwen/qwen3.5-397b-a17b",                                 name: "Qwen3.5 397B",                   ctx: 131072, tools: true,  vision: false },
  { id: "qwen/qwen3.5-122b-a10b",                                 name: "Qwen3.5 122B",                   ctx: 131072, tools: true,  vision: false },
  { id: "qwen/qwen3-next-80b-a3b-instruct",                       name: "Qwen3 Next 80B",                 ctx: 131072, tools: true,  vision: false },
  { id: "mistralai/mistral-large-3-675b-instruct-2512",           name: "Mistral Large 3 675B",           ctx: 131072, tools: true,  vision: false },
  { id: "mistralai/mistral-large",                                name: "Mistral Large",                  ctx: 131072, tools: true,  vision: false },
  { id: "mistralai/mistral-small-4-119b-2603",                    name: "Mistral Small 4 119B",           ctx: 131072, tools: true,  vision: false },
  { id: "mistralai/mistral-nemotron",                             name: "Mistral Nemotron",               ctx: 131072, tools: true,  vision: false },
  { id: "mistralai/mixtral-8x22b-v0.1",                           name: "Mixtral 8x22B",                  ctx: 65536,  tools: true,  vision: false },
  { id: "mistralai/mixtral-8x7b-instruct-v0.1",                   name: "Mixtral 8x7B",                   ctx: 32768,  tools: true,  vision: false },
  { id: "mistralai/mistral-7b-instruct-v0.3",                     name: "Mistral 7B v0.3",                ctx: 32768,  tools: true,  vision: false },
  { id: "mistralai/codestral-22b-instruct-v0.1",                  name: "Codestral 22B",                  ctx: 32768,  tools: true,  vision: false },
  { id: "mistralai/ministral-14b-instruct-2512",                  name: "Ministral 14B",                  ctx: 131072, tools: true,  vision: false },
  { id: "nv-mistralai/mistral-nemo-12b-instruct",                 name: "Mistral Nemo 12B",               ctx: 128000, tools: true,  vision: false },
  { id: "google/gemma-3-27b-it",                                  name: "Gemma 3 27B",                    ctx: 32768,  tools: true,  vision: false },
  { id: "google/gemma-3-12b-it",                                  name: "Gemma 3 12B",                    ctx: 32768,  tools: true,  vision: false },
  { id: "google/gemma-3-4b-it",                                   name: "Gemma 3 4B",                     ctx: 32768,  tools: true,  vision: false },
  { id: "google/gemma-4-31b-it",                                  name: "Gemma 4 31B",                    ctx: 131072, tools: true,  vision: false },
  { id: "google/gemma-2-27b-it",                                  name: "Gemma 2 27B",                    ctx: 8192,   tools: false, vision: false },
  { id: "google/gemma-2-9b-it",                                   name: "Gemma 2 9B",                     ctx: 8192,   tools: false, vision: false },
  { id: "google/codegemma-7b",                                    name: "CodeGemma 7B",                   ctx: 8192,   tools: false, vision: false },
  { id: "google/gemma-2b",                                        name: "Gemma 2B",                       ctx: 8192,   tools: false, vision: false },
  { id: "google/diffusiongemma-26b-a4b-it",                       name: "DiffusionGemma 26B",             ctx: 8192,   tools: false, vision: true  },
  { id: "nvidia/llama-3.1-nemotron-ultra-253b-v1",                name: "Nemotron Ultra 253B",            ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/llama-3.1-nemotron-70b-instruct",                 name: "Nemotron 70B",                   ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/llama-3.3-nemotron-super-49b-v1",                 name: "Nemotron Super 49B",             ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",          name: "Nemotron 3 Nano Omni 30B",       ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/nemotron-3-super-120b-a12b",                      name: "Nemotron 3 Super 120B",          ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/nemotron-3-ultra-550b-a55b",                      name: "Nemotron 3 Ultra 550B",          ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/nemotron-4-340b-instruct",                        name: "Nemotron 4 340B",                ctx: 4096,   tools: false, vision: false },
  { id: "nvidia/nvidia-nemotron-nano-9b-v2",                      name: "Nemotron Nano 9B v2",            ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/llama-3.1-nemotron-nano-8b-v1",                   name: "Nemotron Nano 8B",               ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/llama-3.1-nemotron-51b-instruct",                 name: "Nemotron 51B",                   ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/cosmos-reason2-8b",                               name: "Cosmos Reason2 8B",              ctx: 131072, tools: false, vision: false },
  { id: "nvidia/mistral-nemo-minitron-8b-8k-instruct",            name: "Mistral Nemo Minitron 8B",       ctx: 8192,   tools: true,  vision: false },
  { id: "nvidia/llama3-chatqa-1.5-70b",                           name: "ChatQA 1.5 70B",                 ctx: 4096,   tools: false, vision: false },
  { id: "minimaxai/minimax-m3",                                   name: "MiniMax M3",                     ctx: 1048576,tools: true,  vision: true  },
  { id: "minimaxai/minimax-m2.7",                                 name: "MiniMax M2.7",                   ctx: 1048576,tools: true,  vision: false },
  { id: "microsoft/phi-4-multimodal-instruct",                    name: "Phi 4 Multimodal",               ctx: 131072, tools: true,  vision: true  },
  { id: "microsoft/phi-4-mini-instruct",                          name: "Phi 4 Mini",                     ctx: 131072, tools: true,  vision: false },
  { id: "microsoft/phi-3.5-moe-instruct",                         name: "Phi 3.5 MoE",                    ctx: 4096,   tools: false, vision: false },
  { id: "moonshotai/kimi-k2.6",                                   name: "Kimi K2.6",                      ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/nemotron-mini-4b-instruct",                       name: "Nemotron Mini 4B",               ctx: 4096,   tools: false, vision: false },
  { id: "01-ai/yi-large",                                         name: "Yi Large",                        ctx: 32768,  tools: true,  vision: false },
  { id: "writer/palmyra-creative-122b",                           name: "Palmyra Creative 122B",          ctx: 131072, tools: false, vision: false },
  { id: "writer/palmyra-fin-70b-32k",                             name: "Palmyra Fin 70B 32K",            ctx: 32768,  tools: false, vision: false },
  { id: "writer/palmyra-med-70b",                                 name: "Palmyra Med 70B",                ctx: 32768,  tools: false, vision: false },
  { id: "writer/palmyra-med-70b-32k",                             name: "Palmyra Med 70B 32K",            ctx: 32768,  tools: false, vision: false },
  { id: "upstage/solar-10.7b-instruct",                           name: "Solar 10.7B",                    ctx: 4096,   tools: false, vision: false },
  { id: "abacusai/dracarys-llama-3.1-70b-instruct",              name: "Dracarys Llama 3.1 70B",         ctx: 131072, tools: true,  vision: false },
  { id: "aisingapore/sea-lion-7b-instruct",                       name: "SEA-LION 7B",                    ctx: 32768,  tools: true,  vision: false },
  { id: "ai21labs/jamba-1.5-large-instruct",                      name: "Jamba 1.5 Large",                ctx: 262144, tools: true,  vision: false },
  { id: "bigcode/starcoder2-15b",                                 name: "StarCoder2 15B",                 ctx: 16384,  tools: false, vision: false },
  { id: "bytedance/seed-oss-36b-instruct",                        name: "Seed OSS 36B",                   ctx: 131072, tools: true,  vision: false },
  { id: "databricks/dbrx-instruct",                               name: "DBRX Instruct",                  ctx: 32768,  tools: true,  vision: false },
  { id: "ibm/granite-3.0-8b-instruct",                            name: "Granite 3.0 8B",                 ctx: 8192,   tools: false, vision: false },
  { id: "ibm/granite-34b-code-instruct",                          name: "Granite 34B Code",               ctx: 8192,   tools: false, vision: false },
  { id: "stepfun-ai/step-3.7-flash",                              name: "Step 3.7 Flash",                 ctx: 8192,   tools: false, vision: false },
  { id: "stepfun-ai/step-3.5-flash",                              name: "Step 3.5 Flash",                 ctx: 8192,   tools: false, vision: false },
  { id: "stockmark/stockmark-2-100b-instruct",                    name: "Stockmark 2 100B",               ctx: 32768,  tools: false, vision: false },
  { id: "sarvamai/sarvam-m",                                      name: "Sarvam M",                       ctx: 32768,  tools: false, vision: false },
  { id: "z-ai/glm-5.1",                                           name: "GLM 5.1",                        ctx: 131072, tools: true,  vision: false },
  { id: "zyphra/zamba2-7b-instruct",                              name: "Zamba2 7B",                      ctx: 32768,  tools: false, vision: false },
  { id: "openai/gpt-oss-20b",                                     name: "GPT OSS 20B",                    ctx: 8192,   tools: false, vision: false },
  { id: "openai/gpt-oss-120b",                                    name: "GPT OSS 120B",                   ctx: 8192,   tools: false, vision: false },
];

function getProvider(id) {
  var s = id.indexOf("/");
  return s > 0 ? id.substring(0, s) : "other";
}

function showModelDetail() {
  var sel = $("sel-model");
  var detail = $("model-detail");
  if (!sel || !detail) return;
  var val = sel.value;
  if (!val) { detail.style.display = "none"; return; }

  // Find model in our data
  var m = FALLBACK_MODELS.find(function (x) { return x.id === val; });
  if (!m) {
    // Model from live proxy — build basic info
    detail.style.display = "block";
    detail.innerHTML = "<span class='lbl'>Model:</span> <span class='val'>" + val + "</span>";
    return;
  }

  var provider = getProvider(m.id);
  var tools = m.tools !== false;
  var vision = !!m.vision;
  var ctx = m.ctx || 131072;
  detail.style.display = "block";
  detail.innerHTML =
    "<div style='color:#fff;font-weight:600;margin-bottom:4px'>" + m.name + "</div>" +
    "<span class='lbl'>Provider:</span> <span class='val'>" + provider + "</span><span class='gap'></span>" +
    "<span class='lbl'>Context:</span> <span class='val'>" + fmtCtx(ctx) + "</span><span class='gap'></span>" +
    "<span class='lbl'>Tools:</span> <span class='tag " + (tools ? "tag-ok" : "tag-na") + "'>" + (tools ? "Supported" : "N/A") + "</span><span class='gap'></span>" +
    "<span class='lbl'>Vision:</span> <span class='tag " + (vision ? "tag-ok" : "tag-na") + "'>" + (vision ? "Supported" : "N/A") + "</span>";
}

function loadModels() {
  var sel = $("sel-model");
  if (!sel) return;

  function populateSelect(models) {
    sel.innerHTML = "";
    var groups = {};
    models.forEach(function (m) {
      var provider = getProvider(m.id);
      if (!groups[provider]) groups[provider] = [];
      groups[provider].push(m);
    });
    var order = ["deepseek-ai", "meta", "qwen", "mistralai", "google", "nvidia", "minimaxai", "microsoft", "moonshotai", "other"];
    order.forEach(function (provider) {
      if (!groups[provider]) return;
      var og = document.createElement("optgroup");
      og.label = provider + " (" + groups[provider].length + ")";
      groups[provider].sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
      groups[provider].forEach(function (m) {
        var o = document.createElement("option");
        o.value = m.id;
        o.textContent = m.name + "  [" + fmtCtx(m.ctx || 131072) + "]  (" + m.id + ")";
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
  }

  populateSelect(FALLBACK_MODELS);

  if (!serverOffline) {
    fetch(API + "/api/models", { signal: AbortSignal.timeout(3000) })
      .then(function (r) {
        if (!r.ok) throw new Error("proxy offline");
        return r.json();
      })
      .then(function (arr) {
        if (Array.isArray(arr) && arr.length) {
          var enriched = arr.map(function (m) {
            var match = FALLBACK_MODELS.find(function (f) { return f.id === m.id; });
            return { id: m.id, name: m.display_name || m.name || m.id.split("/").pop(), ctx: (match && match.ctx) || 131072, tools: match ? match.tools !== false : true, vision: match ? !!match.vision : false };
          });
          populateSelect(enriched);
        }
        return fetch(API + "/api/model", { signal: AbortSignal.timeout(3000) });
      })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.model && sel) {
          sel.value = d.model;
          showModelDetail();
          safeEl("active-model", (am) => (am.textContent = d.model));
        }
      })
      .catch(function () {});
  }
}

function connectSSE() {
  if (serverOffline) return;
  if (sseRetryTimer) { clearTimeout(sseRetryTimer); sseRetryTimer = null; }
  var connectionTime = Date.now();
  var es = new EventSource(API + "/api/metrics");

  es.onopen = function () {
    if (!sseConnected) { addLog("SSE connected", "ok"); sseConnected = true; }
    safeEl("conn-status", function (el) { el.textContent = "Connected"; el.style.color = "var(--ok)"; });
  };

  es.onmessage = function (e) {
    try {
      var m = JSON.parse(e.data);
      metrics.push(m);
      addRow(m);
      updateStats();
      var isHistorical = m.timestamp && (m.timestamp < connectionTime - 2000);
      if (!isHistorical) {
        pulse(m.stream ? "conn-right" : "conn-left");
        addLog("&larr; " + m.model + " " + fmtNum(m.inputTokens + m.outputTokens) + " tok " + fmtMs(m.latencyMs), m.status === "success" ? "ok" : "err");
      }
    } catch {}
  };

  es.onerror = function () {
    es.close();
    sseConnected = false;
    serverOffline = true;
    safeEl("conn-status", function (el) { el.textContent = "Offline"; el.style.color = "var(--err)"; });
    if (sseRetryTimer) { clearTimeout(sseRetryTimer); sseRetryTimer = null; }
    addLog("SSE disconnected. Server offline.", "warn");
  };
}

// Controls
var btnApply = $("btn-apply");
if (btnApply) {
  btnApply.onclick = function () {
    var sel = $("sel-model");
    if (!sel) return;
    var model = sel.value;
    if (!model) return;
    btnApply.textContent = "Applying...";
    btnApply.disabled = true;
    fetch(API + "/api/model", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) { addLog("Model set: " + model, "ok"); safeEl("active-model", function (am) { am.textContent = model; }); }
        else addLog("Failed: " + (d.error || "unknown"), "err");
      })
      .catch(function () { addLog("Failed to set model", "err"); })
      .finally(function () { btnApply.textContent = "Apply"; btnApply.disabled = false; });
  };
}

var btnKey = $("btn-key");
if (btnKey) {
  btnKey.onclick = function () {
    var inp = $("inp-key");
    if (!inp) return;
    var apiKey = inp.value.trim();
    if (!apiKey) return;
    btnKey.textContent = "Updating...";
    btnKey.disabled = true;
    fetch(API + "/api/key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) { addLog("API key updated", "ok"); inp.value = ""; }
        else addLog("Failed: " + (d.error || "unknown"), "err");
      })
      .catch(function () { addLog("Failed to update key", "err"); })
      .finally(function () { btnKey.textContent = "Update"; btnKey.disabled = false; });
  };
}

var btnClear = $("btn-clear");
if (btnClear) {
  btnClear.onclick = function () {
    metrics = [];
    safeEl("tb-hist", function (tb) { tb.innerHTML = ""; });
    logCount = 0;
    safeEl("l-count", function (lc) { lc.textContent = "0"; });
    safeEl("h-count", function (hc) { hc.textContent = "0"; });
    safeEl("logs", function (logs) { logs.innerHTML = ""; });
    updateStats();
    addLog("History cleared", "info");
  };
}

var btnExport = $("btn-export");
if (btnExport) {
  btnExport.onclick = function () {
    if (!metrics.length) return;
    var blob = new Blob([JSON.stringify(metrics, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "claude-nim-metrics-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(url);
    addLog("Exported " + metrics.length + " metrics", "ok");
  };
}

window.addEventListener("DOMContentLoaded", function () {
  loadModels();
  connectSSE();
  setInterval(updateUptime, 1000);
  updateUptime();
  addLog("Dashboard connected", "info");
});
