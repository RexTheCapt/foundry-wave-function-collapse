import { test } from "node:test";
import assert from "node:assert/strict";
import { pointInPolygon, cellsInPolygon, outlineWalls, mergeWalls, tileWallsForCell, drawingToPolygon, pointInOrOnPolygon } from "../scripts/lib/geometry.js";

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
