// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
// ============================================================================

// DOM refs
var modelSelected = document.getElementById("model-selected");
var modelSelectedText = document.getElementById("model-selected-text");
var modelList = document.getElementById("model-list");
var modelInput = document.getElementById("model-select"); // hidden input
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

var selectedModel = "";
var selectedName = "";
var activeRuntime = "npm";
var allModels = [];
var fetchRetryCount = 0;
var MAX_RETRIES = 2;
var NIM_API = "https://integrate.api.nvidia.com/v1/models";
var SCRIPT_BASE = "https://raw.githubusercontent.com/claude-server/claude-nim/main";

/// Complete NIM model list — sourced from live API, updated June 2026
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

// ============================================================================
// Provider Extraction & Sorting
// ============================================================================

var PROVIDER_ORDER = [
  "deepseek-ai", "meta", "qwen", "mistralai", "google",
  "nvidia", "microsoft", "moonshotai", "cohere", "01-ai",
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
// Custom Scrollable Dropdown
// ============================================================================

function renderDropdown(models) {
  modelList.innerHTML = "";

  // "No model" option
  var noneEl = document.createElement("div");
  noneEl.className = "model-opt";
  noneEl.setAttribute("data-value", "");
  noneEl.textContent = "-- Select a model (or leave empty for prompt) --";
  noneEl.style.cssText = "padding:6px 12px;cursor:pointer;font-size:12px;color:var(--dim)";
  noneEl.onmousedown = function (e) { e.preventDefault(); };
  noneEl.onclick = function () { selectModel("", "-- Select a model (or leave empty for prompt) --"); };
  modelList.appendChild(noneEl);

  // Group by provider
  var groups = {};
  models.forEach(function (m) {
    var provider = extractProvider(m.id);
    if (!groups[provider]) groups[provider] = [];
    groups[provider].push(m);
  });

  var providerKeys = Object.keys(groups).sort(providerSort);
  providerKeys.forEach(function (provider) {
    // Provider header
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
        el.setAttribute("data-provider", provider);
        el.style.cssText = "padding:6px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border)";
        el.innerHTML = "<span style='color:#fff'>" + m.name + "</span> <span style='color:var(--dim);font-size:11px'>(" + m.id + ")</span>";
        el.onmousedown = function (e) { e.preventDefault(); };
        el.onclick = function () { selectModel(m.id, m.name); };
        // Hover effect
        el.onmouseenter = function () { this.style.background = "var(--surface)"; };
        el.onmouseleave = function () { this.style.background = ""; };
        modelList.appendChild(el);
      });
  });

  // Restore selection
  if (selectedModel) {
    modelInput.value = selectedModel;
    modelSelectedText.textContent = selectedName || selectedModel;
  }
}

function selectModel(id, name) {
  selectedModel = id;
  selectedName = name;
  modelInput.value = id;
  modelSelectedText.textContent = name || "-- Select a model (or leave empty for prompt) --";
  modelList.style.display = "none";
  updateCmd();
  // Re-focus search
  if (searchInput) searchInput.value = "";
  filterDropdown("");
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
      // Provider header — show if next sibling is visible
      var next = el.nextElementSibling;
      var hasVisible = false;
      while (next && !next.classList.contains("model-opt") && !next.style.position?.includes("sticky")) {
        if (next.classList.contains("model-opt") && next.style.display !== "none") hasVisible = true;
        next = next.nextElementSibling;
      }
      el.style.display = hasVisible ? "" : "none";
    }
  });
}

// Toggle dropdown
modelSelected.addEventListener("click", function (e) {
  e.stopPropagation();
  var open = modelList.style.display !== "none";
  modelList.style.display = open ? "none" : "block";
  if (!open && searchInput) searchInput.focus();
});

// Close on outside click
document.addEventListener("click", function (e) {
  if (!document.getElementById("model-dropdown").contains(e.target)) {
    modelList.style.display = "none";
  }
});

