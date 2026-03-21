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

/**
 * Check whether a BidNode call (our syntax) matches an incoming intervention.
 * Used to resolve isOpponentCall inline nodes in the continuations tree.
 */
function callMatchesIntervention(call, iv) {
  if (!call || !iv) return false;
  switch (iv.type) {
    case 'double':    return call.type === 'double';
    case 'redouble':  return call.type === 'redouble';
    case 'pass':      return call.type === 'pass';
    case 'suit':
      if (call.type !== 'bid' || call.strain === 'N') return false;
      if (iv.level  != null && call.level  != null && iv.level  !== call.level)  return false;
      if (iv.strain != null && call.strain != null && iv.strain !== call.strain) return false;
      return true;
    case 'notrump':
      if (call.type !== 'bid' || call.strain !== 'N') return false;
      if (iv.level != null && call.level != null && iv.level !== call.level) return false;
      return true;
    case 'any-suit':   return call.type === 'bid' && call.strain !== 'N';
    case 'any-double': return call.type === 'double';
    case 'any':        return true;
    default:           return false;
  }
}

// ─── Apply diffs to a node list ───────────────────────────────────────────────

function callKey(call) {
  if (!call) return '_null';
  if (call.type === 'bid') {
    // If level/strain are both resolved (param was bound or no param), use the concrete key
    if (call.level != null && call.strain != null && !call.levelParam && !call.strainParam)
      return `bid-${call.level}${call.strain}`;
    // Partially or fully unbound param bid — unique key so it doesn't accidentally clash
    const lk = call.levelParam  ? `{${call.levelParam}}`  : call.level;
    const sk = call.strainParam ? `{${call.strainParam}}` : (call.strain ?? '?');
    return `bid-${lk}${sk}`;
  }
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
    const inlineNodes = continuation.nodes ?? [];
    const refNodes = (continuation.refs ?? []).flatMap(ref =>
      resolveRef(ref.conventionId, conventions, ref.params));
    // Priority: explicit inline (parent) > parameterized convention bid > explicit convention bid.
    // Inline keys are pre-seeded so any matching ref node is silently dropped.
    // Within refs, first-ref-wins for the same concrete key.
    const seen = new Set(inlineNodes.map(n => callKey(n.call)));
    const filteredRefs = refNodes.filter(n => {
      const k = callKey(n.call);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return [...inlineNodes, ...filteredRefs];
  }
  return [];
}

function resolveRef(conventionId, conventions, params) {
  const conv = conventions[conventionId];
  if (!conv) return [];
  const nodes = conv.nodes ?? [];
  if (!params || Object.keys(params).length === 0) return nodes;
  return dedupeMatNodes(
    nodes.map(n => ({
      node: materializeNodeParams(n, params),
      isParam: !!(n.call?.levelParam || n.call?.strainParam),
    }))
  );
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

// Dedup materialized entries [{node, isParam}]: parameterized origin wins over
// explicit for the same concrete call key. First occurrence wins within each tier.
function dedupeMatNodes(entries) {
  const result = [];
  const seen = new Map(); // key -> { idx, isParam }
  for (const { node, isParam } of entries) {
    const k = callKey(node.call);
    if (seen.has(k)) {
      const slot = seen.get(k);
      if (isParam && !slot.isParam) { result[slot.idx] = node; slot.isParam = true; }
    } else {
      seen.set(k, { idx: result.length, isParam });
      result.push(node);
    }
  }
  return result;
}

function materializeNodeParams(node, params) {
  const call = materializeCall(node.call, params);
  let cont = node.continuations;
  if (node.continuations?.type === 'nodes') {
    // Recurse into each child and dedup: parameterized beats explicit at every level.
    const deduped = dedupeMatNodes(
      node.continuations.nodes.map(c => ({
        node: materializeNodeParams(c, params),
        isParam: !!(c.call?.levelParam || c.call?.strainParam),
      }))
    );
    // Preserve refs, resolving any {paramName} passthrough values with outer params.
    const refs = (node.continuations.refs ?? []).map(ref => {
      if (!ref.params || !Object.keys(ref.params).length) return ref;
      const resolvedParams = {};
      for (const [k, v] of Object.entries(ref.params)) {
        const match = typeof v === 'string' && v.match(/^\{(\w+)\}$/);
        resolvedParams[k] = (match && params[match[1]] !== undefined) ? params[match[1]] : v;
      }
      return { ...ref, params: resolvedParams };
    });
    cont = { type: 'nodes', nodes: deduped, ...(refs.length ? { refs } : {}) };
  }
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
      const lastNode = path.at(-1)?.node;
      if (lastNode) {
        // Preferred: find a matching isOpponentCall inline child node and traverse it
        const oppNode = currentNodes.find(
          n => n.isOpponentCall && callMatchesIntervention(n.call, step.intervention)
        );
        if (oppNode) {
          const oppResolved = resolve(oppNode, ctx, conventions);
          path.push({ node: oppNode, call: oppNode.call, resolved: oppResolved,
                      intervention: step.intervention });
          pendingIntervention = null; // consumed by the inline node
          currentNodes = oppResolved.nodes
            .filter(r => r.status !== 'removed')
            .map(r => r.node ?? r);
        } else {
          // Fallback: legacy competitive array on the previous node
          const compCtx = { ...ctx, intervention: step.intervention };
          const compResolved = resolve(lastNode, compCtx, conventions);
          currentNodes = compResolved.nodes
            .filter(r => r.status !== 'removed')
            .map(r => r.node ?? r);
        }
      } else {
        // Opponent bid leads the sequence — look only in overcalls
        currentNodes = sys.overcalls ?? [];
      }
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
