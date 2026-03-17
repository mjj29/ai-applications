/**
 * Resolution engine: given a BidNode, a context (seat, vul, intervention),
 * resolves the effective meaning and continuation, with a full trace.
 */

'use strict';

// ─── Condition matching ───────────────────────────────────────────────────────

function conditionMatches(condition, ctx) {
  if (condition.seats && !condition.seats.includes(ctx.seat)) return false;
  if (condition.vul   && !condition.vul.includes(ctx.vul))   return false;
  return true;
}

function conditionSpecificity(condition) {
  // More specific = higher score; used to pick winner when multiple match
  let score = 0;
  if (condition.seats) score += condition.seats.length === 1 ? 4 : 2;
  if (condition.vul)   score += condition.vul.length   === 1 ? 3 : 1;
  return score;
}

function bestVariant(variants, ctx) {
  if (!variants || variants.length === 0) return null;
  const matches = variants
    .filter(v => conditionMatches(v.condition, ctx))
    .sort((a, b) => conditionSpecificity(b.condition) - conditionSpecificity(a.condition));
  return matches[0] ?? null;
}

// ─── Intervention matching ────────────────────────────────────────────────────

function interventionMatches(branch, intervention) {
  const a = branch.after;
  const b = intervention;
  if (!a || !b) return false;
  if (a.type === 'any') return true;
  if (a.type !== b.type) {
    // any-suit matches any suit bid, any-double matches any double
    if (a.type === 'any-suit'   && b.type === 'suit')   return true;
    if (a.type === 'any-double' && b.type === 'double') return true;
    return false;
  }
  // Same type — check specifics
  if (a.type === 'suit') {
    return a.level === b.level && a.strain === b.strain;
  }
  if (a.type === 'double') {
    return !a.nature || a.nature === '?' || a.nature === b.nature;
  }
  return true;
}

function interventionSpecificity(branch) {
  const t = branch.after?.type;
  if (t === 'suit' || t === 'double' || t === 'notrump') return 3;
  if (t === 'any-suit' || t === 'any-double')            return 2;
  if (t === 'any')                                        return 1;
  return 0;
}

function bestBranch(competitive, intervention) {
  if (!competitive || !intervention) return null;
  const matches = competitive
    .filter(b => interventionMatches(b, intervention))
    .sort((a, b) => interventionSpecificity(b) - interventionSpecificity(a));
  return matches[0] ?? null;
}

// ─── Apply diffs to a node list ───────────────────────────────────────────────

function callKey(call) {
  if (!call) return '_null';
  if (call.type === 'bid') return `bid-${call.level}${call.strain}`;
  return call.type;
}

function applyDiffs(baseNodes, diffs) {
  // returns { nodes: ResolvedNode[], notes: string[] }
  const map = new Map(baseNodes.map(n => [callKey(n.call), { node: n, status: 'inherited', origin: { from: 'base' } }]));
  const notes = [];

  for (const diff of diffs ?? []) {
    if (diff.op === 'note') {
      notes.push(diff.text);
      continue;
    }
    const key = callKey(diff.call ?? diff.node?.call);
    if (diff.op === 'add') {
      map.set(key, { node: diff.node, status: 'added', origin: { from: 'diff' } });
    } else if (diff.op === 'override') {
      const existing = map.get(key);
      if (existing) {
        const merged = {
          ...existing.node,
          meaning:       diff.meaning       ? { ...existing.node.meaning, ...diff.meaning } : existing.node.meaning,
          continuations: diff.continuations ?? existing.node.continuations,
        };
        map.set(key, { node: merged, status: 'overridden', replaces: existing.node, origin: { from: 'diff' } });
      }
    } else if (diff.op === 'remove') {
      const existing = map.get(key);
      if (existing) {
        map.set(key, { ...existing, status: 'removed' });
      }
    }
  }

  return { nodes: [...map.values()], notes };
}

// ─── Main resolver ────────────────────────────────────────────────────────────

/**
 * Resolve a BidNode for a given context.
 * @param {object} node        - BidNode
 * @param {object} ctx         - { seat: 1|2|3|4, vul: 'nv'|'vul'|'fav'|'unfav', intervention?: Intervention }
 * @param {object} conventions - Record<string, Convention> from System
 * @returns {ResolutionResult}
 */
