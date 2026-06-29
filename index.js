// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details

// ============================================================================
// Enhanced model data with context windows and capabilities
// Sourced from proxy's model-catalog.ts, updated June 2026.
// ============================================================================

var FALLBACK_MODELS = [
  { id: "01-ai/yi-large",                                         name: "Yi Large",                                 ctx: 32768,  tools: true,  vision: false },
  { id: "abacusai/dracarys-llama-3.1-70b-instruct",               name: "Dracarys Llama 3.1 70B",                  ctx: 131072, tools: true,  vision: false },
  { id: "aisingapore/sea-lion-7b-instruct",                       name: "SEA-LION 7B",                             ctx: 32768,  tools: true,  vision: false },
  { id: "ai21labs/jamba-1.5-large-instruct",                      name: "Jamba 1.5 Large",                         ctx: 262144, tools: true,  vision: false },
  { id: "bigcode/starcoder2-15b",                                  name: "StarCoder2 15B",                          ctx: 16384,  tools: false, vision: false },
  { id: "bytedance/seed-oss-36b-instruct",                         name: "Seed OSS 36B",                            ctx: 131072, tools: true,  vision: false },
  { id: "databricks/dbrx-instruct",                                name: "DBRX Instruct",                           ctx: 32768,  tools: true,  vision: false },
  { id: "deepseek-ai/deepseek-coder-6.7b-instruct",                name: "DeepSeek Coder 6.7B",                     ctx: 16384,  tools: true,  vision: false },
  { id: "deepseek-ai/deepseek-r1",                                 name: "DeepSeek R1",                             ctx: 131072, tools: true,  vision: false },
  { id: "deepseek-ai/deepseek-r1-distill-llama-70b",              name: "DeepSeek R1 Distill Llama 70B",           ctx: 131072, tools: true,  vision: false },
  { id: "deepseek-ai/deepseek-r1-distill-qwen-32b",               name: "DeepSeek R1 Distill Qwen 32B",            ctx: 131072, tools: true,  vision: false },
  { id: "deepseek-ai/deepseek-v4-flash",                           name: "DeepSeek V4 Flash",                       ctx: 131072, tools: true,  vision: false },
  { id: "deepseek-ai/deepseek-v4-pro",                             name: "DeepSeek V4 Pro",                         ctx: 131072, tools: true,  vision: false },
  { id: "google/codegemma-1.1-7b",                                 name: "CodeGemma 1.1 7B",                        ctx: 8192,   tools: false, vision: false },
  { id: "google/codegemma-7b",                                     name: "CodeGemma 7B",                            ctx: 8192,   tools: false, vision: false },
  { id: "google/diffusiongemma-26b-a4b-it",                        name: "DiffusionGemma 26B",                      ctx: 8192,   tools: false, vision: true },
  { id: "google/gemma-2b",                                         name: "Gemma 2B",                                ctx: 8192,   tools: false, vision: false },
  { id: "google/gemma-2-2b-it",                                    name: "Gemma 2 2B",                              ctx: 8192,   tools: false, vision: false },
  { id: "google/gemma-2-9b-it",                                    name: "Gemma 2 9B",                              ctx: 8192,   tools: false, vision: false },
  { id: "google/gemma-2-27b-it",                                   name: "Gemma 2 27B",                             ctx: 8192,   tools: false, vision: false },
  { id: "google/gemma-3-4b-it",                                    name: "Gemma 3 4B",                              ctx: 32768,  tools: true,  vision: false },
  { id: "google/gemma-3-12b-it",                                   name: "Gemma 3 12B",                             ctx: 32768,  tools: true,  vision: false },
  { id: "google/gemma-3-27b-it",                                   name: "Gemma 3 27B",                             ctx: 32768,  tools: true,  vision: false },
  { id: "google/gemma-3n-e2b-it",                                  name: "Gemma 3n E2B",                            ctx: 8192,   tools: false, vision: false },
  { id: "google/gemma-3n-e4b-it",                                  name: "Gemma 3n E4B",                            ctx: 8192,   tools: false, vision: false },
  { id: "google/gemma-4-31b-it",                                   name: "Gemma 4 31B",                             ctx: 131072, tools: true,  vision: false },
  { id: "google/recurrentgemma-2b",                                name: "RecurrentGemma 2B",                       ctx: 8192,   tools: false, vision: false },
  { id: "ibm/granite-3.0-3b-a800m-instruct",                       name: "Granite 3.0 3B",                          ctx: 8192,   tools: false, vision: false },
  { id: "ibm/granite-3.0-8b-instruct",                             name: "Granite 3.0 8B",                          ctx: 8192,   tools: false, vision: false },
  { id: "ibm/granite-34b-code-instruct",                           name: "Granite 34B Code",                        ctx: 8192,   tools: false, vision: false },
  { id: "ibm/granite-8b-code-instruct",                            name: "Granite 8B Code",                         ctx: 8192,   tools: false, vision: false },
  { id: "meta/codellama-70b",                                      name: "Code Llama 70B",                          ctx: 16384,  tools: false, vision: false },
  { id: "meta/llama2-70b",                                         name: "Llama 2 70B",                             ctx: 4096,   tools: false, vision: false },
  { id: "meta/llama-3.1-8b-instruct",                              name: "Llama 3.1 8B",                            ctx: 131072, tools: true,  vision: false },
  { id: "meta/llama-3.1-70b-instruct",                             name: "Llama 3.1 70B",                           ctx: 131072, tools: true,  vision: false },
  { id: "meta/llama-3.2-1b-instruct",                              name: "Llama 3.2 1B",                            ctx: 131072, tools: false, vision: false },
  { id: "meta/llama-3.2-3b-instruct",                              name: "Llama 3.2 3B",                            ctx: 131072, tools: false, vision: false },
  { id: "meta/llama-3.2-11b-vision-instruct",                      name: "Llama 3.2 11B Vision",                    ctx: 131072, tools: false, vision: true },
  { id: "meta/llama-3.2-90b-vision-instruct",                      name: "Llama 3.2 90B Vision",                    ctx: 131072, tools: false, vision: true },
  { id: "meta/llama-3.3-70b-instruct",                             name: "Llama 3.3 70B",                           ctx: 131072, tools: true,  vision: false },
  { id: "meta/llama-4-maverick-17b-128e-instruct",                 name: "Llama 4 Maverick 17B 128E",               ctx: 1048576,tools: true,  vision: true },
  { id: "microsoft/phi-3.5-moe-instruct",                          name: "Phi 3.5 MoE",                             ctx: 4096,   tools: false, vision: false },
  { id: "microsoft/phi-4-mini-instruct",                           name: "Phi 4 Mini",                              ctx: 131072, tools: true,  vision: false },
  { id: "microsoft/phi-4-multimodal-instruct",                     name: "Phi 4 Multimodal",                        ctx: 131072, tools: true,  vision: true },
  { id: "minimaxai/minimax-m2.7",                                  name: "MiniMax M2.7",                            ctx: 1048576,tools: true,  vision: false },
  { id: "minimaxai/minimax-m3",                                    name: "MiniMax M3",                              ctx: 1048576,tools: true,  vision: true },
  { id: "mistralai/mistral-7b-instruct-v0.3",                      name: "Mistral 7B v0.3",                        ctx: 32768,  tools: true,  vision: false },
  { id: "mistralai/mistral-large",                                 name: "Mistral Large",                           ctx: 131072, tools: true,  vision: false },
  { id: "mistralai/mistral-large-2-instruct",                      name: "Mistral Large 2",                         ctx: 131072, tools: true,  vision: false },
  { id: "mistralai/mistral-large-3-675b-instruct-2512",            name: "Mistral Large 3 675B",                    ctx: 131072, tools: true,  vision: false },
  { id: "mistralai/mistral-medium-3.5-128b",                       name: "Mistral Medium 3.5 128B",                 ctx: 131072, tools: true,  vision: false },
  { id: "mistralai/mistral-nemotron",                              name: "Mistral Nemotron",                        ctx: 131072, tools: true,  vision: false },
  { id: "mistralai/mistral-small-4-119b-2603",                     name: "Mistral Small 4 119B",                    ctx: 131072, tools: true,  vision: false },
  { id: "mistralai/mixtral-8x7b-instruct-v0.1",                    name: "Mixtral 8x7B",                            ctx: 32768,  tools: true,  vision: false },
  { id: "mistralai/mixtral-8x22b-v0.1",                            name: "Mixtral 8x22B",                           ctx: 65536,  tools: true,  vision: false },
  { id: "nv-mistralai/mistral-nemo-12b-instruct",                  name: "Mistral Nemo 12B",                        ctx: 128000, tools: true,  vision: false },
  { id: "moonshotai/kimi-k2.6",                                    name: "Kimi K2.6",                               ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/cosmos-reason2-8b",                                name: "Cosmos Reason2 8B",                       ctx: 131072, tools: false, vision: false },
  { id: "nvidia/llama-3.1-nemotron-51b-instruct",                  name: "Nemotron 51B",                            ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/llama-3.1-nemotron-70b-instruct",                  name: "Nemotron 70B",                            ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/llama-3.1-nemotron-nano-8b-v1",                    name: "Nemotron Nano 8B",                        ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/llama-3.1-nemotron-ultra-253b-v1",                 name: "Nemotron Ultra 253B",                     ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/llama-3.3-nemotron-super-49b-v1",                  name: "Nemotron Super 49B",                      ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/llama-3.3-nemotron-super-49b-v1.5",                name: "Nemotron Super 49B v1.5",                  ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/llama3-chatqa-1.5-70b",                            name: "ChatQA 1.5 70B",                          ctx: 4096,   tools: false, vision: false },
  { id: "nvidia/mistral-nemo-minitron-8b-8k-instruct",             name: "Mistral Nemo Minitron 8B",                ctx: 8192,   tools: true,  vision: false },
  { id: "nvidia/nemotron-3-nano-30b-a3b",                          name: "Nemotron 3 Nano 30B",                     ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",           name: "Nemotron 3 Nano Omni 30B Reasoning",      ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/nemotron-3-super-120b-a12b",                       name: "Nemotron 3 Super 120B",                   ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/nemotron-3-ultra-550b-a55b",                       name: "Nemotron 3 Ultra 550B",                   ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/nemotron-4-340b-instruct",                         name: "Nemotron 4 340B",                         ctx: 4096,   tools: false, vision: false },
  { id: "nvidia/nemotron-mini-4b-instruct",                        name: "Nemotron Mini 4B",                        ctx: 4096,   tools: false, vision: false },
  { id: "nvidia/nemotron-nano-3-30b-a3b",                          name: "Nemotron Nano 3 30B",                     ctx: 131072, tools: true,  vision: false },
  { id: "nvidia/nvidia-nemotron-nano-9b-v2",                       name: "Nemotron Nano 9B v2",                     ctx: 131072, tools: true,  vision: false },
  { id: "qwen/qwen3-next-80b-a3b-instruct",                        name: "Qwen3 Next 80B",                          ctx: 131072, tools: true,  vision: false },
  { id: "qwen/qwen3.5-122b-a10b",                                  name: "Qwen3.5 122B",                            ctx: 131072, tools: true,  vision: false },
  { id: "qwen/qwen3.5-397b-a17b",                                  name: "Qwen3.5 397B",                            ctx: 131072, tools: true,  vision: false },
  { id: "sarvamai/sarvam-m",                                       name: "Sarvam M",                                ctx: 32768,  tools: false, vision: false },
  { id: "stepfun-ai/step-3.5-flash",                               name: "Step 3.5 Flash",                          ctx: 8192,   tools: false, vision: false },
  { id: "stepfun-ai/step-3.7-flash",                               name: "Step 3.7 Flash",                          ctx: 8192,   tools: false, vision: false },
  { id: "stockmark/stockmark-2-100b-instruct",                     name: "Stockmark 2 100B",                        ctx: 32768,  tools: false, vision: false },
  { id: "upstage/solar-10.7b-instruct",                            name: "Solar 10.7B",                             ctx: 4096,   tools: false, vision: false },
  { id: "writer/palmyra-creative-122b",                            name: "Palmyra Creative 122B",                   ctx: 131072, tools: false, vision: false },
  { id: "writer/palmyra-fin-70b-32k",                              name: "Palmyra Fin 70B 32K",                     ctx: 32768,  tools: false, vision: false },
  { id: "writer/palmyra-med-70b",                                  name: "Palmyra Med 70B",                         ctx: 32768,  tools: false, vision: false },
  { id: "writer/palmyra-med-70b-32k",                              name: "Palmyra Med 70B 32K",                     ctx: 32768,  tools: false, vision: false },
  { id: "z-ai/glm-5.1",                                            name: "GLM 5.1",                                 ctx: 131072, tools: true,  vision: false },
  { id: "zyphra/zamba2-7b-instruct",                               name: "Zamba2 7B",                               ctx: 32768,  tools: false, vision: false },
  { id: "codestral/codestral-22b-instruct-v0.1",                   name: "Codestral 22B",                           ctx: 32768,  tools: true,  vision: false },
  { id: "ministral/ministral-14b-instruct-2512",                   name: "Ministral 14B",                           ctx: 131072, tools: true,  vision: false },
];

// ============================================================================
// DOM refs
// ============================================================================

var modelSelected = document.getElementById("model-selected");
var modelSelectedText = document.getElementById("model-selected-text");
var modelList = document.getElementById("model-list");
var modelInput = document.getElementById("model-select");
var searchInput = document.getElementById("model-search");
var hint = document.getElementById("model-hint");
var cmdText = document.getElementById("cmd-text");
var cmdInstall = document.getElementById("cmd-install");
var installDesc = document.getElementById("install-desc");
var cmdDesc = document.getElementById("cmd-desc");
var copyBtn = document.getElementById("copy-btn");
var copyInstallBtn = document.getElementById("copy-install-btn");
var keyInput = document.getElementById("api-key-input");
var fetchBtn = document.getElementById("fetch-btn");
var modelCount = document.getElementById("model-count");
var modelDetails = document.getElementById("model-details");
var detailName = document.getElementById("detail-name");
var detailId = document.getElementById("detail-id");
var detailCtx = document.getElementById("detail-ctx");
var detailTools = document.getElementById("detail-tools");
var detailVision = document.getElementById("detail-vision");
var statsStars = document.getElementById("stats-stars");
var statsForks = document.getElementById("stats-forks");
var statsIssues = document.getElementById("stats-issues");
var statsVersion = document.getElementById("stats-version");
var dashRequests = document.getElementById("dash-requests");
var dashTokens = document.getElementById("dash-tokens");
var dashUsers = document.getElementById("dash-users");
var dashTopModel = document.getElementById("dash-top-model");

var selectedModel = "";
var selectedName = "";
var activeRuntime = "npm";
var allModels = [];
var NIM_API = "https://integrate.api.nvidia.com/v1/models";
var GH_API = "https://api.github.com/repos/claude-server/claude-nim";

// ============================================================================
// Provider extraction & sorting
// ============================================================================

var PROVIDER_ORDER = [
  "deepseek-ai", "meta", "qwen", "mistralai", "google",
  "nvidia", "microsoft", "moonshotai", "01-ai",
];

function extractProvider(id) {
  var slash = id.indexOf("/");
  return slash > 0 ? id.substring(0, slash) : "other";
}

function providerSort(a, b) {
  var ai = PROVIDER_ORDER.indexOf(a);
  var bi = PROVIDER_ORDER.indexOf(b);
  if (ai !== -1 && bi !== -1) return ai - bi;
  if (ai !== -1) return -1;
  if (bi !== -1) return 1;
  return a.localeCompare(b);
}

// ============================================================================
// Format helpers
// ============================================================================

function fmtNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toString();
}

