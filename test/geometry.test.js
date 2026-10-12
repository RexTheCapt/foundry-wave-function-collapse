import { test } from "node:test";
import assert from "node:assert/strict";
import { pointInPolygon, cellsInPolygon, outlineWalls, mergeWalls, tileWallsForCell, drawingToPolygon, pointInOrOnPolygon, wallPartsOutside, splitWallByCells, cellKey, cutDoorsFromWalls } from "../scripts/lib/geometry.js";
import { edgeAtPoint, edgeCellSides, cellSideEdge, edgeKey, edgeEndpoints, markerTargetAtPoint, edgesAlongLine } from "../scripts/lib/edges.js";

test("pointInPolygon", () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.ok(pointInPolygon(5, 5, square));
  assert.ok(!pointInPolygon(15, 5, square));
});

test("cellsInPolygon picks cells by center", () => {
  const cells = cellsInPolygon([[0, 0], [300, 0], [300, 200], [0, 200]], 100);
  assert.deepEqual(cells, [{ i: 0, j: 0 }, { i: 0, j: 1 }, { i: 0, j: 2 }, { i: 1, j: 0 }, { i: 1, j: 1 }, { i: 1, j: 2 }]);
  assert.deepEqual(cellsInPolygon([[0, 0], [10, 0]], 100), []);
});

test("outlineWalls surrounds a cell set", () => {
  const single = outlineWalls([{ i: 0, j: 0 }], 100);
  assert.equal(single.length, 4);
  const block = outlineWalls([{ i: 0, j: 0 }, { i: 0, j: 1 }, { i: 1, j: 0 }, { i: 1, j: 1 }], 100);
  assert.equal(block.length, 8);
  const merged = mergeWalls(block);
  assert.equal(merged.length, 4);
  const lengths = merged.map(w => Math.hypot(w.c[2] - w.c[0], w.c[3] - w.c[1]));
  assert.deepEqual(lengths, [200, 200, 200, 200]);
});

test("mergeWalls dedupes and keeps differing properties apart", () => {
  const walls = [
    { c: [0, 0, 100, 0], door: 0 },
    { c: [100, 0, 0, 0], door: 0 },
    { c: [100, 0, 150, 0], door: 1 },
    { c: [150, 0, 200, 0], door: 0 },
    { c: [0, 0, 50, 50], door: 0 },
    { c: [5, 5, 5, 5], door: 0 }
  ];
  const merged = mergeWalls(walls);
  assert.equal(merged.length, 4);
  const unmerged = mergeWalls(walls, { merge: false });
  assert.equal(unmerged.length, 4);
});

test("tileWallsForCell scales normalized walls", () => {
  const walls = tileWallsForCell({ i: 2, j: 3 }, 100, [{ c: [0, 0, 1, 0.5], door: 2 }]);
  assert.deepEqual(walls, [{ c: [300, 200, 400, 250], door: 2 }]);
});

test("drawingToPolygon handles rectangles, polygons, ellipses and rotation", () => {
  const rect = drawingToPolygon({ x: 100, y: 100, rotation: 0, shape: { type: "r", width: 200, height: 100 } });
  assert.deepEqual(rect, [[100, 100], [300, 100], [300, 200], [100, 200]]);
  const rotated = drawingToPolygon({ x: 0, y: 0, rotation: 90, shape: { type: "r", width: 200, height: 100 } });
  assert.ok(Math.abs(rotated[0][0] - 150) < 1e-9 && Math.abs(rotated[0][1] - (-50)) < 1e-9);
  const poly = drawingToPolygon({ x: 10, y: 10, shape: { type: "p", width: 50, height: 50, points: [0, 0, 50, 0, 50, 50] } });
  assert.deepEqual(poly, [[10, 10], [60, 10], [60, 60]]);
  const ellipse = drawingToPolygon({ x: 0, y: 0, shape: { type: "e", width: 100, height: 100 } });
  assert.equal(ellipse.length, 48);
  const circle = drawingToPolygon({ x: 0, y: 0, shape: { type: "c", radius: 50, width: 100, height: 100 } });
  assert.equal(circle.length, 48);
  assert.ok(Math.abs(circle[0][0] - 100) < 1e-9 && Math.abs(circle[0][1] - 50) < 1e-9);
  assert.equal(drawingToPolygon({ x: 0, y: 0, shape: { type: "t", width: 1, height: 1 } }), null);
});

test("pointInOrOnPolygon includes the boundary", () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.ok(pointInOrOnPolygon(10, 5, square));
  assert.ok(!pointInOrOnPolygon(12, 5, square));
});

test("wallPartsOutside clips walls to the cells outside a region", () => {
  const region = new Set([cellKey(0, 1), cellKey(0, 2)]); // cells in row 0, columns 1 and 2
  // Wall along the top grid line from x=0 to x=400: columns 1-2 are inside, 0 and 3 outside.
  const top = wallPartsOutside({ c: [0, 0, 400, 0], door: 0 }, region, 100);
  assert.deepEqual(top.map(w => w.c), [[0, 0, 100, 0], [300, 0, 400, 0]]);
  assert.equal(top[0].door, 0);
  // Wall on the grid line below row 0 is shared with row 1 cells, which are outside, but row 0 is inside.
  const bottom = wallPartsOutside({ c: [100, 100, 300, 100] }, region, 100);
  assert.deepEqual(bottom, []);
  // Wall inside a cell interior (not on a grid line).
  assert.deepEqual(wallPartsOutside({ c: [110, 50, 190, 50] }, region, 100), []);
  assert.deepEqual(wallPartsOutside({ c: [10, 50, 90, 50] }, region, 100).map(w => w.c), [[10, 50, 90, 50]]);
  // Vertical wall crossing rows 0..2 at x=150 (inside column 1): only row 0 is in the region.
  assert.deepEqual(wallPartsOutside({ c: [150, 0, 150, 300] }, region, 100).map(w => w.c), [[150, 100, 150, 300]]);
  // Diagonal wall uses its midpoint.
  assert.deepEqual(wallPartsOutside({ c: [100, 0, 200, 100] }, region, 100), []);
  assert.equal(wallPartsOutside({ c: [0, 100, 100, 200] }, region, 100).length, 1);
});