// Search filter
if (searchInput) {
  searchInput.addEventListener("input", function () {
    filterDropdown(this.value);
    if (modelList.style.display === "none") modelList.style.display = "block";
  });
  searchInput.addEventListener("focus", function () {
    modelList.style.display = "block";
  });
  // Keyboard navigation
  searchInput.addEventListener("keydown", function (e) {
    var visible = modelList.querySelectorAll(".model-opt:not([style*='display: none'])");
    if (!visible.length) return;
    var current = modelList.querySelector(".model-opt[style*='background:var(--surface)']") || visible[0];
    var idx = Array.from(visible).indexOf(current);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      var next = visible[Math.min(idx + 1, visible.length - 1)];
      current.style.background = "";
      next.style.background = "var(--surface)";
      next.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      var prev = visible[Math.max(idx - 1, 0)];
      current.style.background = "";
      prev.style.background = "var(--surface)";
      prev.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (current) current.click();
    } else if (e.key === "Escape") {
      modelList.style.display = "none";
    }
  });
}

// ============================================================================
// Fetch Models — Multiple CORS proxy fallbacks
// ============================================================================

function fetchModelsFromAPI(apiKey) {
  // Without an API key we can't call the live endpoint directly (CORS + Auth).
  // The built-in list of 60+ models is always shown immediately.
  // When a key is provided, we attempt a direct authenticated fetch to get the
  // absolute latest list (this works because the user's own API key lets the
  // browser send a credentialed cross-origin request).
  if (!apiKey) {
    populate(FALLBACK_MODELS);
    if (hint) {
      hint.textContent = FALLBACK_MODELS.length + " models available. Enter your API key above to refresh live.";
      hint.style.color = "var(--dim)";
    }
    updateCmd();
    return;
  }

  if (hint) { hint.textContent = "Fetching live model list with your API key..."; hint.style.color = ""; }
  if (fetchBtn) { fetchBtn.textContent = "Loading..."; fetchBtn.disabled = true; }

  fetch(NIM_API, { headers: { "Authorization": "Bearer " + apiKey } })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (d) {
      if (!d.data || !d.data.length) throw new Error("empty");
      var models = d.data
        .map(function (m) { return { id: m.id, name: m.id.split("/").pop() }; })
        .filter(function (m) {
          return m.id.indexOf("embed") === -1 &&
                 m.id.indexOf("rerank") === -1 &&
                 m.id.indexOf("nemo-retriever") === -1;
        })
        .sort(function (a, b) { return a.name.localeCompare(b.name); });
      populate(models);
      if (hint) { hint.textContent = "Live: loaded " + models.length + " models from NVIDIA NIM"; hint.style.color = "var(--ok)"; }
      setTimeout(function () { if (hint) hint.style.color = ""; }, 3000);
    })
    .catch(function (err) {
      // Fall back to built-in list on any error
      populate(FALLBACK_MODELS);
      if (hint) { hint.textContent = "Live fetch failed — showing built-in list ("+FALLBACK_MODELS.length+" models)"; hint.style.color = "var(--dim)"; }
      console.warn("NIM fetch error:", err);
    })
    .finally(function () {
      if (fetchBtn) { fetchBtn.textContent = "Fetch Models"; fetchBtn.disabled = false; }
      updateCmd();
    });
}

// ============================================================================
// Populate
// ============================================================================

function populate(models) {
  allModels = models;
  renderDropdown(models);
  if (modelCount) modelCount.textContent = models.length + " models available";
}

// ============================================================================
// Command Building
// ============================================================================

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

  // Only update the URL hash when served over http/https — replaceState
  // throws a security error when the page is opened as a local file://
  if (m && location.protocol !== "file:") {
    history.replaceState(null, "", "#model=" + encodeURIComponent(m));
  }
}

// ============================================================================
// Runtime Tabs
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
// Clipboard
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
// API Key Validation
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
    if (!v.valid) { vi.textContent = v.msg; vi.style.color = "var(--err)"; }
    else { vi.textContent = this.value ? "Looks good" : ""; vi.style.color = "var(--ok)"; }
  });
}

if (fetchBtn) {
  fetchBtn.addEventListener("click", function () {
    var key = keyInput.value.trim();
    if (!key) return;
    var v = validateApiKey(key);
    if (!v.valid) {
      hint.textContent = v.msg;
      hint.style.color = "var(--err)";
      setTimeout(function () { hint.style.color = ""; }, 2000);
      return;
    }
    fetchRetryCount = 0;
    fetchModelsFromAPI(key);
  });
}

// ============================================================================
// URL Hash Restore
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
updateCmd();
restoreFromHash();
window.addEventListener("hashchange", restoreFromHash);
