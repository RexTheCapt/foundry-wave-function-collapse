/**
 * Grid and polygon helpers. Pure functions, no Foundry dependencies.
 *
 * Polygons are arrays of [x, y] points in canvas pixels.
 * Cells are { i: row, j: column } on a square grid of `size` pixels.
 */

import { SIDES, DELTAS } from "./wfc.js";

/** Ray-casting point in polygon test. */
export function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const crosses = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Shoelace area, absolute value. */
export function polygonArea(polygon) {
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    area += polygon[j][0] * polygon[i][1] - polygon[i][0] * polygon[j][1];
  }
  return Math.abs(area) / 2;
}

export function polygonBounds(polygon) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * All grid cells whose center lies inside the polygon.
 * @param {number[][]} polygon
 * @param {number} size  Grid size in pixels.
 * @returns {{i: number, j: number}[]}
 */
export function cellsInPolygon(polygon, size) {
  if (polygon.length < 3 || polygonArea(polygon) === 0) return [];
  const { minX, minY, maxX, maxY } = polygonBounds(polygon);
  const cells = [];
  const i0 = Math.floor(minY / size);
  const i1 = Math.ceil(maxY / size);
  const j0 = Math.floor(minX / size);
  const j1 = Math.ceil(maxX / size);
  for (let i = i0; i < i1; i++) {
    for (let j = j0; j < j1; j++) {
      if (pointInPolygon((j + 0.5) * size, (i + 0.5) * size, polygon)) cells.push({ i, j });
    }
  }
  return cells;
}

/** Pixel segment of one side of a cell. */
export function cellEdgeSegment(cell, side, size) {
  const x = cell.j * size;
  const y = cell.i * size;
  switch (side) {
    case "n": return [x, y, x + size, y];
    case "e": return [x + size, y, x + size, y + size];
    case "s": return [x, y + size, x + size, y + size];
    case "w": return [x, y, x, y + size];
    default: throw new Error(`Unknown side ${side}`);
  }
}

/**
 * Wall segments along every cell edge whose neighbor is not part of the cell set.
 * @param {{i: number, j: number}[]} cells
 * @param {number} size
 * @returns {{c: number[], door: number}[]}
 */
export function outlineWalls(cells, size) {
  const set = new Set(cells.map(c => `${c.i},${c.j}`));
  const walls = [];
  for (const cell of cells) {
    for (const side of SIDES) {
      const [di, dj] = DELTAS[side];
      if (set.has(`${cell.i + di},${cell.j + dj}`)) continue;
      walls.push({ c: cellEdgeSegment(cell, side, size), door: 0 });
    }
  }
  return walls;
}

/**
 * Convert a tile's normalized walls (0..1 tile space) into absolute pixel segments for a cell.
 */
export function tileWallsForCell(cell, size, walls) {
  const x = cell.j * size;
  const y = cell.i * size;
  return walls.map(w => ({
    ...w,
    c: [x + w.c[0] * size, y + w.c[1] * size, x + w.c[2] * size, y + w.c[3] * size]
  }));
}

function propsKey(segment) {
  const entries = Object.entries(segment).filter(([k]) => k !== "c").sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify(entries);
}

function normalizeSegment(segment) {
  let [x1, y1, x2, y2] = segment.c.map(v => Math.round(v));
  if (x1 > x2 || (x1 === x2 && y1 > y2)) [x1, y1, x2, y2] = [x2, y2, x1, y1];
  return { ...segment, c: [x1, y1, x2, y2] };
}

