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

/** Pixel coordinates of a cell's four corners' edges, keyed by side. */
function cellEdge(cell, side, size) {
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
      walls.push({ c: cellEdge(cell, side, size), door: 0 });
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
 * Round, drop zero-length and duplicate segments, and optionally merge touching
 * collinear axis-aligned segments that share the same properties.
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
  const list = [...unique.values()];
  if (!merge) return list;
  const horizontal = list.filter(s => s.c[1] === s.c[3]);
  const vertical = list.filter(s => s.c[0] === s.c[2] && s.c[1] !== s.c[3]);
  const other = list.filter(s => s.c[1] !== s.c[3] && s.c[0] !== s.c[2]);
  return [...mergeAxis(horizontal, 1, 0, 2), ...mergeAxis(vertical, 0, 1, 3), ...other];
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