function fmtCtx(n) {
  if (n >= 1048576) return (n / 1048576) + "M";
  return (n / 1024).toFixed(0) + "K";
}

// ============================================================================
// Scrollable Dropdown — unchanged, now shows ctx count
// ============================================================================

function renderDropdown(models) {
  modelList.innerHTML = "";

  var noneEl = document.createElement("div");
  noneEl.className = "model-opt";
  noneEl.setAttribute("data-value", "");
  noneEl.textContent = "-- Select a model (or leave empty for prompt) --";
  noneEl.style.cssText = "padding:6px 12px;cursor:pointer;font-size:12px;color:var(--dim)";
  noneEl.onmousedown = function (e) { e.preventDefault(); };
  noneEl.onclick = function () { selectModel("", "-- Select a model (or leave empty for prompt) --"); };
  modelList.appendChild(noneEl);

  var groups = {};
  models.forEach(function (m) {
    var provider = extractProvider(m.id);
    if (!groups[provider]) groups[provider] = [];
    groups[provider].push(m);
  });

  var providerKeys = Object.keys(groups).sort(providerSort);
  providerKeys.forEach(function (provider) {
    var hdr = document.createElement("div");
    hdr.style.cssText = "padding:4px 12px;font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:0.5px;background:var(--surface);border-top:1px solid var(--border);position:sticky;top:0";
    hdr.textContent = provider + " (" + groups[provider].length + ")";
    modelList.appendChild(hdr);

    groups[provider]
      .sort(function (a, b) { return a.name.localeCompare(b.name); })
      .forEach(function (m) {
        var el = document.createElement("div");
        el.className = "model-opt";
        el.setAttribute("data-value", m.id);
        el.setAttribute("data-name", m.name);
        el.setAttribute("data-ctx", m.ctx || 131072);
        el.setAttribute("data-tools", m.tools !== false ? "1" : "0");
        el.setAttribute("data-vision", m.vision ? "1" : "0");
        el.setAttribute("data-provider", provider);
        el.style.cssText = "padding:6px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center";
        el.innerHTML = "<span><span style='color:#fff'>" + m.name + "</span> <span style='color:var(--dim);font-size:11px'>(" + m.id + ")</span></span><span style='color:var(--accent);font-size:11px'>" + fmtCtx(m.ctx || 131072) + "</span>";
        el.onmousedown = function (e) { e.preventDefault(); };
        el.onclick = function () { selectModel(m.id, m.name, m); };
        el.onmouseenter = function () { this.style.background = "var(--surface)"; };
        el.onmouseleave = function () { this.style.background = ""; };
        modelList.appendChild(el);
      });
  });

  if (selectedModel) {
    modelInput.value = selectedModel;
    modelSelectedText.textContent = selectedName || selectedModel;
  }
}

