/**
 * Ties the solver to the active scene: places Tile and Wall documents for a solved outline.
 */

import { MODULE_ID } from "./constants.js";
import { cellsInPolygon, cellEdgeSegment, tileWallsForCell, mergeWalls, splitWallByCells, cellKey } from "./lib/geometry.js";
import { expandVariants, solve, normalizeTags, normalizeTile, rotateTile, tileFeatures, tagsMatch, mergeCompatibility, describeCellConstraints, SIDES, OPPOSITE, DELTAS, CENTER } from "./lib/wfc.js";
import { edgeCellSides } from "./lib/edges.js";
import { collectionTiles, loadCollections, getRegisteredDirs } from "./collections.js";
import { getMarkers } from "./markers.js";
import { log } from "./log.js";

export function assertSquareGrid() {
  if (!canvas.ready || !canvas.scene) throw new Error(game.i18n.localize("WFC.Errors.NoScene"));
  if (canvas.grid.type !== CONST.GRID_TYPES.SQUARE) throw new Error(game.i18n.localize("WFC.Errors.SquareGrid"));
}

function generatedDocs(collection) {
  return collection.filter(d => d.flags?.[MODULE_ID]?.generation);
}

/**
 * Default texture anchor of Tile documents. Foundry v12 and v13 anchor tiles at the top-left
 * corner (0, 0) and v14 at the center (0.5, 0.5). A tile's x and y are the position of its anchor.
 */
export function tileAnchorDefaults() {
  const read = name => {
    const field = CONFIG.Tile?.documentClass?.schema?.fields?.texture?.fields?.[name];
    const initial = typeof field?.initial === "function" ? field.initial() : field?.initial;
    return Number.isFinite(initial) ? initial : 0;
  };
  return { x: read("anchorX"), y: read("anchorY") };
}

/** Top-left corner of a tile document, accounting for its texture anchor. */
export function tileTopLeft(tile) {
  const ax = tile.texture?.anchorX ?? 0;
  const ay = tile.texture?.anchorY ?? 0;
  return { x: tile.x - ax * tile.width, y: tile.y - ay * tile.height };
}

/** Grid cell of a generated 1x1 tile document, or null when it does not sit on the grid. */
function tileCell(tile, size) {
  if (Math.abs(tile.width - size) > 1 || Math.abs(tile.height - size) > 1) return null;
  const { x, y } = tileTopLeft(tile);
  const i = Math.round(y / size);
  const j = Math.round(x / size);
  if (Math.abs(y - i * size) > 1 || Math.abs(x - j * size) > 1) return null;
  return { i, j };
}

/**
 * Side tags and door features of every generated tile on the scene, keyed by cell.
 * Tiles placed by older versions carry no tags flag; those are rebuilt from the collections.
 * @returns {Promise<Map<string, {tags: Record<string, string[]>, features: Record<string, string[]>}>>}
 */
async function existingTiles(scene, size) {
  const result = new Map();
  let lookup = null;
  for (const tile of generatedDocs(scene.tiles.contents)) {
    const cell = tileCell(tile, size);
    if (!cell) continue;
    const flags = tile.flags[MODULE_ID];
    let tags = null;
    let features = null;
    if (flags.tags) {
      tags = {};
      for (const side of SIDES) tags[side] = normalizeTags(flags.tags[side]);
      features = {};
      for (const place of [...SIDES, CENTER]) features[place] = normalizeTags(flags.features?.[place]);
    } else if (flags.tile) {
      if (!lookup) {
        lookup = new Map();
        for (const col of await loadCollections(getRegisteredDirs())) {
          for (const t of collectionTiles(col)) lookup.set(t.id, t);
        }
      }
      const base = lookup.get(flags.tile);
      if (base) {
        const rotated = rotateTile(normalizeTile(base), flags.rotation ?? tile.rotation ?? 0);
        tags = rotated.tags;
        features = tileFeatures(rotated.walls);
      }
    }
    if (tags) result.set(cellKey(cell.i, cell.j), { tags, features });
  }
  return result;
}

/**
 * Generate a dungeon inside a polygon.
 *
 * @param {object} options
 * @param {number[][]} options.polygon
 * @param {string[]} options.collectionDirs
 * @param {string} [options.seed]
 * @param {string|string[]} [options.boundaryTags]  Required on sides facing outside the outline.
 * @param {string|string[]} [options.restrictedTags]  Tags that may only appear on marked edges.
 * @param {boolean} [options.matchSurroundings]  Reuse generated tiles next to the outline as constraints.
 * @param {boolean} [options.placeOutlineWalls]
 * @param {boolean} [options.placeTileWalls]
 * @param {boolean} [options.clearExisting]
 * @param {boolean} [options.mergeWalls]
 * @returns {Promise<{ok: boolean, message: string, generationId?: string, tiles?: number, walls?: number}>}
 */
