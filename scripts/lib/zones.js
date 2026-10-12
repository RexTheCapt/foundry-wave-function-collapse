/**
 * Zone rules. Pure functions, no Foundry dependencies.
 *
 * A zone is { type: "empty" | "open", polygon: [[x, y], ...], tags: string[], border: string[] }.
 * - "empty": cells inside get no tile and count as outside.
 * - "open": edges between two cells of the zone must carry `tags` (e.g. floor) on both sides,
 *   edges from a zone cell to any other cell must carry `border` (e.g. wall) on the zone side.
 */

import { pointInPolygon } from "./geometry.js";
import { DELTAS } from "./wfc.js";

/** The first zone whose polygon contains the cell center, or null. */
export function zoneAtCell(zones, cell, size) {
  const x = (cell.j + 0.5) * size;
  const y = (cell.i + 0.5) * size;
  return zones.find(z => z.polygon.length >= 3 && pointInPolygon(x, y, z.polygon)) ?? null;
}

/**
 * Tag requirement an open zone imposes on one side of a cell, or null when the cell is not in an
 * open zone or the zone has no tags for that case.
 * @returns {{require: string[], reason: "inside"|"border"}|null}
 */
export function zoneSideRule(zones, cell, side, size) {
  const zone = zoneAtCell(zones, cell, size);
  if (!zone || zone.type !== "open") return null;
  const [di, dj] = DELTAS[side];
  const neighbor = { i: cell.i + di, j: cell.j + dj };
  const same = zoneAtCell(zones, neighbor, size) === zone;
  if (same) return zone.tags.length ? { require: zone.tags, reason: "inside" } : null;
  return zone.border.length ? { require: zone.border, reason: "border" } : null;
}