export function resolve(node, ctx, conventions = {}) {
  const result = {
    meaning:   null,
    nodes:     [],         // ResolvedNode[]
    notes:     [],
    trace:     {
      appliedVariant:  null,
      appliedBranch:   null,
    },
    ref:       null,       // if continuation is a ref, the convention id
  };

  // ── Step 1: Resolve meaning ──────────────────────────────────────────────
  result.meaning = { ...node.meaning };

  const variant = bestVariant(node.variants, ctx);
  if (variant) {
    result.trace.appliedVariant = variant;
    if (variant.meaningOverride) {
      result.meaning = { ...result.meaning, ...variant.meaningOverride };
    }
    if (variant.notes) result.notes.push(variant.notes);
  }

  // ── Step 2: Resolve base continuation (possibly overridden by variant) ───
  let baseContinuation = node.continuations;
  if (variant?.continuationOverride) {
    baseContinuation = variant.continuationOverride;
  } else if (variant?.continuationDiff) {
    // Apply variant diffs on top of base continuation nodes
    if (baseContinuation.type === 'nodes') {
      const { nodes, notes } = applyDiffs(baseContinuation.nodes, variant.continuationDiff);
      result.notes.push(...notes);
      baseContinuation = { type: 'nodes', nodes: nodes.map(r => r.node) };
    }
  }

  // ── Step 3: Resolve competitive branch (if intervention present) ─────────
  const branch = ctx.intervention ? bestBranch(node.competitive, ctx.intervention) : null;

  if (branch) {
    result.trace.appliedBranch = branch;
    if (branch.notes) result.notes.push(branch.notes);

    const branchContinuation = branch.continuation;

    if (branchContinuation.type === 'inherit') {
      // Inherit from variant-effective base, then apply competitive diffs
      const baseNodes = resolveBaseNodes(baseContinuation, conventions);
      const { nodes, notes } = applyDiffs(baseNodes, branchContinuation.diffs);
      result.nodes = nodes;
      result.notes.push(...notes);
    } else if (branchContinuation.type === 'ref') {
      result.ref  = branchContinuation.conventionId;
      result.nodes = resolveRef(branchContinuation.conventionId, conventions);
    } else if (branchContinuation.type === 'nodes') {
      result.nodes = branchContinuation.nodes.map(n => ({ node: n, status: 'inherited', origin: { from: 'base' } }));
    } else {
      result.nodes = [];
    }
  } else {
    // No competitive branch — use base continuation
    result.nodes = resolveBaseNodes(baseContinuation, conventions).map(n => ({
      node: n, status: 'inherited', origin: { from: 'base' }
    }));
    if (baseContinuation.type === 'ref') result.ref = baseContinuation.conventionId;
  }

  return result;
}

function resolveBaseNodes(continuation, conventions) {
  if (!continuation) return [];
  if (continuation.type === 'ref')
    return resolveRef(continuation.conventionId, conventions, continuation.params);
  if (continuation.type === 'nodes') {
    let nodes = continuation.nodes ?? [];
    for (const ref of continuation.refs ?? []) {
      nodes = [...nodes, ...resolveRef(ref.conventionId, conventions, ref.params)];
    }
    return nodes;
  }
  return [];
}

function resolveRef(conventionId, conventions, params) {
  const conv = conventions[conventionId];
  if (!conv) return [];
  const nodes = conv.nodes ?? [];
  if (!params || Object.keys(params).length === 0) return nodes;
  return nodes.map(n => materializeNodeParams(n, params));
}

// Substitute bound param values into a call (leaves placeholder if param unbound)
function materializeCall(call, params) {
  if (!call || call.type !== 'bid') return call;
  const hasLevelParam  = !!call.levelParam;
  const hasStrainParam = !!call.strainParam;
  if (!hasLevelParam && !hasStrainParam) return call;

  let level  = call.level;
  let strain = call.strain;
  const dropKeys = {};

  if (hasLevelParam) {
    const bound = params[call.levelParam];
    if (bound !== undefined) { level = parseInt(bound); dropKeys.levelParam = true; }
  }
  if (hasStrainParam) {
    const bound = params[call.strainParam];
    if (bound !== undefined) { strain = bound; dropKeys.strainParam = true; }
  }

  if (!Object.keys(dropKeys).length) return call; // nothing was bound
  const { levelParam, strainParam, ...rest } = call;
  return {
    ...rest,
    level,
    strain,
    ...(hasLevelParam  && !dropKeys.levelParam  ? { levelParam:  call.levelParam  } : {}),
    ...(hasStrainParam && !dropKeys.strainParam ? { strainParam: call.strainParam } : {}),
  };
}

function materializeNodeParams(node, params) {
  const call = materializeCall(node.call, params);
  const cont = node.continuations?.type === 'nodes'
    ? { type: 'nodes', nodes: node.continuations.nodes.map(c => materializeNodeParams(c, params)) }
    : node.continuations;
  if (call === node.call && cont === node.continuations) return node;
  return { ...node, call, continuations: cont };
}

// ─── Sequence resolver ────────────────────────────────────────────────────────

function callsMatch(a, b) {
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  if (a.type === 'bid') return a.level === b.level && a.strain === b.strain;
  return true; // pass, double, redouble
}

/**
 * Walk a system's bid tree following a parsed sequence of steps.
 * @param {object} sys   - System object
 * @param {Array}  steps - output of parseSequence()
 * @param {object} ctx   - { seat, vul }
 * @returns {{ path, finalNode, finalResolved, nextNodes, error }}
 */
export function resolveSequence(sys, steps, ctx) {
  const conventions = sys.conventions ?? {};
  // Start from openings + overcalls combined
  let currentNodes = [...(sys.openings ?? []), ...(sys.overcalls ?? [])];
  const path = [];
  let pendingIntervention = null;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (step.intervention) {
      pendingIntervention = step.intervention;
      continue;
    }
    if (!step.call) continue;

    const node = currentNodes.find(n => callsMatch(n.call, step.call));
    if (!node) {
      return {
        path,
        error: `Call not found in tree at step ${i + 1} (after ${path.length} matched steps)`,
        nextNodes: currentNodes,
        finalNode:     null,
        finalResolved: null,
      };
    }

    const stepCtx = { ...ctx, intervention: pendingIntervention };
    const resolved = resolve(node, stepCtx, conventions);
    path.push({ node, call: step.call, resolved, intervention: pendingIntervention });
    pendingIntervention = null;

    currentNodes = resolved.nodes
      .filter(r => r.status !== 'removed')
      .map(r => r.node ?? r);
  }

  const last = path.at(-1);
  return {
    path,
    finalNode:     last?.node ?? null,
    finalResolved: last?.resolved ?? null,
    nextNodes:     currentNodes,
    error:         null,
  };
}
