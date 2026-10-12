/**
 * Cell-edge helpers for edge markers. Pure functions, no Foundry dependencies.
 *
 * An edge is identified by the pixel position of its start and its direction:
 * { x, y, dir: "h" } runs from (x, y) to (x + size, y); { x, y, dir: "v" } runs to (x, y + size).
 */

/** Unique key for an edge. */
export function edgeKey({ x, y, dir }) {
  return `${x},${y},${dir}`;
}

/** The cell edge nearest to a canvas point. */
export function edgeAtPoint(x, y, size) {
  const j = Math.floor(x / size);
  const i = Math.floor(y / size);
  const u = x / size - j;
  const v = y / size - i;
  const candidates = [
    { d: v, edge: { x: j * size, y: i * size, dir: "h" } },
    { d: 1 - v, edge: { x: j * size, y: (i + 1) * size, dir: "h" } },
    { d: u, edge: { x: j * size, y: i * size, dir: "v" } },
    { d: 1 - u, edge: { x: (j + 1) * size, y: i * size, dir: "v" } }
  ];
  candidates.sort((a, b) => a.d - b.d);
  return candidates[0].edge;
}

/** The two cells touching an edge, with the side of each cell that the edge is on. */
export function edgeCellSides({ x, y, dir }, size) {
  const j = Math.round(x / size);
  const i = Math.round(y / size);
  if (dir === "h") return [{ cell: { i: i - 1, j }, side: "s" }, { cell: { i, j }, side: "n" }];
  return [{ cell: { i, j: j - 1 }, side: "e" }, { cell: { i, j }, side: "w" }];
}

/** The edge on a given side of a cell. */
export function cellSideEdge({ i, j }, side, size) {
  switch (side) {
    case "n": return { x: j * size, y: i * size, dir: "h" };
    case "s": return { x: j * size, y: (i + 1) * size, dir: "h" };
    case "w": return { x: j * size, y: i * size, dir: "v" };
    case "e": return { x: (j + 1) * size, y: i * size, dir: "v" };
    default: throw new Error(`Unknown side ${side}`);
  }
}

/** Pixel endpoints of an edge. */
export function edgeEndpoints({ x, y, dir }, size) {
  return dir === "h" ? [x, y, x + size, y] : [x, y, x, y + size];
}

/** Key for a cell marker. */
export function cellMarkerKey({ i, j }) {
  return `c:${i},${j}`;
}

/**
 * Decide what a click at a canvas point targets: the nearest edge when the point is close to
 * it, otherwise the cell itself.
 * @returns {{kind: "edge", x: number, y: number, dir: string}|{kind: "cell", i: number, j: number}}
 */
export function markerTargetAtPoint(x, y, size, edgeZone = 0.3) {
  const j = Math.floor(x / size);
  const i = Math.floor(y / size);
  const u = x / size - j;
  const v = y / size - i;
  const nearest = Math.min(u, 1 - u, v, 1 - v);
  if (nearest <= edgeZone) return { kind: "edge", ...edgeAtPoint(x, y, size) };
  return { kind: "cell", i, j };
}

/**
 * All edges on the same grid line between two edges (inclusive). Returns an empty list when the
 * end is not an edge on the same line as the start.
 * @param {{x: number, y: number, dir: string}} start
 * @param {{kind?: string, x?: number, y?: number, dir?: string}} end
 * @param {number} size
 */
export function edgesAlongLine(start, end, size) {
  if (!end || (end.kind && end.kind !== "edge") || end.dir !== start.dir) return [];
  if (start.dir === "h") {
    if (end.y !== start.y) return [];
    const [a, b] = [Math.min(start.x, end.x), Math.max(start.x, end.x)];
    const out = [];
    for (let x = a; x <= b; x += size) out.push({ x, y: start.y, dir: "h" });
    return out;
  }
  if (end.x !== start.x) return [];
  const [a, b] = [Math.min(start.y, end.y), Math.max(start.y, end.y)];
  const out = [];
  for (let y = a; y <= b; y += size) out.push({ x: start.x, y, dir: "v" });
  return out;
}