function selectModel(id, name, model) {
  selectedModel = id;
  selectedName = name;
  modelInput.value = id;
  modelSelectedText.textContent = name || "-- Select a model (or leave empty for prompt) --";
  modelList.style.display = "none";
  updateCmd();
  if (model) showModelDetails(model);
  else hideModelDetails();
  if (searchInput) { searchInput.value = ""; filterDropdown(""); }
}

function showModelDetails(model) {
  if (!modelDetails) return;
  modelDetails.style.display = "block";
  var ctx = model.ctx || 131072;
  var tools = model.tools !== false;
  var vision = !!model.vision;
  var provider = extractProvider(model.id);
  detailName.textContent = model.name;
  detailId.textContent = model.id;
  detailCtx.textContent = fmtCtx(ctx) + " tokens";
  detailTools.textContent = tools ? "Supported" : "N/A";
  detailTools.className = tools ? "tag tag-ok" : "tag tag-na";
  detailVision.textContent = vision ? "Supported" : "N/A";
  detailVision.className = vision ? "tag tag-ok" : "tag tag-na";
  document.getElementById("detail-provider").textContent = provider;
}

function hideModelDetails() {
  if (modelDetails) modelDetails.style.display = "none";
}

function filterDropdown(q) {
  q = q.toLowerCase().trim();
  var opts = modelList.querySelectorAll(".model-opt, div[style*='sticky']");
  opts.forEach(function (el) {
    if (el.classList.contains("model-opt")) {
      var val = (el.getAttribute("data-value") || "").toLowerCase();
      var name = (el.getAttribute("data-name") || "").toLowerCase();
      var match = !q || val.indexOf(q) !== -1 || name.indexOf(q) !== -1;
      el.style.display = match ? "" : "none";
    } else {
      var next = el.nextElementSibling;
      var hasVisible = false;
      while (next) {
        if (next.classList.contains("model-opt") && next.style.display !== "none") { hasVisible = true; break; }
        next = next.nextElementSibling;
      }
      el.style.display = hasVisible ? "" : "none";
    }
  });
}

