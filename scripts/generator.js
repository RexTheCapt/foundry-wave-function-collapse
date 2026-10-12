/**
 * Ties the solver to the active scene: places Tile and Wall documents for a solved outline.
 */

import { MODULE_ID } from "./constants.js";
import { cellsInPolygon, outlineWalls, tileWallsForCell, mergeWalls, pointInPolygon, pointInOrOnPolygon } from "./lib/geometry.js";
import { expandVariants, solve } from "./lib/wfc.js";
import { collectionTiles, loadCollections } from "./collections.js";

export function assertSquareGrid() {
  if (!canvas.ready || !canvas.scene) throw new Error(game.i18n.localize("WFC.Errors.NoScene"));
  if (canvas.grid.type !== CONST.GRID_TYPES.SQUARE) throw new Error(game.i18n.localize("WFC.Errors.SquareGrid"));
}

function generatedDocs(collection) {
  return collection.filter(d => d.flags?.[MODULE_ID]?.generation);
}

/**
 * Generate a dungeon inside a polygon.
 *
 * @param {object} options
 * @param {number[][]} options.polygon
 * @param {string[]} options.collectionDirs
 * @param {string} [options.seed]
 * @param {string|string[]} [options.boundaryTags]
 * @param {boolean} [options.placeOutlineWalls]
 * @param {boolean} [options.placeTileWalls]
 * @param {boolean} [options.clearExisting]
 * @param {boolean} [options.mergeWalls]
 * @returns {Promise<{generationId: string, tiles: number, walls: number}|null>}
 */
export async function generateDungeon({
  polygon,
  collectionDirs,
  seed = "",
  boundaryTags = "",
  placeOutlineWalls = true,
  placeTileWalls = true,
  clearExisting = true,
  mergeWalls: mergeWallsOption = true
}) {
  assertSquareGrid();
  const scene = canvas.scene;
  const size = canvas.grid.size;
  const cells = cellsInPolygon(polygon, size);
  if (!cells.length) {
    ui.notifications.warn(game.i18n.localize("WFC.Generate.NoCells"));
    return null;
  }

  const collections = await loadCollections(collectionDirs);
  const tiles = collections.flatMap(collectionTiles);
  if (!tiles.length) {
    ui.notifications.warn(game.i18n.localize("WFC.Generate.NoTiles"));
    return null;
  }
  const variants = expandVariants(tiles);
  const result = solve({ cells, variants, boundaryTags, seed: String(seed) });
  if (!result.success) {
    const cell = result.failedCell;
    ui.notifications.error(game.i18n.format("WFC.Generate.Failed", {
      attempts: result.attempts,
      cell: cell ? `${cell.j + 1}, ${cell.i + 1}` : "?"
    }));
    return null;
  }

  const generationId = foundry.utils.randomID();
  const flags = { [MODULE_ID]: { generation: generationId } };
  const tileDocs = result.assignments.map(({ cell, variant }) => ({
    texture: { src: variant.tile.src },
    x: cell.j * size,
    y: cell.i * size,
    width: size,
    height: size,
    rotation: variant.rotation,
    flags: { [MODULE_ID]: { generation: generationId, tile: variant.tile.id, rotation: variant.rotation } }
  }));

  const segments = [];
  if (placeTileWalls) {
    for (const { cell, variant } of result.assignments) segments.push(...tileWallsForCell(cell, size, variant.walls));
  }
  if (placeOutlineWalls) segments.push(...outlineWalls(cells, size));
  const wallDocs = mergeWalls(segments, { merge: mergeWallsOption }).map(w => ({
    c: w.c,
    door: w.door ?? 0,
    flags
  }));

  if (clearExisting) await clearGeneratedInPolygon(polygon);
  if (tileDocs.length) await scene.createEmbeddedDocuments("Tile", tileDocs);
  if (wallDocs.length) await scene.createEmbeddedDocuments("Wall", wallDocs);
  await game.settings.set(MODULE_ID, "lastGeneration", generationId);
  ui.notifications.info(game.i18n.format("WFC.Generate.Done", { tiles: tileDocs.length, walls: wallDocs.length }));
  return { generationId, tiles: tileDocs.length, walls: wallDocs.length };
}

/** Remove generated tiles and walls that lie inside the polygon. */
export async function clearGeneratedInPolygon(polygon) {
  const scene = canvas.scene;
  const tiles = generatedDocs(scene.tiles.contents).filter(t => pointInPolygon(t.x + t.width / 2, t.y + t.height / 2, polygon));
  const walls = generatedDocs(scene.walls.contents).filter(w => {
    const [x1, y1, x2, y2] = w.c;
    return pointInOrOnPolygon(x1, y1, polygon, 1) && pointInOrOnPolygon(x2, y2, polygon, 1);
  });
  return deleteDocs(scene, tiles, walls);
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
  const result = await deleteDocs(scene, tiles, walls);
  if (result.tiles + result.walls === 0) ui.notifications.info(game.i18n.localize("WFC.Clear.Nothing"));
  else ui.notifications.info(game.i18n.format("WFC.Clear.Done", result));
  return result;
}

async function deleteDocs(scene, tiles, walls) {
  if (tiles.length) await scene.deleteEmbeddedDocuments("Tile", tiles.map(t => t.id));
  if (walls.length) await scene.deleteEmbeddedDocuments("Wall", walls.map(w => w.id));
  return { tiles: tiles.length, walls: walls.length };
}