function mergeAxis(segments, fixed, start, end) {
  const groups = new Map();
  for (const s of segments) {
    const key = `${s.c[fixed]}|${propsKey(s)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const out = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.c[start] - b.c[start]);
    let current = group[0];
    for (let k = 1; k < group.length; k++) {
      const next = group[k];
      if (next.c[start] <= current.c[end]) {
        if (next.c[end] > current.c[end]) {
          const c = [...current.c];
          c[end] = next.c[end];
          current = { ...current, c };
        }
      } else {
        out.push(current);
        current = next;
      }
    }
    out.push(current);
  }
  return out;
}

/**
 * Remove the spans covered by door segments from collinear plain wall segments, so that a door
 * drawn by one tile is not blocked by the full wall its neighbour draws on the shared edge.
 * Only axis-aligned segments are considered.
 */
export function cutDoorsFromWalls(segments) {
  const isDoor = s => (s.door ?? 0) > 0;
  const doors = segments.filter(isDoor);
  if (!doors.length) return segments;
  const out = [];
  for (const s of segments) {
    if (isDoor(s)) { out.push(s); continue; }
    const horizontal = s.c[1] === s.c[3];
    const vertical = s.c[0] === s.c[2];
    if (!horizontal && !vertical) { out.push(s); continue; }
    const fixedIdx = horizontal ? 1 : 0;
    const a = horizontal ? 0 : 1;
    const b = horizontal ? 2 : 3;
    let intervals = [[Math.min(s.c[a], s.c[b]), Math.max(s.c[a], s.c[b])]];
    for (const d of doors) {
      const sameLine = horizontal ? (d.c[1] === d.c[3] && d.c[1] === s.c[fixedIdx]) : (d.c[0] === d.c[2] && d.c[0] === s.c[fixedIdx]);
      if (!sameLine) continue;
      const d0 = Math.min(d.c[a], d.c[b]);
      const d1 = Math.max(d.c[a], d.c[b]);
      const next = [];
      for (const [i0, i1] of intervals) {
        if (d1 <= i0 || d0 >= i1) { next.push([i0, i1]); continue; }
        if (i0 < d0) next.push([i0, d0]);
        if (d1 < i1) next.push([d1, i1]);
      }
      intervals = next;
    }
    for (const [i0, i1] of intervals) {
      const c = horizontal ? [i0, s.c[1], i1, s.c[1]] : [s.c[0], i0, s.c[0], i1];
      out.push({ ...s, c });
    }
  }
  return out;
}

/**
 * Round, drop zero-length and duplicate segments, cut door spans out of plain walls, and
 * optionally merge touching collinear axis-aligned segments that share the same properties.
 * @param {{c: number[]}[]} segments
 * @param {{merge?: boolean}} [options]
 */
export function mergeWalls(segments, { merge = true } = {}) {
  const unique = new Map();
  for (const raw of segments) {
    const s = normalizeSegment(raw);
    if (s.c[0] === s.c[2] && s.c[1] === s.c[3]) continue;
    const key = `${s.c.join(",")}|${propsKey(s)}`;
    if (!unique.has(key)) unique.set(key, s);
  }
  const list = cutDoorsFromWalls([...unique.values()]);
  if (!merge) return list;
  const horizontal = list.filter(s => s.c[1] === s.c[3]);
  const vertical = list.filter(s => s.c[0] === s.c[2] && s.c[1] !== s.c[3]);
  const other = list.filter(s => s.c[1] !== s.c[3] && s.c[0] !== s.c[2]);
  return [...mergeAxis(horizontal, 1, 0, 2), ...mergeAxis(vertical, 0, 1, 3), ...other];
}

/** Key used for cell sets. */
export const cellKey = (i, j) => `${i},${j}`;

/** Cell containing a point. */
export function cellAt(x, y, size) {
  return { i: Math.floor(y / size), j: Math.floor(x / size) };
}

/**
 * Split a wall segment by a set of cells.
 *
 * Axis-aligned walls are cut at grid lines. A piece running along a grid line is "border" when
 * exactly one of the two cells it separates is in the set, "inside" when both are, otherwise
 * "outside". A piece inside a cell is "inside" when that cell is in the set. Walls that are not
 * axis-aligned are classified whole by their midpoint.
 *
 * @param {{c: number[]}} segment
 * @param {Set<string>} cellSet  Keys produced by `cellKey`.
 * @param {number} size
 * @returns {{outside: {c: number[]}[], border: {c: number[]}[], inside: {c: number[]}[]}}
 */
export function splitWallByCells(segment, cellSet, size) {
  const result = { outside: [], border: [], inside: [] };
  const [x1, y1, x2, y2] = segment.c;
  const horizontal = y1 === y2;
  const vertical = x1 === x2;
  if (!horizontal && !vertical) {
    const { i, j } = cellAt((x1 + x2) / 2, (y1 + y2) / 2, size);
    (cellSet.has(cellKey(i, j)) ? result.inside : result.outside).push(segment);
    return result;
  }
  const fixed = horizontal ? y1 : x1;
  const a0 = Math.min(horizontal ? x1 : y1, horizontal ? x2 : y2);
  const a1 = Math.max(horizontal ? x1 : y1, horizontal ? x2 : y2);
  if (a0 === a1) return result;
  const line = Math.round(fixed / size);
  const onGridLine = Math.abs(fixed - line * size) < 1e-6;
  const cuts = [a0];
  for (let g = (Math.floor(a0 / size) + 1) * size; g < a1; g += size) cuts.push(g);
  cuts.push(a1);
  const pieces = { outside: [], border: [], inside: [] };
  for (let k = 0; k + 1 < cuts.length; k++) {
    const p0 = cuts[k];
    const p1 = cuts[k + 1];
    const along = Math.floor(((p0 + p1) / 2) / size);
    let touched;
    if (horizontal) touched = onGridLine ? [[line - 1, along], [line, along]] : [[Math.floor(fixed / size), along]];
    else touched = onGridLine ? [[along, line - 1], [along, line]] : [[along, Math.floor(fixed / size)]];
    const hits = touched.filter(([i, j]) => cellSet.has(cellKey(i, j))).length;
    const bucket = hits === 0 ? "outside" : (hits === touched.length ? "inside" : "border");
    const c = horizontal ? [p0, fixed, p1, fixed] : [fixed, p0, fixed, p1];
    const list = pieces[bucket];
    const last = list[list.length - 1];
    if (last && (horizontal ? last[2] === c[0] : last[3] === c[1])) {
      if (horizontal) last[2] = c[2]; else last[3] = c[3];
    } else list.push(c);
  }
  for (const bucket of ["outside", "border", "inside"]) result[bucket] = pieces[bucket].map(c => ({ ...segment, c }));
  return result;
}

/** Parts of a wall segment that lie outside a set of cells (border pieces count as inside). */
export function wallPartsOutside(segment, cellSet, size) {
  return splitWallByCells(segment, cellSet, size).outside;
}

/** Distance from a point to a segment. */
export function distanceToSegment(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Whether a point is inside the polygon or within `tolerance` pixels of its boundary. */
export function pointInOrOnPolygon(x, y, polygon, tolerance = 1) {
  if (pointInPolygon(x, y, polygon)) return true;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (distanceToSegment(x, y, [...polygon[j], ...polygon[i]]) <= tolerance) return true;
  }
  return false;
}

/**
 * Convert Foundry drawing document data into an absolute polygon.
 * Supports rectangles, polygons, ellipses and circles (approximated). Rotation is applied around the center.
 * @param {{x: number, y: number, rotation?: number, shape: {type: string, width: number, height: number, points?: number[]}}} doc
 * @returns {number[][]|null}
 */
export function drawingToPolygon(doc) {
  const { x, y, shape } = doc;
  const w = shape.type === "c" ? (shape.radius ?? shape.width / 2) * 2 : shape.width;
  const h = shape.type === "c" ? w : shape.height;
  let points;
  switch (shape.type) {
    case "r":
      points = [[0, 0], [w, 0], [w, h], [0, h]];
      break;
    case "p": {
      const flat = shape.points ?? [];
      points = [];
      for (let k = 0; k + 1 < flat.length; k += 2) points.push([flat[k], flat[k + 1]]);
      break;
    }
    case "e":
    case "c": {
      const n = 48;
      points = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        points.push([w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a)]);
      }
      break;
    }
    default:
      return null;
  }
  if (points.length < 3) return null;
  const rotation = ((doc.rotation ?? 0) * Math.PI) / 180;
  const cx = w / 2;
  const cy = h / 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return points.map(([px, py]) => {
    const dx = px - cx;
    const dy = py - cy;
    return [x + cx + dx * cos - dy * sin, y + cy + dx * sin + dy * cos];
  });
}