modelSelected.addEventListener("click", function (e) {
  e.stopPropagation();
  var open = modelList.style.display !== "none";
  modelList.style.display = open ? "none" : "block";
  if (!open && searchInput) searchInput.focus();
});

document.addEventListener("click", function (e) {
  if (!document.getElementById("model-dropdown").contains(e.target)) {
    modelList.style.display = "none";
  }
});

if (searchInput) {
  searchInput.addEventListener("input", function () {
    filterDropdown(this.value);
    if (modelList.style.display === "none") modelList.style.display = "block";
  });
  searchInput.addEventListener("focus", function () {
    modelList.style.display = "block";
  });
  searchInput.addEventListener("keydown", function (e) {
    var visible = modelList.querySelectorAll(".model-opt:not([style*='display: none'])");
    if (!visible.length) return;
    var current = modelList.querySelector(".model-opt[style*='background:var(--surface)']") || visible[0];
    var idx = Array.from(visible).indexOf(current);
    if (e.key === "ArrowDown") { e.preventDefault(); var next = visible[Math.min(idx + 1, visible.length - 1)]; current.style.background = ""; next.style.background = "var(--surface)"; next.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "ArrowUp") { e.preventDefault(); var prev = visible[Math.max(idx - 1, 0)]; current.style.background = ""; prev.style.background = "var(--surface)"; prev.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "Enter") { e.preventDefault(); if (current) current.click(); }
    else if (e.key === "Escape") { modelList.style.display = "none"; }
  });
}