export async function generateDungeon({
  polygon,
  collectionDirs,
  seed = "",
  boundaryTags = "",
  restrictedTags = "",
  matchSurroundings = true,
  placeOutlineWalls = true,
  placeTileWalls = true,
  clearExisting = true,
  mergeWalls: mergeWallsOption = true
}) {
  assertSquareGrid();
  const scene = canvas.scene;
  const size = canvas.grid.size;
  const cells = cellsInPolygon(polygon, size);
  const cellSet = new Set(cells.map(c => cellKey(c.i, c.j)));
  const cellIndex = new Map(cells.map((c, k) => [cellKey(c.i, c.j), k]));
  log.debug("generateDungeon", { polygon, collectionDirs, seed, boundaryTags, restrictedTags, matchSurroundings, placeOutlineWalls, placeTileWalls, clearExisting, mergeWalls: mergeWallsOption, cells: cells.length, gridSize: size });
  const failWith = message => {
    ui.notifications.warn(message);
    return { ok: false, message };
  };
  if (!cells.length) return failWith(game.i18n.localize("WFC.Generate.NoCells"));

  const collections = await loadCollections(collectionDirs);
  const tiles = collections.flatMap(collectionTiles);
  if (!tiles.length) return failWith(game.i18n.localize("WFC.Generate.NoTiles"));
  const variants = expandVariants(tiles);
  const compatible = mergeCompatibility(collections.map(c => c.mapping.compatible));
  log.debug(`${tiles.length} tiles expanded to ${variants.length} variants; compatibility`, compatible);

  // Per-cell constraints: restricted tags and features first, then surrounding tiles, then markers.
  const constraints = cells.map(() => ({}));
  const ensure = (k, place) => (constraints[k][place] ??= {});
  const without = (list, remove) => (list ?? []).filter(x => !remove.includes(x));
  const restricted = normalizeTags(restrictedTags);
  if (restricted.length) {
    for (let k = 0; k < cells.length; k++) {
      for (const side of SIDES) Object.assign(ensure(k, side), { forbid: restricted, forbidFeatures: restricted });
      ensure(k, CENTER).forbidFeatures = restricted;
    }
  }
  const existing = await existingTiles(scene, size);
  let surroundingSides = 0;
  if (matchSurroundings) {
    cells.forEach((cell, k) => {
      for (const side of SIDES) {
        const [di, dj] = DELTAS[side];
        const neighborKey = cellKey(cell.i + di, cell.j + dj);
        if (cellSet.has(neighborKey)) continue;
        const neighbor = existing.get(neighborKey);
        if (!neighbor) continue;
        ensure(k, side).compatibleWith = neighbor.tags[OPPOSITE[side]];
        surroundingSides++;
      }
    });
  }
  const markers = getMarkers(scene);
  const shared = [];
  let appliedMarkers = 0;
  for (const m of markers) {
    if (m.kind === "cell") {
      const k = cellIndex.get(cellKey(m.i, m.j));
      if (k === undefined) continue;
      const c = ensure(k, CENTER);
      c.requireFeatures = m.features;
      c.forbidFeatures = without(c.forbidFeatures, m.features);
      appliedMarkers++;
      continue;
    }
    const ends = edgeCellSides(m, size).map(x => ({ ...x, k: cellIndex.get(cellKey(x.cell.i, x.cell.j)) }));
    const inside = ends.filter(x => x.k !== undefined);
    if (!inside.length) continue;
    appliedMarkers++;
    for (const x of inside) {
      const c = ensure(x.k, x.side);
      c.forbid = without(c.forbid, m.tags);
      c.forbidFeatures = without(c.forbidFeatures, m.features);
    }
    const outer = ends.find(x => x.k === undefined);
    const outerTile = outer ? existing.get(cellKey(outer.cell.i, outer.cell.j)) : null;
    // Side tags: one of the two tiles carries exactly these tags on the edge; adjacency rules
    // keep the other side compatible with them.
    if (m.tags.length) {
      if (inside.length === 2) {
        const [A, B] = inside;
        shared.push({ a: A.k, sideA: A.side, b: B.k, sideB: B.side, tags: m.tags });
      } else if (!outerTile || !tagsMatch(outerTile.tags[outer.side], m.tags)) {
        ensure(inside[0].k, inside[0].side).require = m.tags;
      }
    }
    // Features: one of the two tiles draws that kind of door on the edge.
    for (const feature of m.features) {
      if (inside.length === 2) {
        const [A, B] = inside;
        shared.push({ a: A.k, sideA: A.side, b: B.k, sideB: B.side, feature });
        continue;
      }
      if ((outerTile?.features?.[outer.side] ?? []).includes(feature)) continue;
      const c = ensure(inside[0].k, inside[0].side);
      c.requireFeatures = normalizeTags([...(c.requireFeatures ?? []), feature]);
    }
  }
  log.debug(`constraints: ${restricted.length ? `restricted [${restricted}]` : "no restricted tags"}, ${surroundingSides} sides matched to surrounding tiles, ${appliedMarkers}/${markers.length} markers inside the outline, ${shared.length} shared edge requirements`);

  const started = performance.now();
  const result = solve({ cells, variants, boundaryTags, compatible, constraints, shared, seed: String(seed) });
  log.debug(`solve finished in ${Math.round(performance.now() - started)} ms`, { success: result.success, attempts: result.attempts, failedCell: result.failedCell });
  if (!result.success) {
    const message = explainFailure(result, { cells, cellIndex, cellSet, constraints, variants, compatible, boundaryTags, shared });
    log.warn("generation failed:", message, { failure: result.failure, constraints: result.failure ? constraints[cellIndex.get(cellKey(result.failure.cell.i, result.failure.cell.j))] : null });
    ui.notifications.error(message.split("\n")[0]);
    return { ok: false, message };
  }

  // Remove what was generated here before. Wall pieces on the border of the region are kept in
  // the pool so a neighbour's door or wall on a shared edge survives the regeneration.
  let borderWalls = [];
  if (clearExisting) {
    const removed = await clearGeneratedInCells(scene, cellSet, size);
    borderWalls = removed.border;
    log.debug("cleared previous generation inside the outline", { tiles: removed.tiles, walls: removed.walls, clipped: removed.clipped, border: borderWalls.length });
  }

  const generationId = foundry.utils.randomID();
  const flags = { [MODULE_ID]: { generation: generationId } };
  const anchor = tileAnchorDefaults();
  log.debug(`tile anchor defaults for this Foundry version: (${anchor.x}, ${anchor.y})`);
  const tileDocs = result.assignments.map(({ cell, variant }) => ({
    texture: { src: variant.tile.src, anchorX: anchor.x, anchorY: anchor.y },
    x: Math.round((cell.j + anchor.x) * size),
    y: Math.round((cell.i + anchor.y) * size),
    width: size,
    height: size,
    rotation: variant.rotation,
    flags: { [MODULE_ID]: { generation: generationId, tile: variant.tile.id, rotation: variant.rotation, tags: variant.tags, features: variant.features } }
  }));

  const segments = [...borderWalls];
  if (placeTileWalls) {
    for (const { cell, variant } of result.assignments) segments.push(...tileWallsForCell(cell, size, variant.walls));
  }
  if (placeOutlineWalls) {
    // Outline walls close the region off from the outside, but not from existing generated tiles.
    for (const cell of cells) {
      for (const side of SIDES) {
        const [di, dj] = DELTAS[side];
        const neighborKey = cellKey(cell.i + di, cell.j + dj);
        if (cellSet.has(neighborKey)) continue;
        if (matchSurroundings && existing.has(neighborKey)) continue;
        segments.push({ c: cellEdgeSegment(cell, side, size), door: 0 });
      }
    }
  }
  const wallDocs = mergeWalls(segments, { merge: mergeWallsOption }).map(w => ({
    c: w.c,
    door: w.door ?? 0,
    flags
  }));

  log.debug(`creating ${tileDocs.length} tiles and ${wallDocs.length} walls (generation ${generationId})`);
  if (tileDocs.length) await scene.createEmbeddedDocuments("Tile", tileDocs);
  if (wallDocs.length) await scene.createEmbeddedDocuments("Wall", wallDocs);
  await game.settings.set(MODULE_ID, "lastGeneration", generationId);
  const message = game.i18n.format("WFC.Generate.Placed", { tiles: tileDocs.length, walls: wallDocs.length, seed });
  ui.notifications.info(message);
  return { ok: true, message, generationId, tiles: tileDocs.length, walls: wallDocs.length };
}

