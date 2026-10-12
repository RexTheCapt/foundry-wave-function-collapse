/**
 * Wave function collapse solver for square-grid tile sets.
 *
 * This module has no Foundry dependencies so it can be unit tested with plain node.
 *
 * Terminology
 * - tile:     an image plus the tags on its four sides, its walls and a weight.
 * - variant:  a tile at a specific rotation (0, 90, 180 or 270 degrees clockwise).
 * - cell:     a grid position { i: row, j: column } that needs a variant.
 *
 * Side tags are compared as sets. A variant may sit next to another variant when
 * the tag set on the shared side is identical on both tiles. The wildcard tag "*"
 * matches any tag set.
 */

export const SIDES = ["n", "e", "s", "w"];
export const OPPOSITE = { n: "s", e: "w", s: "n", w: "e" };
export const DELTAS = { n: [-1, 0], e: [0, 1], s: [1, 0], w: [0, -1] };
export const WILDCARD = "*";
export const CENTER = "c";
export const DOOR_FEATURES = { 1: "door", 2: "secret" };

/**
 * Features a tile offers, derived from its door segments: a door segment lying on a tile edge is
 * a feature of that side, any other door segment is a feature of the tile center ("c").
 * @param {{c: number[], door: number}[]} walls
 * @returns {Record<string, string[]>}  Sorted unique feature names per side plus "c".
 */
export function tileFeatures(walls) {
  const out = { n: new Set(), e: new Set(), s: new Set(), w: new Set(), [CENTER]: new Set() };
  const eps = 1e-6;
  for (const w of walls) {
    const name = DOOR_FEATURES[w.door];
    if (!name) continue;
    const [x1, y1, x2, y2] = w.c;
    let where = CENTER;
    if (Math.abs(y1) < eps && Math.abs(y2) < eps) where = "n";
    else if (Math.abs(y1 - 1) < eps && Math.abs(y2 - 1) < eps) where = "s";
    else if (Math.abs(x1) < eps && Math.abs(x2) < eps) where = "w";
    else if (Math.abs(x1 - 1) < eps && Math.abs(x2 - 1) < eps) where = "e";
    out[where].add(name);
  }
  const result = {};
  for (const [k, set] of Object.entries(out)) result[k] = [...set].sort();
  return result;
}

/**
 * Normalize a tag list (array or comma separated string) into a sorted array of unique strings.
 * @param {string[]|string|null|undefined} tags
 * @returns {string[]}
 */
export function normalizeTags(tags) {
  if (tags === null || tags === undefined) return [];
  const list = Array.isArray(tags) ? tags : String(tags).split(",");
  const set = new Set();
  for (const t of list) {
    const s = String(t).trim();
    if (s) set.add(s);
  }
  return [...set].sort();
}

/**
 * Build a tag compatibility table from a mapping's "compatible" object, e.g.
 * `{ "wall": ["floor"] }` meaning a wall side may face a floor side.
 *
 * The relation is symmetric. A tag that appears as a key no longer matches itself unless it lists
 * itself; tags that never appear as a key keep matching themselves.
 * @param {Record<string, string[]|string>|null|undefined} spec
 * @returns {{pairs: Map<string, Set<string>>, explicit: Set<string>}}
 */
export function buildCompatibility(spec) {
  const pairs = new Map();
  const explicit = new Set();
  const add = (x, y) => {
    if (!pairs.has(x)) pairs.set(x, new Set());
    pairs.get(x).add(y);
  };
  for (const [rawTag, list] of Object.entries(spec ?? {})) {
    const tag = String(rawTag).trim();
    if (!tag) continue;
    explicit.add(tag);
    for (const other of normalizeTags(list)) {
      add(tag, other);
      add(other, tag);
    }
  }
  return { pairs, explicit };
}

/** Merge several compatibility specs (objects) into one. */
export function mergeCompatibility(specs) {
  const merged = {};
  for (const spec of specs) {
    for (const [tag, list] of Object.entries(spec ?? {})) {
      merged[tag] = normalizeTags([...(merged[tag] ?? []), ...normalizeTags(list)]);
    }
  }
  return merged;
}

/** Whether two single tags may face each other. */
export function tagCompatible(x, y, compat = null) {
  if (x === y) return !compat?.explicit.has(x) || compat.pairs.get(x)?.has(x) === true;
  return compat?.pairs.get(x)?.has(y) === true;
}

/**
 * Two normalized tag lists match when every tag on each side is compatible with a tag on the
 * other side, or when either contains the wildcard. Without a compatibility table this is set
 * equality.
 * @param {string[]} a
 * @param {string[]} b
 * @param {{pairs: Map<string, Set<string>>, explicit: Set<string>}|null} [compat]
 * @returns {boolean}
 */
