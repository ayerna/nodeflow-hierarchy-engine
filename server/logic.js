/**
 * NodeFlow — Hierarchy Engine
 * Core pipeline: parse → filter → cluster → analyse → shape
 */

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 · Parse a single raw string into a structured edge or mark it invalid
// ─────────────────────────────────────────────────────────────────────────────

const EDGE_PATTERN = /^([A-Z])->([A-Z])$/;

function decodeEdge(raw) {
  const trimmed = typeof raw === "string" ? raw.trim() : String(raw).trim();
  const hit = trimmed.match(EDGE_PATTERN);

  if (!hit) return { ok: false, raw: trimmed };
  if (hit[1] === hit[2]) return { ok: false, raw: trimmed }; // self-loop → invalid

  return { ok: true, from: hit[1], to: hit[2], key: `${hit[1]}->${hit[2]}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 · Sweep the input array; bucket into valid, invalid, duplicate
// ─────────────────────────────────────────────────────────────────────────────

function sweepInputs(rawList) {
  const seen = new Set();
  const dupesSeen = new Set();
  const accepted = [];   // [{from, to, key}]
  const rejected = [];   // raw strings
  const dupes    = [];   // edge keys (once per unique repeated edge)

  for (const item of rawList) {
    const edge = decodeEdge(item);

    if (!edge.ok) {
      rejected.push(edge.raw);
      continue;
    }

    if (seen.has(edge.key)) {
      if (!dupesSeen.has(edge.key)) {
        dupes.push(edge.key);
        dupesSeen.add(edge.key);
      }
    } else {
      seen.add(edge.key);
      accepted.push(edge);
    }
  }

  return { accepted, rejected, dupes };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 · Build adjacency from accepted edges
//           Diamond rule: first-seen parent edge for any child wins
// ─────────────────────────────────────────────────────────────────────────────

function buildAdjacency(accepted) {
  const childOf  = new Map();  // node → parent (first wins)
  const kids     = new Map();  // node → [children]
  const universe = new Set();

  for (const { from, to } of accepted) {
    universe.add(from);
    universe.add(to);

    if (childOf.has(to)) continue;  // already claimed by an earlier parent

    childOf.set(to, from);
    if (!kids.has(from)) kids.set(from, []);
    kids.get(from).push(to);
  }

  return { kids, childOf, universe };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 · Find connected components via simple iterative BFS flood-fill
//           Works on undirected neighbourhood (ignores edge direction)
// ─────────────────────────────────────────────────────────────────────────────

function connectedComponents(universe, accepted) {
  // Build undirected adjacency list for flood-fill purposes
  const nbr = new Map();
  for (const n of universe) nbr.set(n, new Set());
  for (const { from, to } of accepted) {
    nbr.get(from).add(to);
    nbr.get(to).add(from);
  }

  const visited = new Set();
  const clusters = [];

  for (const start of [...universe].sort()) {
    if (visited.has(start)) continue;

    const component = [];
    const queue = [start];
    visited.add(start);

    while (queue.length) {
      const node = queue.shift();
      component.push(node);
      for (const nb of (nbr.get(node) || [])) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }

    clusters.push(component.sort());
  }

  return clusters;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5 · Cycle check via Kahn's algorithm (BFS topological sort)
//           If nodes remain after topo-sort → cycle exists
// ─────────────────────────────────────────────────────────────────────────────

function containsCycle(nodes, kids) {
  const inDegree = new Map();
  for (const n of nodes) inDegree.set(n, 0);

  for (const n of nodes) {
    for (const child of (kids.get(n) || [])) {
      if (inDegree.has(child)) {
        inDegree.set(child, inDegree.get(child) + 1);
      }
    }
  }

  const queue = [];
  for (const [n, deg] of inDegree) {
    if (deg === 0) queue.push(n);
  }

  let processed = 0;
  while (queue.length) {
    const cur = queue.shift();
    processed++;
    for (const child of (kids.get(cur) || [])) {
      if (!inDegree.has(child)) continue;
      const newDeg = inDegree.get(child) - 1;
      inDegree.set(child, newDeg);
      if (newDeg === 0) queue.push(child);
    }
  }

  return processed < nodes.length; // leftover nodes = cycle
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 6 · Recursively expand a node into a nested JS object (the "tree" field)
// ─────────────────────────────────────────────────────────────────────────────

function expandSubtree(node, kids) {
  const branch = {};
  for (const child of (kids.get(node) || [])) {
    branch[child] = expandSubtree(child, kids);
  }
  return branch;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 7 · Longest root-to-leaf path (node count, not edge count)
// ─────────────────────────────────────────────────────────────────────────────

function longestPath(node, kids) {
  const children = kids.get(node) || [];
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map(c => longestPath(c, kids)));
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT · analyzeHierarchy
// ─────────────────────────────────────────────────────────────────────────────

function analyzeHierarchy(inputData) {
  const { accepted, rejected, dupes } = sweepInputs(inputData);
  const { kids, childOf, universe }   = buildAdjacency(accepted);
  const clusters                      = connectedComponents(universe, accepted);

  const hierarchies = [];

  for (const cluster of clusters) {
    // Nodes that never appear as a child within this cluster → root candidates
    const rootCandidates = cluster.filter(n => !childOf.has(n));

    // Pick canonical root: lex-smallest natural root, or lex-smallest overall for pure cycles
    const canonRoot = rootCandidates.length > 0
      ? rootCandidates.sort()[0]
      : cluster[0]; // already sorted → first = lex smallest

    if (containsCycle(cluster, kids)) {
      hierarchies.push({ root: canonRoot, tree: {}, has_cycle: true });
    } else {
      const treeObj = { [canonRoot]: expandSubtree(canonRoot, kids) };
      const depth   = longestPath(canonRoot, kids);
      hierarchies.push({ root: canonRoot, tree: treeObj, depth });
    }
  }

  // Order alphabetically by root label
  hierarchies.sort((a, b) => a.root < b.root ? -1 : a.root > b.root ? 1 : 0);

  // ── Summary ────────────────────────────────────────────────────────────────
  const validTrees  = hierarchies.filter(h => !h.has_cycle);
  const cyclicCount = hierarchies.length - validTrees.length;

  let biggestRoot = null;
  if (validTrees.length > 0) {
    const champion = validTrees.reduce((best, cur) => {
      if (cur.depth > best.depth) return cur;
      if (cur.depth === best.depth && cur.root < best.root) return cur;
      return best;
    });
    biggestRoot = champion.root;
  }

  return {
    hierarchies,
    invalid_entries : rejected,
    duplicate_edges : dupes,
    summary: {
      total_trees      : validTrees.length,
      total_cycles     : cyclicCount,
      largest_tree_root: biggestRoot,
    },
  };
}

module.exports = { analyzeHierarchy };