test("edge helpers map points, cells and sides consistently", () => {
  assert.deepEqual(edgeAtPoint(150, 5, 100), { x: 100, y: 0, dir: "h" });
  assert.deepEqual(edgeAtPoint(150, 95, 100), { x: 100, y: 100, dir: "h" });
  assert.deepEqual(edgeAtPoint(105, 50, 100), { x: 100, y: 0, dir: "v" });
  assert.deepEqual(edgeAtPoint(195, 50, 100), { x: 200, y: 0, dir: "v" });
  assert.deepEqual(edgeCellSides({ x: 100, y: 100, dir: "h" }, 100), [{ cell: { i: 0, j: 1 }, side: "s" }, { cell: { i: 1, j: 1 }, side: "n" }]);
  assert.deepEqual(edgeCellSides({ x: 100, y: 100, dir: "v" }, 100), [{ cell: { i: 1, j: 0 }, side: "e" }, { cell: { i: 1, j: 1 }, side: "w" }]);
  for (const side of ["n", "e", "s", "w"]) {
    const edge = cellSideEdge({ i: 2, j: 3 }, side, 100);
    const back = edgeCellSides(edge, 100).find(x => x.cell.i === 2 && x.cell.j === 3);
    assert.equal(back.side, side);
  }
  assert.equal(edgeKey({ x: 1, y: 2, dir: "v" }), "1,2,v");
  assert.deepEqual(edgeEndpoints({ x: 100, y: 200, dir: "v" }, 100), [100, 200, 100, 300]);
});

test("cutDoorsFromWalls removes door spans from plain walls on the same line", () => {
  const cut = cutDoorsFromWalls([
    { c: [0, 100, 100, 100], door: 0 },
    { c: [35, 100, 65, 100], door: 1 },
    { c: [0, 200, 100, 200], door: 0 },
    { c: [100, 0, 100, 100], door: 0 },
    { c: [100, 40, 100, 60], door: 2 }
  ]);
  const plain = cut.filter(w => w.door === 0).map(w => w.c);
  assert.deepEqual(plain, [[0, 100, 35, 100], [65, 100, 100, 100], [0, 200, 100, 200], [100, 0, 100, 40], [100, 60, 100, 100]]);
  assert.equal(cut.filter(w => w.door > 0).length, 2);
  // mergeWalls applies the cut after deduplication, before merging.
  const merged = mergeWalls([
    { c: [0, 100, 100, 100], door: 0 },
    { c: [100, 100, 200, 100], door: 0 },
    { c: [135, 100, 165, 100], door: 1 }
  ]);
  assert.deepEqual(merged.map(w => [w.door, ...w.c]).sort(), [[0, 0, 100, 135, 100], [0, 165, 100, 200, 100], [1, 135, 100, 165, 100]].sort());
});

test("markerTargetAtPoint picks edges near borders and cells near the center", () => {
  assert.deepEqual(markerTargetAtPoint(150, 150, 100), { kind: "cell", i: 1, j: 1 });
  assert.deepEqual(markerTargetAtPoint(150, 110, 100), { kind: "edge", x: 100, y: 100, dir: "h" });
  assert.deepEqual(markerTargetAtPoint(195, 150, 100), { kind: "edge", x: 200, y: 100, dir: "v" });
});

test("splitWallByCells separates border pieces", () => {
  const region = new Set([cellKey(0, 1), cellKey(0, 2)]);
  const split = splitWallByCells({ c: [0, 100, 400, 100], door: 1 }, region, 100);
  assert.deepEqual(split.outside.map(w => w.c), [[0, 100, 100, 100], [300, 100, 400, 100]]);
  assert.deepEqual(split.border.map(w => w.c), [[100, 100, 300, 100]]);
  assert.deepEqual(split.inside, []);
  assert.equal(split.border[0].door, 1);
  const interior = splitWallByCells({ c: [100, 100, 300, 100] }, new Set([cellKey(0, 1), cellKey(1, 1), cellKey(0, 2), cellKey(1, 2)]), 100);
  assert.deepEqual(interior.inside.map(w => w.c), [[100, 100, 300, 100]]);
});

test("edgesAlongLine enumerates edges between two edges on one grid line", () => {
  const start = { x: 100, y: 200, dir: "h" };
  assert.deepEqual(edgesAlongLine(start, { kind: "edge", x: 300, y: 200, dir: "h" }, 100).map(e => e.x), [100, 200, 300]);
  assert.deepEqual(edgesAlongLine(start, { kind: "edge", x: 0, y: 200, dir: "h" }, 100).map(e => e.x), [0, 100]);
  assert.deepEqual(edgesAlongLine(start, { kind: "edge", x: 100, y: 300, dir: "h" }, 100), []);
  assert.deepEqual(edgesAlongLine(start, { kind: "edge", x: 100, y: 200, dir: "v" }, 100), []);
  assert.deepEqual(edgesAlongLine(start, { kind: "cell", i: 1, j: 1 }, 100), []);
  assert.deepEqual(edgesAlongLine({ x: 100, y: 0, dir: "v" }, { kind: "edge", x: 100, y: 200, dir: "v" }, 100).map(e => e.y), [0, 100, 200]);
});