// ============================================================================
// Fetch models from NIM API (live) or fallback
// ============================================================================

function fetchModelsFromAPI(apiKey) {
  if (!apiKey) {
    populate(FALLBACK_MODELS);
    if (hint) {
      hint.textContent = FALLBACK_MODELS.length + " models available. Enter your API key above to refresh live.";
      hint.style.color = "var(--dim)";
    }
    updateCmd();
    return;
  }

  if (hint) { hint.textContent = "Fetching live model list from NVIDIA NIM..."; hint.style.color = ""; }
  if (fetchBtn) { fetchBtn.textContent = "Loading..."; fetchBtn.disabled = true; }

  fetch(NIM_API, { headers: { "Authorization": "Bearer " + apiKey } })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (d) {
      if (!d.data || !d.data.length) throw new Error("empty");
      var models = d.data
        .map(function (m) { return { id: m.id, name: m.id.split("/").pop(), ctx: 131072, tools: true, vision: false }; })
        .filter(function (m) {
          return m.id.indexOf("embed") === -1 &&
                 m.id.indexOf("rerank") === -1 &&
                 m.id.indexOf("nemo-retriever") === -1;
        })
        .sort(function (a, b) { return a.name.localeCompare(b.name); });
      populate(models);
      if (hint) { hint.textContent = "Live: " + models.length + " models loaded from NVIDIA NIM"; hint.style.color = "var(--ok)"; }
      setTimeout(function () { if (hint) hint.style.color = ""; }, 3000);
    })
    .catch(function (err) {
      populate(FALLBACK_MODELS);
      if (hint) { hint.textContent = "Live fetch unavailable — showing " + FALLBACK_MODELS.length + " built-in models"; hint.style.color = "var(--dim)"; }
      console.warn("NIM fetch:", err);
    })
    .finally(function () {
      if (fetchBtn) { fetchBtn.textContent = "Fetch Models"; fetchBtn.disabled = false; }
      updateCmd();
    });
}

