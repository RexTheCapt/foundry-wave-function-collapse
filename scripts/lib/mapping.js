/**
 * Shape of a collection's mapping.json and helpers to normalize it.
 *
 * {
 *   "name": "Stone dungeon",
 *   "description": "Optional text",
 *   "boundary": ["wall"],              // optional default boundary tags for the generator
 *   "restricted": ["door"],            // optional tags that may only appear on marked edges
 *   "compatible": { "wall": ["floor"] }, // optional: which differing tags may face each other
 *   "tiles": {
 *     "floor.png": {                   // file name, relative to the collection directory
 *       "tags": { "n": ["floor"], "e": ["floor"], "s": ["floor"], "w": ["floor"] },
 *       "walls": [ { "c": [0, 0, 1, 0], "door": 0 } ],   // normalized 0..1 tile coordinates
 *       "weight": 1,
 *       "rotate": false
 *     }
 *   }
 * }
 */

import { SIDES, normalizeTags, normalizeTile } from "./wfc.js";

export const MAPPING_VERSION = 1;

export function emptyMapping(name = "") {
  return { version: MAPPING_VERSION, name, description: "", boundary: [], restricted: [], compatible: {}, tiles: {} };
}

export function emptyTileEntry() {
  return { tags: { n: [], e: [], s: [], w: [] }, walls: [], weight: 1, rotate: false };
}

/**
 * Normalize a tile entry as stored in mapping.json.
 * @param {object} raw
 */
export function normalizeTileEntry(raw) {
  const t = normalizeTile({ ...(raw ?? {}), id: "x", src: "x" });
  const tags = {};
  for (const side of SIDES) tags[side] = t.tags[side];
  return { tags, walls: t.walls, weight: t.weight, rotate: t.rotate };
}

/**
 * Normalize a whole mapping object. Unknown keys are dropped.
 * @param {object} raw
 * @param {string} fallbackName
 */
export function normalizeMapping(raw, fallbackName = "") {
  const mapping = emptyMapping(fallbackName);
  if (!raw || typeof raw !== "object") return mapping;
  if (typeof raw.name === "string" && raw.name.trim()) mapping.name = raw.name.trim();
  if (typeof raw.description === "string") mapping.description = raw.description;
  mapping.boundary = normalizeTags(raw.boundary);
  mapping.restricted = normalizeTags(raw.restricted);
  mapping.compatible = normalizeCompatible(raw.compatible);
  const tiles = raw.tiles && typeof raw.tiles === "object" ? raw.tiles : {};
  for (const [file, entry] of Object.entries(tiles)) {
    if (!file || file.includes("/") || file.includes("\\")) continue;
    mapping.tiles[file] = normalizeTileEntry(entry);
  }
  return mapping;
}

/** Normalize a compatibility object: tag -> sorted unique tags. Empty entries are dropped. */
export function normalizeCompatible(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [tag, list] of Object.entries(raw)) {
    const key = String(tag).trim();
    if (!key) continue;
    out[key] = normalizeTags(list);
  }
  return out;
}

/** Compatibility object as editable text: one "tag: other, other" line per tag. */
export function compatibleToText(compatible) {
  return Object.entries(compatible ?? {}).map(([tag, list]) => `${tag}: ${list.join(", ")}`).join("\n");
}

/** Parse the text format produced by `compatibleToText`. Lines without a colon are ignored. */
export function compatibleFromText(text) {
  const out = {};
  for (const line of String(text ?? "").split(/\r?\n|;/)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const tag = line.slice(0, idx).trim();
    if (!tag) continue;
    out[tag] = normalizeTags(line.slice(idx + 1));
  }
  return out;
}

/** Short human readable summary of a tile's side tags, e.g. "N floor · E wall · S floor · W wall". */
export function describeTags(tags) {
  return SIDES.map(s => `${s.toUpperCase()} ${tags[s]?.length ? tags[s].join(",") : "—"}`).join(" · ");
}
