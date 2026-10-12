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
 * `{ "wall": ["floor"] }` meaning a wall side may face a floor side, and its "incompatible"
 * object, e.g. `{ "door": ["wall", "door"] }` meaning a door side never faces a wall or door
 * side, whatever the other rules say.
 *
 * Both relations are symmetric. A tag that appears as a key of "compatible" no longer matches
 * itself unless it lists itself; tags that never appear as a key keep matching themselves.
 * @param {Record<string, string[]|string>|null|undefined} spec
 * @param {Record<string, string[]|string>|null|undefined} [incompatibleSpec]
 * @returns {{pairs: Map<string, Set<string>>, explicit: Set<string>, incompatible: Map<string, Set<string>>}}
 */
export function buildCompatibility(spec, incompatibleSpec = null) {
  const pairs = new Map();
  const explicit = new Set();
  const incompatible = new Map();
  const add = (map, x, y) => {
    if (!map.has(x)) map.set(x, new Set());
    map.get(x).add(y);
  };
  for (const [rawTag, list] of Object.entries(spec ?? {})) {
    const tag = String(rawTag).trim();
    if (!tag) continue;
    explicit.add(tag);
    for (const other of normalizeTags(list)) {
      add(pairs, tag, other);
      add(pairs, other, tag);
    }
  }
  for (const [rawTag, list] of Object.entries(incompatibleSpec ?? {})) {
    const tag = String(rawTag).trim();
    if (!tag) continue;
    for (const other of normalizeTags(list)) {
      add(incompatible, tag, other);
      add(incompatible, other, tag);
    }
  }
  return { pairs, explicit, incompatible };
}

/** Whether two single tags are listed as incompatible. */
export function tagsIncompatible(x, y, compat = null) {
  return compat?.incompatible?.get(x)?.has(y) === true;
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
 * A side's tags are either one tag set (array of strings) or several alternative sets (array of
 * arrays). This returns the list of alternatives in either case.
 * @param {string[]|string[][]} tags
 * @returns {string[][]}
 */
export function sideAlternatives(tags) {
  if (!Array.isArray(tags)) return [[]];
  return tags.length && Array.isArray(tags[0]) ? tags : [tags];
}

/**
 * Normalize a side's tags from mapping.json or the editor. Accepts a string such as
 * "floor | wall, rubble" (alternatives separated by "|", tags by ","), a flat array (one set) or
 * an array of arrays (alternatives). Returns a flat array for a single set and an array of
 * arrays for several alternatives.
 * @param {string|string[]|string[][]|null|undefined} raw
 * @returns {string[]|string[][]}
 */
export function normalizeSideTags(raw) {
  let alternatives;
  if (raw === null || raw === undefined) alternatives = [[]];
  else if (typeof raw === "string") alternatives = raw.split("|").map(normalizeTags);
  else if (Array.isArray(raw)) {
    if (raw.some(Array.isArray)) alternatives = raw.map(normalizeTags);
    else if (raw.some(x => String(x).includes("|"))) alternatives = raw.join(",").split("|").map(normalizeTags);
    else alternatives = [normalizeTags(raw)];
  } else alternatives = [[]];
  const seen = new Set();
  const unique = [];
  for (const alt of alternatives) {
    const key = alt.join("\u0001");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(alt);
  }
  const nonEmpty = unique.filter(a => a.length);
  const out = nonEmpty.length ? nonEmpty : [[]];
  return out.length === 1 ? out[0] : out;
}

/** Editor text for a side's tags: alternatives joined with " | ". */
export function sideTagsToText(tags) {
  return sideAlternatives(tags).map(a => a.join(", ")).join(" | ");
}

/**
 * Two sides match when any alternative set of one is compatible with any alternative set of the
 * other. Two sets are compatible when every tag on each side is compatible with a tag on the
 * other side, or when either contains the wildcard. Without a compatibility table this is set
 * equality.
 * @param {string[]|string[][]} a
 * @param {string[]|string[][]} b
 * @param {{pairs: Map<string, Set<string>>, explicit: Set<string>}|null} [compat]
 * @returns {boolean}
 */