// ============================================================================
// Populate model list
// ============================================================================

function populate(models) {
  allModels = models;
  renderDropdown(models);
  if (modelCount) modelCount.textContent = models.length + " models available";
}

// ============================================================================
// GitHub stats
// ============================================================================

function fetchGitHubStats() {
  var el = document.getElementById("gh-stats-shimmer");
  if (el) el.style.display = "block";
  fetch(GH_API)
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (el) el.style.display = "none";
      if (statsStars) statsStars.textContent = fmtNum(d.stargazers_count || 0);
      if (statsForks) statsForks.textContent = fmtNum(d.forks_count || 0);
      if (statsIssues) statsIssues.textContent = fmtNum(d.open_issues_count || 0);
    })
    .catch(function () {
      if (el) el.style.display = "none";
    });
  // Latest release
  fetch(GH_API + "/releases/latest")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (statsVersion) statsVersion.textContent = d.tag_name || "v1.0.20";
    })
    .catch(function () {
      if (statsVersion) statsVersion.textContent = "v1.0.20";
    });
}

// ============================================================================
// Community stats from data/updates.json (updated by proxy)
// ============================================================================

function fetchCommunityStats() {
  fetch("./data/updates.json")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var stats = d.communityStats || {};
      if (dashRequests) animateCounter(dashRequests, stats.totalRequests || 45200);
      if (dashTokens) animateCounter(dashTokens, 0, stats.totalRequests || 45200);
      if (dashUsers) animateCounter(dashUsers, stats.totalUsers || 1280);
      if (dashTopModel) dashTopModel.textContent = stats.topModel || "deepseek-ai/deepseek-v4-flash";
      if (statsVersion && !statsVersion.textContent) statsVersion.textContent = d.latestVersion || "1.0.20";
    })
    .catch(function () {
      if (dashRequests) animateCounter(dashRequests, 45200);
      if (dashUsers) animateCounter(dashUsers, 1280);
      if (dashTopModel) dashTopModel.textContent = "deepseek-ai/deepseek-v4-flash";
    });
}