export function tagsMatch(a, b, compat = null) {
  if (a.includes(WILDCARD) || b.includes(WILDCARD)) return true;
  if (!compat || !compat.pairs.size) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  if (!a.length || !b.length) return a.length === b.length;
  return a.every(x => b.some(y => tagCompatible(x, y, compat)))
    && b.every(y => a.some(x => tagCompatible(x, y, compat)));
}

/**
 * Rotate a point in normalized tile space (0..1, y down) clockwise around the tile center.
 * @param {[number, number]} point
 * @param {number} rotation  Degrees, multiple of 90.
 * @returns {[number, number]}
 */
export function rotatePoint([x, y], rotation) {
  const r = ((rotation % 360) + 360) % 360;
  switch (r) {
    case 0: return [x, y];
    case 90: return [1 - y, x];
    case 180: return [1 - x, 1 - y];
    case 270: return [y, 1 - x];
    default: throw new Error(`Unsupported rotation ${rotation}`);
  }
}

/**
 * Coerce a raw tile definition (as found in mapping.json) into the shape the solver expects.
 * @param {object} raw
 * @returns {{id: string, src: string, tags: Record<string, string[]>, walls: {c: number[], door: number}[], weight: number, rotate: boolean}}
 */
export function normalizeTile(raw) {
  const tags = {};
  for (const side of SIDES) tags[side] = normalizeTags(raw.tags?.[side]);
  const walls = [];
  for (const w of raw.walls ?? []) {
    const c = Array.isArray(w) ? w : w?.c;
    if (!Array.isArray(c) || c.length !== 4) continue;
    const coords = c.map(Number);
    if (coords.some(Number.isNaN)) continue;
    const door = Number(Array.isArray(w) ? 0 : (w.door ?? 0)) || 0;
    walls.push({ c: coords, door: Math.min(2, Math.max(0, door)) });
  }
  const weight = Number(raw.weight);
  return {
    id: raw.id ?? raw.src ?? "",
    src: raw.src ?? raw.id ?? "",
    tags,
    walls,
    weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
    rotate: Boolean(raw.rotate)
  };
}

/**
 * Produce a rotated copy of a normalized tile.
 * A clockwise rotation moves the north side to the east.
 * @param {ReturnType<typeof normalizeTile>} tile
 * @param {number} rotation
 */
export function rotateTile(tile, rotation) {
  const steps = (((Math.round(rotation / 90)) % 4) + 4) % 4;
  const tags = {};
  for (let k = 0; k < 4; k++) tags[SIDES[(k + steps) % 4]] = tile.tags[SIDES[k]];
  const walls = tile.walls.map(w => {
    const [x1, y1, x2, y2] = w.c;
    const [a, b] = rotatePoint([x1, y1], steps * 90);
    const [c, d] = rotatePoint([x2, y2], steps * 90);
    return { ...w, c: [a, b, c, d] };
  });
  return { ...tile, rotation: steps * 90, tags, walls };
}

function variantSignature(v) {
  const walls = v.walls
    .map(w => `${w.door}:${w.c.map(n => Math.round(n * 1000) / 1000).join(",")}`)
    .sort()
    .join(";");
  return `${SIDES.map(s => v.tags[s].join("|")).join("/")}#${walls}`;
}

/**
 * Expand tiles into rotation variants. Rotations that produce an identical variant
 * (for symmetric tiles) are dropped so the tile does not become more likely than intended.
 * @param {ReturnType<typeof normalizeTile>[]} tiles
 */
export function expandVariants(tiles) {
  const variants = [];
  for (const tile of tiles) {
    const rotations = tile.rotate ? [0, 90, 180, 270] : [0];
    const seen = new Set();
    for (const r of rotations) {
      const v = rotateTile(tile, r);
      const sig = variantSignature(v);
      if (seen.has(sig)) continue;
      seen.add(sig);
      variants.push({ tile, rotation: v.rotation, tags: v.tags, walls: v.walls, features: tileFeatures(v.walls), weight: tile.weight });
    }
  }
  return variants;
}

/** Small fast string hash (FNV-1a, 32 bit). */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG returning floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cellKey = (i, j) => `${i},${j}`;

