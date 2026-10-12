/**
 * Shape of a collection's mapping.json and helpers to normalize it.
 *
 * {
 *   "name": "Stone dungeon",
 *   "description": "Optional text",
 *   "boundary": ["wall"],              // optional default boundary tags for the generator
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
  return { version: MAPPING_VERSION, name, description: "", boundary: [], tiles: {} };
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
  const tiles = raw.tiles && typeof raw.tiles === "object" ? raw.tiles : {};
  for (const [file, entry] of Object.entries(tiles)) {
    if (!file || file.includes("/") || file.includes("\\")) continue;
    mapping.tiles[file] = normalizeTileEntry(entry);
  }
  return mapping;
}

/** Short human readable summary of a tile's side tags, e.g. "N floor · E wall · S floor · W wall". */
export function describeTags(tags) {
  return SIDES.map(s => `${s.toUpperCase()} ${tags[s]?.length ? tags[s].join(",") : "—"}`).join(" · ");
}
