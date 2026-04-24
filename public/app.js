/* ════════════════════════════════════════════════════════════════════════════
   NodeFlow — Client Logic
   Talks to /bfhl, renders structured output into the DOM.
   ════════════════════════════════════════════════════════════════════════════ */

// ── Config ───────────────────────────────────────────────────────────────────

const API_ENDPOINT = (() => {
  const { hostname, origin } = window.location;
  return hostname === "localhost" || hostname === "127.0.0.1"
    ? `http://${hostname}:3000`
    : origin;
})();

// ── Sample dataset ────────────────────────────────────────────────────────────

const SAMPLE_EDGES = [
  "A->B", "A->C", "B->D", "C->E", "E->F",
  "X->Y", "Y->Z", "Z->X",
  "P->Q", "Q->R",
  "G->H", "G->H", "G->I",
  "hello", "1->2", "A->",
];

// ── DOM refs (resolved lazily) ────────────────────────────────────────────────

const $ = id => document.getElementById(id);

// ── Quick-actions ─────────────────────────────────────────────────────────────

function fillSample() {
  $("edge-input").value = SAMPLE_EDGES.join("\n");
}

function resetAll() {
  $("edge-input").value = "";
  $("output-panel").classList.add("hidden");
  dismissAlert();
}

// ── Alert helpers ─────────────────────────────────────────────────────────────

function showAlert(msg) {
  $("alert-text").textContent = msg;
  $("alert-box").classList.remove("hidden");
}

function dismissAlert() {
  $("alert-box").classList.add("hidden");
}

// ── Input tokeniser ───────────────────────────────────────────────────────────