/** Build a readable explanation of a failed solve. */
function explainFailure(result, { cells, cellIndex, cellSet, constraints, variants, compatible, boundaryTags, shared }) {
  const f = result.failure;
  const label = cell => `(${cell.j + 1}, ${cell.i + 1})`;
  if (!f) return game.i18n.format("WFC.Generate.Failed", { attempts: result.attempts, cell: "?" });
  const k = cellIndex.get(cellKey(f.cell.i, f.cell.j));
  const outside = SIDES.filter(side => {
    const [di, dj] = DELTAS[side];
    return !cellSet.has(cellKey(f.cell.i + di, f.cell.j + dj));
  });
  const lines = describeCellConstraints(constraints[k], variants, compatible, { outside, boundaryTags });
  const sharedHere = shared.filter(r => r.a === k || r.b === k).map(r => {
    const other = cells[r.a === k ? r.b : r.a];
    const side = r.a === k ? r.sideA : r.sideB;
    const what = r.feature ? `a ${r.feature}` : (r.tags ? `tags [${r.tags}]` : `"${r.any}" (as tag or door)`);
    return `edge ${side} towards ${label(other)} needs ${what} on one of the two tiles`;
  });
  let head;
  switch (f.stage) {
    case "constraints":
      head = game.i18n.format("WFC.Generate.FailedConstraints", { cell: label(f.cell) });
      break;
    case "propagation":
    case "shared":
      head = game.i18n.format("WFC.Generate.FailedPropagation", { cell: label(f.cell), from: f.from ? label(f.from) : "?" });
      break;
    default:
      head = game.i18n.format("WFC.Generate.Failed", { attempts: result.attempts, cell: label(f.cell) });
  }
  const detail = [...lines, ...sharedHere];
  return detail.length ? `${head}\n${detail.map(l => `• ${l}`).join("\n")}` : head;
}