/**
 * Solve a set of cells with the given variants.
 *
 * @param {object} options
 * @param {{i: number, j: number}[]} options.cells  Cells that need a tile.
 * @param {ReturnType<typeof expandVariants>} options.variants
 * @param {string[]|string|null} [options.boundaryTags]  When set, every side that faces outside
 *   the cell set must match these tags unless a per-side constraint says otherwise. When null or
 *   empty the outside is unconstrained.
 * @param {Record<string, string[]>|null} [options.compatible]  Tag compatibility table, see
 *   `buildCompatibility`. Without it, adjacent sides must carry identical tag sets.
 * @param {Array<Record<string, {require?: string[], compatibleWith?: string[], forbid?: string[], requireFeatures?: string[], forbidFeatures?: string[], requireAny?: string[]}>>|null} [options.constraints]
 *   Optional per-cell constraints, parallel to `cells`, keyed by side ("n", "e", "s", "w") or "c"
 *   for the tile center. `require` forces the side's tag set to be exactly these tags,
 *   `compatibleWith` forces it to be compatible with these tags (as if a tile with them sat next
 *   to it), `forbid` rejects any variant whose side contains one of the listed tags,
 *   `requireFeatures` demands door features on that side or in the center, `forbidFeatures`
 *   rejects variants offering them there, and `requireAny` lists entries that must each be
 *   present either as the side's exact tag or as a door feature on that side.
 * @param {Array<{a: number, sideA: string, b: number, sideB: string, feature?: string, tags?: string[], any?: string}>} [options.shared]
 *   Binary requirements across an edge: at least one of cell a (on sideA) or cell b (on sideB)
 *   must offer the feature, carry exactly the tags, or (for `any`) have that entry as its exact
 *   tag or as a door feature.
 * @param {string} [options.seed]
 * @param {number} [options.maxAttempts]  Restarts allowed on contradiction.
 * @returns {{success: boolean, attempts: number, assignments: {cell: object, variant: object, variantIndex: number}[], failedCell: object|null, failure: {stage: string, cell: object, from?: object}|null}}
 *   `failure.stage` is "constraints" when a cell has no variant satisfying its own constraints,
 *   "propagation" when the initial propagation emptied a cell (`from` is the neighbouring cell
 *   that forced it), "shared" when a shared edge requirement could not be met, or "collapse"
 *   when a random choice led to a dead end (which triggers a restart).
 */
export function solve({ cells, variants, boundaryTags = null, compatible = null, constraints = null, shared = [], seed = "", maxAttempts = 20 }) {
  const V = variants.length;
  const N = cells.length;
  if (!V) throw new Error("No tile variants to solve with");
  if (!N) return { success: true, attempts: 0, assignments: [], failedCell: null, failure: null };

  const index = new Map(cells.map((c, k) => [cellKey(c.i, c.j), k]));
  const neighbors = cells.map(c => SIDES.map(side => {
    const [di, dj] = DELTAS[side];
    return index.get(cellKey(c.i + di, c.j + dj)) ?? -1;
  }));

  const compatTable = buildCompatibility(compatible);

  // compat[s][a * V + b] === 1 when variant a may have variant b on its side SIDES[s]
  const compat = SIDES.map(side => {
    const m = new Uint8Array(V * V);
    for (let a = 0; a < V; a++) {
      const ta = variants[a].tags[side];
      for (let b = 0; b < V; b++) {
        if (tagsMatch(ta, variants[b].tags[OPPOSITE[side]], compatTable)) m[a * V + b] = 1;
      }
    }
    return m;
  });

  const boundary = normalizeTags(boundaryTags);

  // allowed[k][s][a] === 1 when variant a satisfies the constraints of cell k on side SIDES[s]
  // (index 4 is the tile center).
  const PLACES = [...SIDES, CENTER];
  const allowedMasks = cells.map((cell, k) => PLACES.map((place, s) => {
    const c = constraints?.[k]?.[place];
    const outside = place !== CENTER && neighbors[k][s] === -1;
    const require = c?.require ? normalizeTags(c.require) : (outside && boundary.length ? boundary : null);
    const compatibleWith = c?.compatibleWith ? normalizeTags(c.compatibleWith) : null;
    const forbid = c?.forbid ? normalizeTags(c.forbid) : null;
    const requireFeatures = c?.requireFeatures?.length ? normalizeTags(c.requireFeatures) : null;
    const forbidFeatures = c?.forbidFeatures?.length ? normalizeTags(c.forbidFeatures) : null;
    const requireAny = c?.requireAny?.length ? normalizeTags(c.requireAny) : null;
    if (!require && !compatibleWith && !forbid && !requireFeatures && !forbidFeatures && !requireAny) return null;
    return Uint8Array.from(variants, v => {
      const features = v.features?.[place] ?? [];
      if (requireFeatures && !requireFeatures.every(f => features.includes(f))) return 0;
      if (forbidFeatures && features.some(f => forbidFeatures.includes(f))) return 0;
      if (requireAny && !requireAny.every(e => features.includes(e) || (place !== CENTER && tagsMatch(v.tags[place], [e])))) return 0;
      if (place === CENTER) return 1;
      const tags = v.tags[place];
      if (require && !tagsMatch(tags, require)) return 0;
      if (compatibleWith && !tagsMatch(tags, compatibleWith, compatTable)) return 0;
      if (forbid && tags.some(t => forbid.includes(t))) return 0;
      return 1;
    });
  }));

  // Binary "at least one side offers the feature / carries the tags" requirements, as masks.
  const sharedMasks = (shared ?? []).map(r => {
    const test = (v, side) => {
      if (r.feature) return (v.features?.[side] ?? []).includes(r.feature);
      if (r.tags) return tagsMatch(v.tags[side], normalizeTags(r.tags));
      if (r.any) return (v.features?.[side] ?? []).includes(r.any) || tagsMatch(v.tags[side], [r.any]);
      return false;
    };
    return {
      a: r.a,
      b: r.b,
      maskA: Uint8Array.from(variants, v => (test(v, r.sideA) ? 1 : 0)),
      maskB: Uint8Array.from(variants, v => (test(v, r.sideB) ? 1 : 0))
    };
  });

  const weights = Float64Array.from(variants, v => v.weight);
  const weightLog = Float64Array.from(weights, w => w * Math.log(w));

  let last = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = mulberry32(hashSeed(`${seed}#${attempt}`));
    last = attemptSolve({ N, V, cells, variants, neighbors, compat, allowedMasks, shared: sharedMasks, weights, weightLog, rng });
    if (last.success) return { ...last, attempts: attempt + 1, failure: null };
    // A failure before any random choice is deterministic: retrying cannot help.
    if (last.failure.stage !== "collapse") return { ...last, attempts: attempt + 1 };
  }
  return { success: false, attempts: maxAttempts, assignments: [], failedCell: last?.failedCell ?? null, failure: last?.failure ?? null };
}