function tokeniseInput(raw) {
  return raw
    .split(/[\n,]+/)
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

// ── Main: run analysis ────────────────────────────────────────────────────────

async function runAnalysis() {
  dismissAlert();

  const rawInput = $("edge-input").value;
  if (!rawInput.trim()) {
    showAlert("Please enter at least one node edge before running.");
    return;
  }

  const tokens = tokeniseInput(rawInput);
  const runBtn = $("btn-run");

  runBtn.classList.add("busy");
  runBtn.innerHTML = '<span class="btn-run-icon">⟳</span> Running…';

  try {
    const response = await fetch(`${API_ENDPOINT}/bfhl`, {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify({ data: tokens }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error ?? `HTTP ${response.status}`);
    }

    const data = await response.json();
    paintResults(data);

  } catch (err) {
    showAlert(`Request failed — ${err.message}. Ensure the server is running.`);
  } finally {
    runBtn.classList.remove("busy");
    runBtn.innerHTML = '<span class="btn-run-icon">&#9654;</span> Analyse';
  }
}

// ── Paint results to DOM ──────────────────────────────────────────────────────

function paintResults(payload) {
  // Submitter strip
  $("out-uid").textContent   = payload.user_id             ?? "—";
  $("out-email").textContent = payload.email_id            ?? "—";
  $("out-roll").textContent  = payload.college_roll_number ?? "—";

  // Stat row
  buildStatRow(payload.summary ?? {});

  // Hierarchies
  buildHierarchyGrid(payload.hierarchies ?? []);

  // Flags
  buildFlagsSection(payload.invalid_entries ?? [], payload.duplicate_edges ?? []);

  // Raw JSON
  $("raw-output").textContent = JSON.stringify(payload, null, 2);

  // Reveal
  const panel = $("output-panel");
  panel.classList.remove("hidden");
  panel.classList.add("fade-in");
  setTimeout(() => panel.classList.remove("fade-in"), 500);
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Stat row builder ──────────────────────────────────────────────────────────

function buildStatRow({ total_trees = 0, total_cycles = 0, largest_tree_root = "—" }) {
  const row = $("stat-row");
  row.innerHTML = "";

  const items = [
    { cls: "sc-trees",  icon: "🌲", val: total_trees,       desc: "Valid Trees"       },
    { cls: "sc-cycles", icon: "↩",  val: total_cycles,      desc: "Cyclic Groups"     },
    { cls: "sc-root",   icon: "🔝", val: largest_tree_root ?? "—", desc: "Largest Tree Root" },
  ];

  for (const { cls, icon, val, desc } of items) {
    const card = document.createElement("div");
    card.className = `stat-card ${cls}`;
    card.innerHTML = `
      <span class="sc-icon">${icon}</span>
      <span class="sc-num">${val}</span>
      <span class="sc-desc">${desc}</span>
    `;
    row.appendChild(card);
  }
}

// ── Hierarchy grid builder ────────────────────────────────────────────────────

function buildHierarchyGrid(hierarchies) {
  const grid = $("hier-grid");
  grid.innerHTML = "";

  hierarchies.forEach((entry, idx) => {
    const card = makeHierarchyCard(entry, idx);
    grid.appendChild(card);
  });
}

function makeHierarchyCard(entry, idx) {
  const isCycle = entry.has_cycle === true;

  const card = document.createElement("div");
  card.className = `hcard${isCycle ? " hcard-cycle" : ""}`;
  card.style.animationDelay = `${idx * 0.06}s`;

  // ── Card top ──
  const top = document.createElement("div");
  top.className = "hcard-top";

  const rootInfo = document.createElement("div");
  rootInfo.className = "hcard-root-info";
  rootInfo.innerHTML = `
    <span class="root-bubble">${sanitise(entry.root)}</span>
    <span class="root-label">Root <strong>${sanitise(entry.root)}</strong></span>
  `;

  const tags = document.createElement("div");
  tags.className = "hcard-tags";

  if (isCycle) {
    tags.innerHTML = `<span class="tag tag-cycle">⟳ Cycle</span>`;
  } else {
    tags.innerHTML = `
      <span class="tag tag-tree">Tree</span>
      <span class="tag tag-depth">d=${entry.depth}</span>
    `;
  }

  top.appendChild(rootInfo);
  top.appendChild(tags);

  // ── Card body ──
  const body = document.createElement("div");
  body.className = "hcard-body";

  if (isCycle) {
    body.innerHTML = `<p class="cycle-notice">⟳ Cyclic group — no linear structure.</p>`;
  } else {
    const treeWrap = document.createElement("div");
    treeWrap.className = "itree";
    paintNode(treeWrap, entry.root, (entry.tree ?? {})[entry.root] ?? {}, 0, true);
    body.appendChild(treeWrap);
  }

  card.appendChild(top);
  card.appendChild(body);
  return card;
}

// ── Recursive tree painter ────────────────────────────────────────────────────

function paintNode(container, label, subtree, level, isRoot) {
  const row = document.createElement("div");
  row.style.paddingLeft = level > 0 ? "1.1rem" : "0";

  const nodeRow = document.createElement("div");
  nodeRow.className = "inode";

  if (!isRoot) {
    const conn = document.createElement("span");
    conn.className  = "inode-connector";
    conn.textContent = "└─";
    conn.setAttribute("aria-hidden", "true");
    nodeRow.appendChild(conn);
  }

  const pill = document.createElement("span");
  pill.className   = "inode-pill";
  pill.textContent = label;
  pill.title       = `Node ${label}`;
  nodeRow.appendChild(pill);

  row.appendChild(nodeRow);

  const childKeys = Object.keys(subtree ?? {});
  if (childKeys.length > 0) {
    const childGroup = document.createElement("div");
    childGroup.className = "itree-children";
    for (const ck of childKeys) {
      paintNode(childGroup, ck, subtree[ck], level + 1, false);
    }
    row.appendChild(childGroup);
  }

  container.appendChild(row);
}

// ── Flags section ─────────────────────────────────────────────────────────────

function buildFlagsSection(invalids, duplicates) {
  const wrap = $("flags-wrap");
  wrap.innerHTML = `
    <div class="flag-panel flag-panel-invalid">
      <div class="flag-heading">⚠ Invalid Entries (${invalids.length})</div>
      <div class="chips-row">
        ${invalids.length
          ? invalids.map(e => `<span class="chip">${sanitise(e)}</span>`).join("")
          : `<span class="chips-empty">None</span>`}
      </div>
    </div>
    <div class="flag-panel flag-panel-duplicate">
      <div class="flag-heading">⊗ Duplicates (${duplicates.length})</div>
      <div class="chips-row">
        ${duplicates.length
          ? duplicates.map(e => `<span class="chip">${sanitise(e)}</span>`).join("")
          : `<span class="chips-empty">None</span>`}
      </div>
    </div>
  `;
}

// ── XSS guard ─────────────────────────────────────────────────────────────────

function sanitise(str) {
  return String(str)
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#39;");
}

// ── Keyboard shortcut: Ctrl/Cmd + Enter → run ─────────────────────────────────

document.addEventListener("keydown", evt => {
  if ((evt.ctrlKey || evt.metaKey) && evt.key === "Enter") runAnalysis();
});