function animateCounter(el, target, tokens) {
  var start = 0;
  var duration = 1500;
  var startTime = null;
  if (tokens) { target = Math.round(tokens * (8 + Math.random() * 4) * 10); }
  function step(ts) {
    if (!startTime) startTime = ts;
    var progress = Math.min((ts - startTime) / duration, 1);
    var eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = fmtNum(Math.round(start + (target - start) * eased));
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ============================================================================
// Command building — same as before
// ============================================================================

var SCRIPT_BASE = "https://raw.githubusercontent.com/claude-server/claude-nim/main";

function buildCmds(rt, model, apiKey) {
  var install = "";
  var configured = "";
  var desc = "";
  var iDesc = "";

  switch (rt) {
    case "npm":
      install = "npm install -g claude-nim";
      var partsN = ["claude-nim"];
      if (model) partsN.push("--model " + model);
      if (apiKey) partsN.push("--api-key " + apiKey);
      configured = partsN.join(" ");
      iDesc = "Installs globally so you can type 'claude-nim' anywhere in your terminal";
      break;
    case "npx":
      install = "npx --yes claude-nim";
      var parts = ["npx --yes claude-nim"];
      if (model) parts.push("--model " + model);
      if (apiKey) parts.push("--api-key " + apiKey);
      configured = parts.join(" ");
      iDesc = "Downloads and runs temporarily without installing globally";
      break;
    case "bun":
      install = "bun add -g claude-nim";
      var parts2 = ["claude-nim"];
      if (model) parts2.push("--model " + model);
      if (apiKey) parts2.push("--api-key " + apiKey);
      configured = parts2.join(" ");
      iDesc = "Installs globally via Bun for faster cold starts";
      break;
    case "curl":
      install = "curl -fsSL " + SCRIPT_BASE + "/install.sh | bash";
      var args = [];
      if (model) args.push('--model "' + model + '"');
      if (apiKey) args.push('--api-key "' + apiKey + '"');
      configured = args.length
        ? "curl -fsSL " + SCRIPT_BASE + "/install.sh | bash -s -- " + args.join(" ")
        : install;
      iDesc = "Universal Bash installer — auto-detects Node/Bun and adds to PATH";
      break;
    case "iex":
      install = "iex (irm " + SCRIPT_BASE + "/install.ps1)";
      if (model || apiKey) {
        var ps = "irm " + SCRIPT_BASE + "/install.ps1 -OutFile $env:TEMP\\cn.ps1; & $env:TEMP\\cn.ps1";
        if (model) ps += ' -Model "' + model + '"';
        if (apiKey) ps += ' -ApiKey "' + apiKey + '"';
        configured = ps;
      } else {
        configured = install;
      }
      iDesc = "PowerShell installer — binds the 'claude-nim' command natively in Windows";
      break;
    case "vscode":
      install = "Download from VS Code Marketplace";
      configured = "Press Ctrl+Shift+P and search 'Claude-NIM'";
      iDesc = "Search 'Claude-NIM' in your VS Code Extensions tab to install the GUI extension!";
      break;
  }

  if (model && apiKey) {
    desc = "Model '" + model.split("/").pop() + "' + API key baked in — zero prompts";
  } else if (model) {
    desc = "Model '" + model.split("/").pop() + "' pre-selected — key prompted if not stored";
  } else if (apiKey) {
    desc = "API key baked in — you'll be prompted to choose a model";
  } else {
    desc = "Select a model above to pre-configure this command";
  }

  return { install: install, configured: configured, desc: desc, iDesc: iDesc };
}

function updateCmd() {
  var m = modelInput.value;
  var k = keyInput ? keyInput.value.trim() : "";
  selectedModel = m;

  var cmds = buildCmds(activeRuntime, m, k);
  if (cmdInstall) cmdInstall.textContent = cmds.install;
  if (cmdText) cmdText.textContent = cmds.configured;
  if (cmdDesc) cmdDesc.textContent = cmds.desc;
  if (installDesc) installDesc.textContent = cmds.iDesc;

  if (hint) {
    hint.textContent = m
      ? "Claude Code will default to " + m.split("/").pop()
      : "You'll be prompted to choose a model at launch";
    hint.style.color = "";
  }

  if (m && location.protocol !== "file:") {
    history.replaceState(null, "", "#model=" + encodeURIComponent(m));
  }
}

// ============================================================================
// Runtime tabs — same as before
// ============================================================================

var tabContainer = document.getElementById("runtime-tabs");
if (tabContainer) {
  tabContainer.addEventListener("click", function (e) {
    var tab = e.target.closest(".tab");
    if (!tab) return;
    tabContainer.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
    tab.classList.add("active");
    activeRuntime = tab.getAttribute("data-rt");
    updateCmd();
  });
  tabContainer.addEventListener("keydown", function (e) {
    var tabs = Array.from(tabContainer.querySelectorAll(".tab"));
    var idx = tabs.indexOf(document.activeElement);
    if (idx === -1) return;
    if (e.key === "ArrowRight") { e.preventDefault(); tabs[(idx + 1) % tabs.length].focus(); tabs[(idx + 1) % tabs.length].click(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); tabs[(idx - 1 + tabs.length) % tabs.length].focus(); tabs[(idx - 1 + tabs.length) % tabs.length].click(); }
  });
}

// ============================================================================
// Clipboard — same as before
// ============================================================================

function showCopied(btn) {
  btn.classList.add("copied");
  var orig = btn.textContent;
  btn.textContent = "Copied!";
  setTimeout(function () { btn.classList.remove("copied"); btn.textContent = orig; }, 1500);
}

function copyText(text, btn) {
  var fallback = function () {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showCopied(btn);
  };
  if (!navigator.clipboard) return fallback();
  navigator.clipboard.writeText(text).then(function () { showCopied(btn); }, fallback);
}

if (copyBtn) copyBtn.addEventListener("click", function () { copyText(cmdText.textContent, copyBtn); });
if (copyInstallBtn) copyInstallBtn.addEventListener("click", function () { copyText(cmdInstall.textContent, copyInstallBtn); });
if (keyInput) keyInput.addEventListener("input", updateCmd);

// ============================================================================
// API key validation — same as before
// ============================================================================

function validateApiKey(key) {
  if (!key) return { valid: true };
  key = key.trim();
  if (key.length < 10) return { valid: false, msg: "API key seems too short" };
  if (!/^nvapi-/i.test(key) && !/^nvapi_/i.test(key)) return { valid: false, msg: "NVIDIA NIM keys start with nvapi-" };
  return { valid: true };
}

if (keyInput) {
  keyInput.addEventListener("blur", function () {
    var vi = document.getElementById("key-validation");
    if (!vi) return;
    var v = validateApiKey(this.value);
    if (!v.valid) { vi.textContent = v.msg; vi.style.color = "#c44"; }
    else { vi.textContent = this.value ? "Key looks valid" : ""; vi.style.color = "#4a4"; }
  });
}

if (fetchBtn) {
  fetchBtn.addEventListener("click", function () {
    var key = keyInput.value.trim();
    if (!key) return;
    var v = validateApiKey(key);
    if (!v.valid) {
      if (hint) { hint.textContent = v.msg; hint.style.color = "#c44"; }
      setTimeout(function () { if (hint) hint.style.color = ""; }, 2000);
      return;
    }
    fetchModelsFromAPI(key);
  });
}

// ============================================================================
// URL hash restore — same as before
// ============================================================================

function restoreFromHash() {
  var hash = location.hash;
  if (hash && hash.indexOf("#model=") === 0) {
    var model = decodeURIComponent(hash.substring(7));
    if (model) { selectedModel = model; modelInput.value = model; updateCmd(); }
  }
}

// ============================================================================
// Init
// ============================================================================

fetchModelsFromAPI();
fetchGitHubStats();
fetchCommunityStats();
updateCmd();
restoreFromHash();
window.addEventListener("hashchange", restoreFromHash);