/**
 * Human readable description of a cell's constraints and how many variants satisfy each one.
 * Useful to explain a "constraints" failure.
 * @param {Record<string, object>|undefined} cellConstraints
 * @param {object[]} variants
 * @param {Record<string, string[]>|null} compatible
 * @param {{outside?: string[], boundaryTags?: string[]}} [context]  Sides facing outside the region.
 * @returns {string[]}
 */
export function describeCellConstraints(cellConstraints, variants, compatible = null, { outside = [], boundaryTags = [] } = {}) {
  const compat = buildCompatibility(compatible);
  const boundary = normalizeTags(boundaryTags);
  const lines = [];
  const count = test => variants.filter(test).length;
  for (const place of [...SIDES, CENTER]) {
    const c = cellConstraints?.[place] ?? {};
    const name = { n: "north", e: "east", s: "south", w: "west", c: "center" }[place];
    const require = c.require ? normalizeTags(c.require) : (outside.includes(place) && boundary.length ? boundary : null);
    if (require) lines.push(`${name} must be exactly [${require}] (${count(v => tagsMatch(v.tags[place], require))} variants)`);
    if (c.compatibleWith) {
      const cw = normalizeTags(c.compatibleWith);
      lines.push(`${name} must be compatible with [${cw}] (${count(v => tagsMatch(v.tags[place], cw, compat))} variants)`);
    }
    if (c.forbid?.length) lines.push(`${name} must not have tags [${normalizeTags(c.forbid)}]`);
    if (c.requireFeatures?.length) {
      const rf = normalizeTags(c.requireFeatures);
      lines.push(`${name} must offer [${rf}] (${count(v => rf.every(f => (v.features?.[place] ?? []).includes(f)))} variants)`);
    }
    if (c.forbidFeatures?.length) lines.push(`${name} must not offer [${normalizeTags(c.forbidFeatures)}]`);
    if (c.requireAny?.length) {
      const ra = normalizeTags(c.requireAny);
      lines.push(`${name} must have [${ra}] as its tag or draw it as a door (${count(v => ra.every(e => (v.features?.[place] ?? []).includes(e) || (place !== CENTER && tagsMatch(v.tags[place], [e]))))} variants)`);
    }
  }
  return lines;
}

