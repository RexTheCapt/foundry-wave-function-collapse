import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeTags, tagsMatch, rotateTile, normalizeTile, expandVariants, solve, tileFeatures, SIDES, OPPOSITE, DELTAS } from "../scripts/lib/wfc.js";
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

test("solve honours per-side require and forbid constraints", () => {
  const cells = cellsInPolygon([[0, 0], [400, 0], [400, 100], [0, 100]], 100);
  const variants = expandVariants(sampleTiles);
  // Forbid doors everywhere except the edge between cell 1 and cell 2, where a door is required.
  const constraints = cells.map(() => ({
    n: { forbid: ["door"] }, e: { forbid: ["door"] }, s: { forbid: ["door"] }, w: { forbid: ["door"] }
  }));
  constraints[1].e = { require: ["door"] };
  constraints[2].w = { require: ["door"] };
  const result = solve({ cells, variants, constraints, boundaryTags: ["wall"], seed: "doors" });
  assert.ok(result.success);
  assertConsistent(result, cells);
  assert.deepEqual(result.assignments[1].variant.tags.e, ["door"]);
  assert.deepEqual(result.assignments[2].variant.tags.w, ["door"]);
  for (const a of result.assignments) {
    for (const side of SIDES) {
      const isTheDoor = (a.cell.j === 1 && side === "e") || (a.cell.j === 2 && side === "w");
      if (!isTheDoor) assert.ok(!a.variant.tags[side].includes("door"), `unexpected door at ${a.cell.j} ${side}`);
    }
  }
});

test("solve: a require on an outside edge overrides boundary tags", () => {
  const cells = [{ i: 0, j: 0 }];
  const variants = expandVariants(sampleTiles);
  const constraints = [{ n: { require: ["floor"] } }];
  const result = solve({ cells, variants, constraints, boundaryTags: ["wall"], seed: 1 });
  assert.ok(result.success);
  const tags = result.assignments[0].variant.tags;
  assert.deepEqual(tags.n, ["floor"]);
  assert.deepEqual(tags.e, ["wall"]);
  assert.deepEqual(tags.s, ["wall"]);
  assert.deepEqual(tags.w, ["wall"]);
});

test("tileFeatures classifies door segments by edge or center", () => {
  const f = tileFeatures([
    { c: [0.35, 0, 0.65, 0], door: 1 },
    { c: [1, 0.2, 1, 0.8], door: 2 },
    { c: [0.5, 0, 0.5, 1], door: 1 },
    { c: [0, 0, 1, 0], door: 0 }
  ]);
  assert.deepEqual(f, { n: ["door"], e: ["secret"], s: [], w: [], c: ["door"] });
  const rotated = expandVariants([normalizeTile({ tags: { n: ["a"], e: ["b"], s: ["c"], w: ["d"] }, walls: [{ c: [0.4, 0, 0.6, 0], door: 1 }], rotate: true })]);
  assert.deepEqual(rotated.map(v => Object.entries(v.features).find(([, list]) => list.length)[0]), ["n", "e", "s", "w"]);
});

const wallTile = normalizeTile({ id: "wall", tags: { n: ["wall"], e: ["wall"], s: ["wall"], w: ["wall"] }, walls: [{ c: [0, 0, 1, 0], door: 0 }], weight: 1 });
const doorWallTile = normalizeTile({ id: "doorwall", tags: { n: ["wall"], e: ["wall"], s: ["wall"], w: ["wall"] }, walls: [{ c: [0.3, 0, 0.7, 0], door: 1 }], weight: 1 });
const midDoorTile = normalizeTile({ id: "mid", tags: { n: ["wall"], e: ["wall"], s: ["wall"], w: ["wall"] }, walls: [{ c: [0.5, 0, 0.5, 1], door: 1 }], weight: 1 });

test("features: forbid and require on sides and center", () => {
  const cells = [{ i: 0, j: 0 }, { i: 0, j: 1 }, { i: 0, j: 2 }];
  const variants = expandVariants([wallTile, doorWallTile, midDoorTile]);
  const constraints = cells.map(() => ({ n: { forbidFeatures: ["door"] }, c: { forbidFeatures: ["door"] } }));
  constraints[1].c = { requireFeatures: ["door"] };
  constraints[2].n = { requireFeatures: ["door"] };
  const r = solve({ cells, variants, constraints, seed: 3 });
  assert.ok(r.success);
  assert.equal(r.assignments[0].variant.tile.id, "wall");
  assert.equal(r.assignments[1].variant.tile.id, "mid");
  assert.equal(r.assignments[2].variant.tile.id, "doorwall");
});

test("features: shared requirement is satisfied by either neighbour", () => {
  const cells = [{ i: 0, j: 0 }, { i: 1, j: 0 }];
  // Tile A can only offer a door on its south side, tile B never offers doors.
  const southDoor = normalizeTile({ id: "south", tags: { n: ["x"], e: ["x"], s: ["x"], w: ["x"] }, walls: [{ c: [0.3, 1, 0.7, 1], door: 1 }] });
  const plain = normalizeTile({ id: "plain", tags: { n: ["x"], e: ["x"], s: ["x"], w: ["x"] }, weight: 50 });
  const variants = expandVariants([southDoor, plain]);
  const shared = [{ a: 0, sideA: "s", b: 1, sideB: "n", feature: "door" }];
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = solve({ cells, variants, sharedFeatures: shared, seed });
    assert.ok(r.success);
    const [top, bottom] = r.assignments.map(x => x.variant);
    assert.ok(top.features.s.includes("door") || bottom.features.n.includes("door"), `seed ${seed}`);
  }
  const impossible = solve({ cells, variants: expandVariants([plain]), sharedFeatures: shared, seed: 1, maxAttempts: 2 });
  assert.equal(impossible.success, false);
});
