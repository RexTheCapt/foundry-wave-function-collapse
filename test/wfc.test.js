import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeTags, tagsMatch, rotateTile, normalizeTile, expandVariants, solve, SIDES, OPPOSITE, DELTAS } from "../scripts/lib/wfc.js";
import { normalizeMapping } from "../scripts/lib/mapping.js";
import { cellsInPolygon } from "../scripts/lib/geometry.js";

const sampleMapping = normalizeMapping(JSON.parse(fs.readFileSync(new URL("../collections/sample-dungeon/mapping.json", import.meta.url), "utf8")));
const sampleTiles = Object.entries(sampleMapping.tiles).map(([file, entry]) => normalizeTile({ id: file, src: file, ...entry }));

test("normalizeTags trims, dedupes and sorts", () => {
  assert.deepEqual(normalizeTags(" b, a ,a,, "), ["a", "b"]);
  assert.deepEqual(normalizeTags(["x", " x", "y"]), ["x", "y"]);
  assert.deepEqual(normalizeTags(null), []);
});

test("tagsMatch requires identical sets unless wildcard", () => {
  assert.ok(tagsMatch(["a", "b"], ["a", "b"]));
  assert.ok(!tagsMatch(["a"], ["a", "b"]));
  assert.ok(!tagsMatch([], ["a"]));
  assert.ok(tagsMatch([], []));
  assert.ok(tagsMatch(["*"], ["anything"]));
});

test("rotateTile cycles sides clockwise and rotates walls", () => {
  const tile = normalizeTile({ tags: { n: ["n"], e: ["e"], s: ["s"], w: ["w"] }, walls: [{ c: [0, 0, 1, 0], door: 1 }] });
  const r = rotateTile(tile, 90);
  assert.deepEqual(r.tags, { n: ["w"], e: ["n"], s: ["e"], w: ["s"] });
  assert.deepEqual(r.walls[0].c, [1, 0, 1, 1]);
  assert.equal(r.walls[0].door, 1);
  const full = rotateTile(tile, 360);
  assert.deepEqual(full.tags, tile.tags);
});

test("expandVariants dedupes symmetric rotations", () => {
  const symmetric = normalizeTile({ tags: { n: ["a"], e: ["a"], s: ["a"], w: ["a"] }, rotate: true });
  const asymmetric = normalizeTile({ tags: { n: ["a"], e: ["b"], s: ["a"], w: ["b"] }, rotate: true });
  assert.equal(expandVariants([symmetric]).length, 1);
  assert.equal(expandVariants([asymmetric]).length, 2);
});

function assertConsistent(result, cells) {
  const byKey = new Map(result.assignments.map(a => [`${a.cell.i},${a.cell.j}`, a.variant]));
  for (const a of result.assignments) {
    for (const side of SIDES) {
      const [di, dj] = DELTAS[side];
      const other = byKey.get(`${a.cell.i + di},${a.cell.j + dj}`);
      if (!other) continue;
      assert.ok(tagsMatch(a.variant.tags[side], other.tags[OPPOSITE[side]]), `mismatch at ${a.cell.i},${a.cell.j} side ${side}`);
    }
  }
  assert.equal(result.assignments.length, cells.length);
}

test("solve fills a rectangle with the sample collection and respects the boundary", () => {
  const polygon = [[0, 0], [1200, 0], [1200, 800], [0, 800]];
  const cells = cellsInPolygon(polygon, 100);
  assert.equal(cells.length, 96);
  const variants = expandVariants(sampleTiles);
  const result = solve({ cells, variants, boundaryTags: ["wall"], seed: "test" });
  assert.ok(result.success, "expected a solution");
  assertConsistent(result, cells);
  for (const a of result.assignments) {
    if (a.cell.i === 0) assert.deepEqual(a.variant.tags.n, ["wall"]);
    if (a.cell.j === 11) assert.deepEqual(a.variant.tags.e, ["wall"]);
  }
});

test("solve is deterministic for a seed", () => {
  const cells = cellsInPolygon([[0, 0], [600, 0], [600, 600], [0, 600]], 100);
  const variants = expandVariants(sampleTiles);
  const a = solve({ cells, variants, seed: "abc" });
  const b = solve({ cells, variants, seed: "abc" });
  assert.deepEqual(a.assignments.map(x => x.variantIndex), b.assignments.map(x => x.variantIndex));
});

test("solve handles an irregular polygon", () => {
  const polygon = [[0, 0], [700, 0], [700, 300], [400, 300], [400, 600], [0, 600]];
  const cells = cellsInPolygon(polygon, 100);
  assert.equal(cells.length, 7 * 3 + 4 * 3);
  const result = solve({ cells, variants: expandVariants(sampleTiles), boundaryTags: "wall", seed: 7 });
  assert.ok(result.success);
  assertConsistent(result, cells);
});

test("solve reports failure when no tile fits", () => {
  const a = normalizeTile({ id: "a", tags: { n: ["x"], e: ["x"], s: ["x"], w: ["x"] } });
  const cells = [{ i: 0, j: 0 }];
  const result = solve({ cells, variants: expandVariants([a]), boundaryTags: ["y"], seed: 1, maxAttempts: 3 });
  assert.equal(result.success, false);
  assert.deepEqual(result.failedCell, cells[0]);
  assert.equal(result.attempts, 3);
});

test("solve with no cells succeeds trivially", () => {
  const result = solve({ cells: [], variants: expandVariants(sampleTiles) });
  assert.ok(result.success);
  assert.equal(result.assignments.length, 0);
});