function attemptSolve({ N, V, cells, variants, neighbors, compat, allowedMasks, shared, weights, weightLog, rng }) {
  const domains = Array.from({ length: N }, () => new Uint8Array(V).fill(1));
  const counts = new Int32Array(N).fill(V);
  const inQueue = new Uint8Array(N);
  const stack = [];

  // Apply per-side constraints and seed the propagation queue with every cell.
  for (let k = 0; k < N; k++) {
    const d = domains[k];
    for (let s = 0; s < 5; s++) {
      const ok = allowedMasks[k][s];
      if (!ok) continue;
      for (let a = 0; a < V; a++) {
        if (d[a] && !ok[a]) { d[a] = 0; counts[k]--; }
      }
    }
    if (counts[k] === 0) return { success: false, assignments: [], failedCell: cells[k], failure: { stage: "constraints", cell: cells[k] } };
    inQueue[k] = 1;
    stack.push(k);
  }

  const restrictTo = (cell, mask) => {
    const d = domains[cell];
    let changed = false;
    for (let a = 0; a < V; a++) {
      if (d[a] && !mask[a]) { d[a] = 0; counts[cell]--; changed = true; }
    }
    if (changed && !inQueue[cell]) { inQueue[cell] = 1; stack.push(cell); }
    return counts[cell] > 0;
  };
  const canOffer = (cell, mask) => {
    const d = domains[cell];
    for (let a = 0; a < V; a++) if (d[a] && mask[a]) return true;
    return false;
  };

  const propagate = () => {
    const allowed = new Uint8Array(V);
    for (;;) {
      while (stack.length) {
        const k = stack.pop();
        inQueue[k] = 0;
        const dk = domains[k];
        for (let s = 0; s < 4; s++) {
          const n = neighbors[k][s];
          if (n < 0) continue;
          const m = compat[s];
          allowed.fill(0);
          for (let a = 0; a < V; a++) {
            if (!dk[a]) continue;
            const row = a * V;
            for (let b = 0; b < V; b++) if (m[row + b]) allowed[b] = 1;
          }
          const dn = domains[n];
          let changed = false;
          for (let b = 0; b < V; b++) {
            if (dn[b] && !allowed[b]) { dn[b] = 0; counts[n]--; changed = true; }
          }
          if (counts[n] === 0) return { cell: n, from: k, stage: "propagation" };
          if (changed && !inQueue[n]) { inQueue[n] = 1; stack.push(n); }
        }
      }
      // Shared edge requirements: when one side can no longer satisfy it, the other must.
      for (const r of shared) {
        const aCan = canOffer(r.a, r.maskA);
        const bCan = canOffer(r.b, r.maskB);
        if (!aCan && !bCan) return { cell: r.a, from: r.b, stage: "shared" };
        if (!aCan && !restrictTo(r.b, r.maskB)) return { cell: r.b, from: r.a, stage: "shared" };
        if (!bCan && !restrictTo(r.a, r.maskA)) return { cell: r.a, from: r.b, stage: "shared" };
      }
      if (!stack.length) return null;
    }
  };

  const fail = (info, stage = info.stage) => ({
    success: false,
    assignments: [],
    failedCell: cells[info.cell],
    failure: { stage, cell: cells[info.cell], from: info.from === undefined ? undefined : cells[info.from] }
  });

  let failed = propagate();
  if (failed) return fail(failed);

  for (;;) {
    // Pick the cell with the lowest weighted entropy among unresolved cells.
    let best = -1;
    let bestEntropy = Infinity;
    for (let k = 0; k < N; k++) {
      if (counts[k] <= 1) continue;
      const d = domains[k];
      let sumW = 0;
      let sumWL = 0;
      for (let a = 0; a < V; a++) {
        if (!d[a]) continue;
        sumW += weights[a];
        sumWL += weightLog[a];
      }
      const entropy = Math.log(sumW) - sumWL / sumW + rng() * 1e-6;
      if (entropy < bestEntropy) { bestEntropy = entropy; best = k; }
    }
    if (best < 0) break;

    // Collapse it to a single variant chosen by weight.
    const d = domains[best];
    let total = 0;
    for (let a = 0; a < V; a++) if (d[a]) total += weights[a];
    let pick = rng() * total;
    let chosen = -1;
    for (let a = 0; a < V; a++) {
      if (!d[a]) continue;
      pick -= weights[a];
      chosen = a;
      if (pick <= 0) break;
    }
    d.fill(0);
    d[chosen] = 1;
    counts[best] = 1;
    inQueue[best] = 1;
    stack.push(best);
    failed = propagate();
    if (failed) return fail(failed, "collapse");
  }

  const assignments = [];
  for (let k = 0; k < N; k++) {
    const d = domains[k];
    const variantIndex = d.indexOf(1);
    assignments.push({ cell: cells[k], variant: variants[variantIndex], variantIndex });
  }
  return { success: true, assignments, failedCell: null };
}