export function tagsMatch(a, b, compat = null) {
  for (const x of sideAlternatives(a)) {
    for (const y of sideAlternatives(b)) if (setsMatch(x, y, compat)) return true;
  }
  return false;
}

function setsMatch(a, b, compat) {
  // An incompatible pair vetoes the match before anything else, wildcards included.
  if (compat?.incompatible?.size) {
    for (const x of a) for (const y of b) if (tagsIncompatible(x, y, compat)) return false;
  }
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
  for (const side of SIDES) tags[side] = normalizeSideTags(raw.tags?.[side]);
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
  return `${SIDES.map(s => sideAlternatives(v.tags[s]).map(a => a.join("|")).join("||")).join("/")}#${walls}`;
}

/**
 * Expand tiles into variants: one per rotation and per combination of the alternative tag sets
 * of its sides, so every variant has exactly one tag set per side. Combinations that produce an
 * identical variant (for symmetric tiles) are dropped so the tile does not become more likely
 * than intended. Each variant keeps the tile's full weight.
 * @param {ReturnType<typeof normalizeTile>[]} tiles
 */
export function expandVariants(tiles) {
  const variants = [];
  for (const tile of tiles) {
    const rotations = tile.rotate ? [0, 90, 180, 270] : [0];
    const seen = new Set();
    for (const r of rotations) {
      const v = rotateTile(tile, r);
      const features = tileFeatures(v.walls);
      const alternatives = SIDES.map(side => sideAlternatives(v.tags[side]));
      const combos = alternatives.reduce((acc, alts) => acc.flatMap(prefix => alts.map(alt => [...prefix, alt])), [[]]);
      for (const combo of combos) {
        const tags = {};
        SIDES.forEach((side, k) => { tags[side] = combo[k]; });
        const candidate = { tile, rotation: v.rotation, tags, walls: v.walls, features, weight: tile.weight };
        const sig = variantSignature(candidate);
        if (seen.has(sig)) continue;
        seen.add(sig);
        variants.push(candidate);
      }
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
const PLACES = [...SIDES, CENTER];

/**
 * Build the test a variant must pass for one place (side or center) of a cell, or null when the
 * place is unconstrained. Boundary tags apply only when the side faces the open outside and no
 * constraint already dictates the side.
 */
function placeTest(place, c, compatTable, boundary) {
  const dictated = c?.compatibleWith || c?.require || c?.requireFeatures?.length || c?.requireAny?.length;
  const require = c?.require ? normalizeTags(c.require) : (boundary?.length && !dictated ? normalizeTags(boundary) : null);
  const compatibleWith = c?.compatibleWith ? normalizeSideTags(c.compatibleWith) : null;
  const forbid = c?.forbid ? normalizeTags(c.forbid) : null;
  const requireFeatures = c?.requireFeatures?.length ? normalizeTags(c.requireFeatures) : null;
  const forbidFeatures = c?.forbidFeatures?.length ? normalizeTags(c.forbidFeatures) : null;
  const requireAny = c?.requireAny?.length ? normalizeTags(c.requireAny) : null;
  if (!require && !compatibleWith && !forbid && !requireFeatures && !forbidFeatures && !requireAny) return null;
  return v => {
    const features = v.features?.[place] ?? [];
    if (requireFeatures && !requireFeatures.every(f => features.includes(f))) return false;
    if (forbidFeatures && features.some(f => forbidFeatures.includes(f))) return false;
    if (requireAny && !requireAny.every(e => features.includes(e) || (place !== CENTER && tagsMatch(v.tags[place], [e])))) return false;
    if (place === CENTER) return true;
    const tags = v.tags[place];
    if (require && !tagsMatch(tags, require)) return false;
    if (compatibleWith && !tagsMatch(tags, compatibleWith, compatTable)) return false;
    if (forbid && sideAlternatives(tags).every(alt => alt.some(t => forbid.includes(t)))) return false;
    return true;
  };
}

/**
 * Variants that satisfy a single cell's constraints, using the same rules as `solve`. Sides
 * without a constraint are unconstrained (no boundary tags are applied).
 * @param {object[]} variants
 * @param {Record<string, object>} cellConstraints
 * @param {Record<string, string[]>|null} compatible
 */
export function allowedVariants(variants, cellConstraints, compatible = null, incompatible = null) {
  const compatTable = buildCompatibility(compatible, incompatible);
  const tests = PLACES.map(place => placeTest(place, cellConstraints?.[place], compatTable, null)).filter(Boolean);
  return variants.filter(v => tests.every(t => t(v)));
}

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
 * @param {Record<string, string[]>|null} [options.incompatible]  Tag pairs that never face each other.
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
 * @param {number} [options.maxAttempts]  Restarts allowed after a search exhausts its backtracking budget.
 * @param {number} [options.maxBacktracks]  Backtracking steps allowed per attempt.
 * @returns {{success: boolean, attempts: number, assignments: {cell: object, variant: object, variantIndex: number}[], failedCell: object|null, failure: {stage: string, cell: object, from?: object}|null}}
 *   `failure.stage` is "constraints" when a cell has no variant satisfying its own constraints,
 *   "propagation" when the initial propagation emptied a cell (`from` is the neighbouring cell
 *   that forced it), "shared" when a shared edge requirement could not be met, or "collapse"
 *   when a random choice led to a dead end (which triggers a restart).
 */
export function solve({ cells, variants, boundaryTags = null, compatible = null, incompatible = null, constraints = null, shared = [], seed = "", maxAttempts = 5, maxBacktracks = 20000 }) {
  const V = variants.length;
  const N = cells.length;
  if (!V) throw new Error("No tile variants to solve with");
  if (!N) return { success: true, attempts: 0, assignments: [], failedCell: null, failure: null };

  const index = new Map(cells.map((c, k) => [cellKey(c.i, c.j), k]));
  const neighbors = cells.map(c => SIDES.map(side => {
    const [di, dj] = DELTAS[side];
    return index.get(cellKey(c.i + di, c.j + dj)) ?? -1;
  }));

  const compatTable = buildCompatibility(compatible, incompatible);

  // A shared tag requirement whose tags only ever match themselves means both sides must carry
  // exactly those tags: enforce it on both cells up front instead of lazily.
  const unaryShared = [];
  const lazyShared = [];
  for (const r of shared ?? []) {
    const tags = r.tags ? normalizeTags(r.tags) : null;
    const selfOnly = tags && !tags.includes(WILDCARD) && tags.every(t => !compatTable.explicit.has(t));
    if (selfOnly) unaryShared.push(r); else lazyShared.push(r);
  }
  if (unaryShared.length) {
    constraints = cells.map((c, k) => ({ ...(constraints?.[k] ?? {}) }));
    for (const r of unaryShared) {
      for (const [k, side] of [[r.a, r.sideA], [r.b, r.sideB]]) {
        const existing = constraints[k][side]?.require;
        constraints[k][side] = { ...constraints[k][side], require: existing ? normalizeTags([...normalizeTags(existing), ...normalizeTags(r.tags)]) : normalizeTags(r.tags) };
      }
    }
  }

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
  const allowedMasks = cells.map((cell, k) => PLACES.map((place, s) => {
    const c = constraints?.[k]?.[place];
    const outside = place !== CENTER && neighbors[k][s] === -1;
    const test = placeTest(place, c, compatTable, outside ? boundary : null);
    return test ? Uint8Array.from(variants, v => (test(v) ? 1 : 0)) : null;
  }));

  // Binary "at least one side offers the feature / carries the tags" requirements, as masks.
  const sharedMasks = lazyShared.map(r => {
    const test = (v, side) => {
      if (r.feature) return (v.features?.[side] ?? []).includes(r.feature);
      if (r.tags) return tagsMatch(v.tags[side], normalizeTags(r.tags));
      if (r.any) return (v.features?.[side] ?? []).includes(r.any) || tagsMatch(v.tags[side], [r.any]);
      return false;
    };
    return {
      a: r.a,
      b: r.b,
      sideIndex: SIDES.indexOf(r.sideA),
      maskA: Uint8Array.from(variants, v => (test(v, r.sideA) ? 1 : 0)),
      maskB: Uint8Array.from(variants, v => (test(v, r.sideB) ? 1 : 0))
    };
  });

  const weights = Float64Array.from(variants, v => v.weight);
  const weightLog = Float64Array.from(weights, w => w * Math.log(w));

  let last = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = mulberry32(hashSeed(`${seed}#${attempt}`));
    last = attemptSolve({ N, V, cells, variants, neighbors, compat, allowedMasks, shared: sharedMasks, weights, weightLog, rng, maxBacktracks });
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
export function describeCellConstraints(cellConstraints, variants, compatible = null, { outside = [], boundaryTags = [], incompatible = null } = {}) {
  const compat = buildCompatibility(compatible, incompatible);
  const boundary = normalizeTags(boundaryTags);
  const lines = [];
  const count = test => variants.filter(test).length;
  for (const place of [...SIDES, CENTER]) {
    const c = cellConstraints?.[place] ?? {};
    const name = { n: "north", e: "east", s: "south", w: "west", c: "center" }[place];
    const open = outside.includes(place) && !c.compatibleWith && !c.require && !c.requireFeatures?.length && !c.requireAny?.length;
    const require = c.require ? normalizeTags(c.require) : (open && boundary.length ? boundary : null);
    if (require) lines.push(`${name} must be exactly [${require}] (${count(v => tagsMatch(v.tags[place], require))} variants)`);
    if (c.compatibleWith) {
      const cw = normalizeSideTags(c.compatibleWith);
      lines.push(`${name} must be compatible with [${sideTagsToText(cw)}] (${count(v => tagsMatch(v.tags[place], cw, compat))} variants)`);
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

function attemptSolve({ N, V, cells, variants, neighbors, compat, allowedMasks, shared, weights, weightLog, rng, maxBacktracks }) {
  const domains = Array.from({ length: N }, () => new Uint8Array(V).fill(1));
  const counts = new Int32Array(N).fill(V);
  const inQueue = new Uint8Array(N);
  const stack = [];
  // Every removal is recorded so a failed choice can be undone.
  const trail = [];
  // Cells whose domain changed since the shared edge requirements were last checked.
  const dirty = new Uint8Array(N);
  const dirtyList = [];
  const remove = (k, a) => {
    domains[k][a] = 0;
    counts[k]--;
    trail.push(k * V + a);
    if (!dirty[k]) { dirty[k] = 1; dirtyList.push(k); }
  };
  const undoTo = mark => {
    while (trail.length > mark) {
      const t = trail.pop();
      const k = (t / V) | 0;
      domains[k][t - k * V] = 1;
      counts[k]++;
    }
    for (const k of stack) inQueue[k] = 0;
    stack.length = 0;
    for (const k of dirtyList) dirty[k] = 0;
    dirtyList.length = 0;
  };

  // Apply per-side constraints and seed the propagation queue with every cell.
  for (let k = 0; k < N; k++) {
    const d = domains[k];
    for (let s = 0; s < 5; s++) {
      const ok = allowedMasks[k][s];
      if (!ok) continue;
      for (let a = 0; a < V; a++) if (d[a] && !ok[a]) remove(k, a);
    }
    if (counts[k] === 0) return { success: false, assignments: [], failedCell: cells[k], failure: { stage: "constraints", cell: cells[k] } };
    inQueue[k] = 1;
    stack.push(k);
    if (!dirty[k]) { dirty[k] = 1; dirtyList.push(k); }
  }

  /**
   * Enforce one shared edge requirement as a binary constraint: a variant x of cell a survives
   * when it satisfies the requirement itself, or when some still-possible variant y of cell b
   * satisfies it and may sit next to x. Likewise for b. Returns true when both domains stay
   * non-empty.
   */
  const enforceShared = r => {
    const da = domains[r.a];
    const db = domains[r.b];
    const m = compat[r.sideIndex];
    let changedA = false;
    for (let x = 0; x < V; x++) {
      if (!da[x] || r.maskA[x]) continue;
      let supported = false;
      const row = x * V;
      for (let y = 0; y < V; y++) {
        if (db[y] && r.maskB[y] && m[row + y]) { supported = true; break; }
      }
      if (!supported) { remove(r.a, x); changedA = true; }
    }
    if (counts[r.a] === 0) return false;
    let changedB = false;
    for (let y = 0; y < V; y++) {
      if (!db[y] || r.maskB[y]) continue;
      let supported = false;
      for (let x = 0; x < V; x++) {
        if (da[x] && r.maskA[x] && m[x * V + y]) { supported = true; break; }
      }
      if (!supported) { remove(r.b, y); changedB = true; }
    }
    if (counts[r.b] === 0) return false;
    if (changedA && !inQueue[r.a]) { inQueue[r.a] = 1; stack.push(r.a); }
    if (changedB && !inQueue[r.b]) { inQueue[r.b] = 1; stack.push(r.b); }
    return true;
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
            if (dn[b] && !allowed[b]) { remove(n, b); changed = true; }
          }
          if (counts[n] === 0) return { cell: n, from: k, stage: "propagation" };
          if (changed && !inQueue[n]) { inQueue[n] = 1; stack.push(n); }
        }
      }
      // Shared edge requirements touching a cell that changed since the last check.
      if (!dirtyList.length) return null;
      const round = dirtyList.splice(0);
      for (const r of shared) {
        if (!dirty[r.a] && !dirty[r.b]) continue;
        if (!enforceShared(r)) {
          for (const k of round) dirty[k] = 0;
          return { cell: counts[r.a] === 0 ? r.a : r.b, from: counts[r.a] === 0 ? r.b : r.a, stage: "shared" };
        }
      }
      for (const k of round) dirty[k] = 0;
      if (!stack.length && !dirtyList.length) return null;
    }
  };

  const fail = (info, stage = info.stage) => ({
    success: false,
    assignments: [],
    failedCell: cells[info.cell],
    failure: { stage, cell: cells[info.cell], from: info.from === undefined ? undefined : cells[info.from] }
  });

  const initial = propagate();
  if (initial) return fail(initial);

  // Pick the unresolved cell with the lowest weighted entropy, or -1 when all are resolved.
  const pickCell = () => {
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
    return best;
  };

  // Candidate order for a cell: weighted random order without replacement.
  const orderCandidates = k => {
    const d = domains[k];
    const keyed = [];
    for (let a = 0; a < V; a++) if (d[a]) keyed.push([Math.pow(rng(), 1 / weights[a]), a]);
    keyed.sort((x, y) => y[0] - x[0]);
    return keyed.map(x => x[1]);
  };

  // Depth-first search with backtracking.
  const decisions = [];
  let backtracks = 0;
  let lastFailure = null;
  for (;;) {
    const k = pickCell();
    if (k < 0) break;
    decisions.push({ cell: k, mark: trail.length, candidates: orderCandidates(k), index: 0 });
    let placed = false;
    while (decisions.length && !placed) {
      const dec = decisions[decisions.length - 1];
      undoTo(dec.mark);
      if (dec.index >= dec.candidates.length) {
        decisions.pop();
        if (++backtracks > maxBacktracks) {
          return { ...fail(lastFailure ?? { cell: dec.cell }, "collapse"), backtracks };
        }
        continue;
      }
      const chosen = dec.candidates[dec.index++];
      const d = domains[dec.cell];
      for (let a = 0; a < V; a++) if (d[a] && a !== chosen) remove(dec.cell, a);
      inQueue[dec.cell] = 1;
      stack.push(dec.cell);
      const failed = propagate();
      if (failed) { lastFailure = failed; backtracks++; if (backtracks > maxBacktracks) return { ...fail(failed, "collapse"), backtracks }; continue; }
      placed = true;
    }
    if (!placed) return { ...fail(lastFailure ?? { cell: 0 }, "collapse"), backtracks };
  }

  const assignments = [];
  for (let k = 0; k < N; k++) {
    const d = domains[k];
    const variantIndex = d.indexOf(1);
    assignments.push({ cell: cells[k], variant: variants[variantIndex], variantIndex });
  }
  return { success: true, assignments, failedCell: null, backtracks };
}