/**
 * Remove generated tiles inside the cell set and clip generated walls to the outside of it.
 * Walls that cross the region border are shortened rather than deleted. Pieces that ran along
 * the border are returned so the caller can re-create them.
 */
export async function clearGeneratedInCells(scene, cellSet, size) {
  const tiles = generatedDocs(scene.tiles.contents).filter(t => {
    const { x, y } = tileTopLeft(t);
    const i = Math.floor((y + t.height / 2) / size);
    const j = Math.floor((x + t.width / 2) / size);
    return cellSet.has(cellKey(i, j));
  });
  const wallIds = [];
  const replacements = [];
  const border = [];
  for (const wall of generatedDocs(scene.walls.contents)) {
    const split = splitWallByCells({ c: wall.c, door: wall.door ?? 0 }, cellSet, size);
    const unchanged = split.outside.length === 1 && !split.border.length && !split.inside.length
      && split.outside[0].c.every((v, k) => v === wall.c[k]);
    if (unchanged) continue;
    wallIds.push(wall.id);
    border.push(...split.border);
    if (split.outside.length) {
      const data = wall.toObject();
      delete data._id;
      for (const part of split.outside) replacements.push({ ...data, c: part.c });
    }
  }
  if (tiles.length) await scene.deleteEmbeddedDocuments("Tile", tiles.map(t => t.id));
  if (wallIds.length) await scene.deleteEmbeddedDocuments("Wall", wallIds);
  if (replacements.length) await scene.createEmbeddedDocuments("Wall", replacements);
  return { tiles: tiles.length, walls: wallIds.length, clipped: replacements.length, border };
}

/**
 * Remove generated content from the scene.
 * @param {"last"|"all"} mode
 */
export async function clearGenerated(mode = "last") {
  assertSquareGrid();
  const scene = canvas.scene;
  const last = game.settings.get(MODULE_ID, "lastGeneration");
  const match = d => {
    const id = d.flags?.[MODULE_ID]?.generation;
    if (!id) return false;
    return mode === "all" || id === last;
  };
  const tiles = scene.tiles.contents.filter(match);
  const walls = scene.walls.contents.filter(match);
  log.debug(`clearGenerated(${mode}): last generation ${last || "none"}, removing ${tiles.length} tiles and ${walls.length} walls`);
  if (tiles.length) await scene.deleteEmbeddedDocuments("Tile", tiles.map(t => t.id));
  if (walls.length) await scene.deleteEmbeddedDocuments("Wall", walls.map(w => w.id));
  const result = { tiles: tiles.length, walls: walls.length };
  if (result.tiles + result.walls === 0) ui.notifications.info(game.i18n.localize("WFC.Clear.Nothing"));
  else ui.notifications.info(game.i18n.format("WFC.Clear.Done", result));
  return result;
}
