import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeTags, tagsMatch, rotateTile, normalizeTile, expandVariants, solve, tileFeatures, buildCompatibility, mergeCompatibility, describeCellConstraints, allowedVariants, SIDES, OPPOSITE, DELTAS } from "../scripts/lib/wfc.js";
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

const sampleCompat = buildCompatibility(sampleMapping.compatible);

function assertConsistent(result, cells, compat = sampleCompat) {
  const byKey = new Map(result.assignments.map(a => [`${a.cell.i},${a.cell.j}`, a.variant]));
  for (const a of result.assignments) {
    for (const side of SIDES) {
      const [di, dj] = DELTAS[side];
      const other = byKey.get(`${a.cell.i + di},${a.cell.j + dj}`);
      if (!other) continue;
      assert.ok(tagsMatch(a.variant.tags[side], other.tags[OPPOSITE[side]], compat), `mismatch at ${a.cell.i},${a.cell.j} side ${side}`);
    }
  }
  assert.equal(result.assignments.length, cells.length);
}
const sampleSolve = opts => solve({ compatible: sampleMapping.compatible, ...opts });
// One-sided wall convention used by some tests: a wall or door side may only face a floor side.
const ONE_SIDED = { wall: ["floor"], door: ["floor"] };
const oneSidedCompat = buildCompatibility(ONE_SIDED);
const oneSidedSolve = opts => solve({ compatible: ONE_SIDED, ...opts });

test("solve fills a rectangle with the sample collection and respects the boundary", () => {
  const polygon = [[0, 0], [1200, 0], [1200, 800], [0, 800]];
  const cells = cellsInPolygon(polygon, 100);
  assert.equal(cells.length, 96);
  const variants = expandVariants(sampleTiles);
  const result = sampleSolve({ cells, variants, boundaryTags: ["wall"], seed: "test" });
  assert.ok(result.success, "expected a solution");
  assertConsistent(result, cells);
  for (const a of result.assignments) {
    if (a.cell.i === 0) assert.deepEqual(a.variant.tags.n, ["wall"]);
    if (a.cell.j === 11) assert.deepEqual(a.variant.tags.e, ["wall"]);
  }
});

test("solve with a one-sided compatibility table never puts two wall sides together", () => {
  const cells = cellsInPolygon([[0, 0], [800, 0], [800, 500], [0, 500]], 100);
  const variants = expandVariants(sampleTiles);
  const result = oneSidedSolve({ cells, variants, boundaryTags: ["wall"], seed: "one-sided" });
  assert.ok(result.success);
  assertConsistent(result, cells, oneSidedCompat);
  const byKey = new Map(result.assignments.map(a => [`${a.cell.i},${a.cell.j}`, a.variant]));
  for (const a of result.assignments) {
    for (const side of SIDES) {
      const [di, dj] = DELTAS[side];
      const other = byKey.get(`${a.cell.i + di},${a.cell.j + dj}`);
      if (!other) continue;
      if (a.variant.tags[side][0] !== "floor") assert.deepEqual(other.tags[OPPOSITE[side]], ["floor"]);
    }
  }
});

test("solve is deterministic for a seed", () => {
  const cells = cellsInPolygon([[0, 0], [600, 0], [600, 600], [0, 600]], 100);
  const variants = expandVariants(sampleTiles);
  const a = sampleSolve({ cells, variants, seed: "abc" });
  const b = sampleSolve({ cells, variants, seed: "abc" });
  assert.deepEqual(a.assignments.map(x => x.variantIndex), b.assignments.map(x => x.variantIndex));
});

test("solve handles an irregular polygon", () => {
  const polygon = [[0, 0], [700, 0], [700, 300], [400, 300], [400, 600], [0, 600]];
  const cells = cellsInPolygon(polygon, 100);
  assert.equal(cells.length, 7 * 3 + 4 * 3);
  const result = sampleSolve({ cells, variants: expandVariants(sampleTiles), boundaryTags: "wall", seed: 7 });
  assert.ok(result.success);
  assertConsistent(result, cells);
});

test("solve reports failure when no tile fits", () => {
  const a = normalizeTile({ id: "a", tags: { n: ["x"], e: ["x"], s: ["x"], w: ["x"] } });
  const cells = [{ i: 0, j: 0 }];
  const result = solve({ cells, variants: expandVariants([a]), boundaryTags: ["y"], seed: 1, maxAttempts: 3 });
  assert.equal(result.success, false);
  assert.deepEqual(result.failedCell, cells[0]);
  assert.equal(result.failure.stage, "constraints");
  assert.equal(result.attempts, 1, "deterministic failures do not retry");
});

test("failure diagnostics name the stage and the neighbour", () => {
  const variants = expandVariants(sampleTiles);
  // Contradictory unary constraints: must be exactly wall and compatible with wall (i.e. floor).
  const unary = oneSidedSolve({ cells: [{ i: 0, j: 0 }], variants, constraints: [{ n: { require: ["wall"], compatibleWith: ["wall"] } }], seed: 1 });
  assert.equal(unary.success, false);
  assert.equal(unary.failure.stage, "constraints");
  const lines = describeCellConstraints({ n: { require: ["wall"], compatibleWith: ["wall"] } }, variants, ONE_SIDED);
  assert.ok(lines.some(l => l.startsWith("north must be exactly [wall]")));
  assert.ok(lines.some(l => l.startsWith("north must be compatible with [wall]")));
  // Propagation: cell 0 must draw a wall on its east, cell 1 must draw a wall on its west; one-sided walls forbid that.
  const prop = oneSidedSolve({ cells: [{ i: 0, j: 0 }, { i: 0, j: 1 }], variants, constraints: [{ e: { require: ["wall"] } }, { w: { require: ["wall"] } }], seed: 1 });
  assert.equal(prop.success, false);
  assert.equal(prop.failure.stage, "propagation");
  assert.ok(prop.failure.from);
  // Boundary description for outside sides.
  const b = describeCellConstraints(undefined, variants, null, { outside: ["n"], boundaryTags: ["wall"] });
  assert.equal(b.length, 1);
});


test("solve with no cells succeeds trivially", () => {
  const result = sampleSolve({ cells: [], variants: expandVariants(sampleTiles) });
  assert.ok(result.success);
  assert.equal(result.assignments.length, 0);
});

test("solve honours per-side require, compatibleWith and forbid constraints", () => {
  const cells = cellsInPolygon([[0, 0], [400, 0], [400, 100], [0, 100]], 100);
  const variants = expandVariants(sampleTiles);
  // Forbid doors everywhere except the edge between cell 1 and cell 2, where cell 1 draws a door
  // and cell 2 must show floor (the sample's doors are one-sided).
  const constraints = cells.map(() => ({
    n: { forbid: ["door"] }, e: { forbid: ["door"] }, s: { forbid: ["door"] }, w: { forbid: ["door"] }
  }));
  constraints[1].e = { require: ["door"] };
  constraints[2].w = { compatibleWith: ["door"] };
  const result = oneSidedSolve({ cells, variants, constraints, boundaryTags: ["wall"], seed: "doors" });
  assert.ok(result.success);
  assertConsistent(result, cells, oneSidedCompat);
  assert.deepEqual(result.assignments[1].variant.tags.e, ["door"]);
  assert.deepEqual(result.assignments[2].variant.tags.w, ["floor"]);
  for (const a of result.assignments) {
    for (const side of SIDES) {
      const isTheDoor = a.cell.j === 1 && side === "e";
      if (!isTheDoor) assert.ok(!a.variant.tags[side].includes("door"), `unexpected door at ${a.cell.j} ${side}`);
    }
  }
});

test("solve: a require on an outside edge overrides boundary tags", () => {
  const cells = [{ i: 0, j: 0 }];
  const variants = expandVariants(sampleTiles);
  const constraints = [{ n: { require: ["floor"] } }];
  const result = sampleSolve({ cells, variants, constraints, boundaryTags: ["wall"], seed: 1 });
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
    const r = solve({ cells, variants, shared, seed });
    assert.ok(r.success);
    const [top, bottom] = r.assignments.map(x => x.variant);
    assert.ok(top.features.s.includes("door") || bottom.features.n.includes("door"), `seed ${seed}`);
  }
  const impossible = solve({ cells, variants: expandVariants([plain]), shared, seed: 1, maxAttempts: 2 });
  assert.equal(impossible.success, false);
});

test("compatibility tables allow asymmetric pairs and drop self-matching for listed tags", () => {
  const compat = buildCompatibility({ wall: ["floor"] });
  assert.ok(tagsMatch(["wall"], ["floor"], compat));
  assert.ok(tagsMatch(["floor"], ["wall"], compat));
  assert.ok(tagsMatch(["floor"], ["floor"], compat));
  assert.ok(!tagsMatch(["wall"], ["wall"], compat));
  assert.ok(tagsMatch(["wall"], ["wall"], buildCompatibility({ wall: ["floor", "wall"] })));
  assert.ok(tagsMatch(["x"], ["x"], compat));
  assert.ok(!tagsMatch(["x"], ["y"], compat));
  assert.ok(tagsMatch(["*"], ["wall"], compat));
  assert.deepEqual(mergeCompatibility([{ wall: ["floor"] }, { wall: ["rubble"], door: "floor" }]), { wall: ["floor", "rubble"], door: ["floor"] });
});

test("compatibleWith constraint and shared tag requirement", () => {
  const cells = [{ i: 0, j: 0 }, { i: 0, j: 1 }];
  const variants = expandVariants(sampleTiles);
  // A wall tile sits north of cell 0: the new tile's north side must be compatible with "wall", i.e. floor.
  const r = oneSidedSolve({ cells, variants, constraints: [{ n: { compatibleWith: ["wall"] } }, {}], seed: 2 });
  assert.ok(r.success);
  assert.deepEqual(r.assignments[0].variant.tags.n, ["floor"]);
  // Shared tags: one of the two sides of the shared edge must be exactly "door".
  for (const seed of [1, 2, 3]) {
    const d = oneSidedSolve({ cells, variants, shared: [{ a: 0, sideA: "e", b: 1, sideB: "w", tags: ["door"] }], seed });
    assert.ok(d.success);
    const [A, B] = d.assignments.map(x => x.variant);
    assert.ok(A.tags.e[0] === "door" || B.tags.w[0] === "door");
    assert.ok(A.tags.e[0] === "floor" || B.tags.w[0] === "floor");
  }
});

test("requireAny and shared any accept a tag or a door feature", () => {
  const variants = expandVariants(sampleTiles);
  // "wall" is a tag: one of the two tiles must be tagged wall on the shared edge.
  for (const seed of [1, 2, 3]) {
    const r = sampleSolve({ cells: [{ i: 0, j: 0 }, { i: 0, j: 1 }], variants, shared: [{ a: 0, sideA: "e", b: 1, sideB: "w", any: "wall" }], seed });
    assert.ok(r.success, `seed ${seed}`);
    const [A, B] = r.assignments.map(x => x.variant);
    assert.ok(A.tags.e[0] === "wall" || B.tags.w[0] === "wall");
  }
  // "door" works through the tag or the feature; the sample has both.
  const d = sampleSolve({ cells: [{ i: 0, j: 0 }], variants, constraints: [{ n: { requireAny: ["door"] } }], seed: 1 });
  assert.ok(d.success);
  assert.ok(d.assignments[0].variant.features.n.includes("door"));
  // A tile tagged wall that draws a door counts for "door" too.
  const doorWall = normalizeTile({ id: "dw", tags: { n: ["wall"], e: ["x"], s: ["x"], w: ["x"] }, walls: [{ c: [0.3, 0, 0.7, 0], door: 1 }] });
  const dw = solve({ cells: [{ i: 0, j: 0 }], variants: expandVariants([doorWall]), constraints: [{ n: { requireAny: ["door"] } }], seed: 1 });
  assert.ok(dw.success);
  // Something no tile offers fails deterministically with an explanation line.
  const none = sampleSolve({ cells: [{ i: 0, j: 0 }], variants, constraints: [{ n: { requireAny: ["portcullis"] } }], seed: 1 });
  assert.equal(none.success, false);
  assert.ok(describeCellConstraints({ n: { requireAny: ["portcullis"] } }, variants, sampleMapping.compatible)[0].includes("(0 variants)"));
});

test("boundary tags do not apply to sides that face an existing tile", () => {
  const variants = expandVariants(sampleTiles);
  // The west neighbour exists and shows a wall towards us: our west side must be compatible with
  // it, and the boundary rule must stay out of the way.
  const r = sampleSolve({ cells: [{ i: 0, j: 0 }], variants, boundaryTags: ["wall"], constraints: [{ w: { compatibleWith: ["wall"] } }], seed: 1 });
  assert.ok(r.success, "boundary must not also demand a wall on the west side");
  const tags = r.assignments[0].variant.tags;
  assert.ok(tagsMatch(tags.w, ["wall"], sampleCompat));
  assert.deepEqual(tags.n, ["wall"]);
  assert.deepEqual(tags.e, ["wall"]);
  assert.deepEqual(tags.s, ["wall"]);
  const lines = describeCellConstraints({ w: { compatibleWith: ["wall"] } }, variants, sampleMapping.compatible, { outside: ["n", "w"], boundaryTags: ["wall"] });
  assert.ok(lines.some(l => l.startsWith("north must be exactly [wall]")));
  assert.ok(!lines.some(l => l.startsWith("west must be exactly")));
});

test("markers along a line are solved with backtracking", () => {
  // 10x10 region, a vertical line of ten edge markers requiring "wall" tags between columns 4 and 5,
  // plus ten door-feature markers between columns 7 and 8, doors only where marked, closed boundary.
  const cells = cellsInPolygon([[0, 0], [1000, 0], [1000, 1000], [0, 1000]], 100);
  const index = new Map(cells.map((c, k) => [`${c.i},${c.j}`, k]));
  const variants = expandVariants(sampleTiles);
  const shared = [];
  for (let i = 0; i < 10; i++) {
    shared.push({ a: index.get(`${i},4`), sideA: "e", b: index.get(`${i},5`), sideB: "w", tags: ["wall"] });
    shared.push({ a: index.get(`${i},7`), sideA: "e", b: index.get(`${i},8`), sideB: "w", feature: "door" });
  }
  const constraints = cells.map(c => {
    const r = {};
    for (const side of SIDES) r[side] = { forbid: ["door"], forbidFeatures: ["door"] };
    r.c = { forbidFeatures: ["door"] };
    if (c.j === 7) r.e = {};
    if (c.j === 8) r.w = {};
    return r;
  });
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = sampleSolve({ cells, variants, boundaryTags: ["wall"], constraints, shared, seed });
    assert.ok(r.success, `seed ${seed}: ${r.failure?.stage}`);
    assertConsistent(r, cells);
    for (let i = 0; i < 10; i++) {
      assert.deepEqual(r.assignments[index.get(`${i},4`)].variant.tags.e, ["wall"]);
      const left = r.assignments[index.get(`${i},7`)].variant;
      const right = r.assignments[index.get(`${i},8`)].variant;
      assert.ok(left.features.e.includes("door") || right.features.w.includes("door"), `row ${i} door`);
    }
  }
});

test("backtracking budget produces a collapse failure instead of hanging", () => {
  // Every cell demands a door on its east side; the tile east of it must then show a door on its
  // west, which no sample tile combines with a door on its own east. Unsatisfiable, found by search.
  const cells = cellsInPolygon([[0, 0], [300, 0], [300, 100], [0, 100]], 100);
  const variants = expandVariants(sampleTiles);
  const constraints = cells.map(() => ({ e: { requireFeatures: ["door"] }, w: { requireFeatures: ["door"] } }));
  const r = sampleSolve({ cells, variants, constraints, seed: 1, maxAttempts: 2, maxBacktracks: 50 });
  assert.equal(r.success, false);
  assert.ok(["constraints", "propagation", "shared", "collapse"].includes(r.failure.stage));
});

test("feature markers on an outside edge take priority over boundary tags", () => {
  const variants = expandVariants(sampleTiles);
  // Two cells on top of each other: the top one must draw a door on its north outline edge.
  const r = sampleSolve({ cells: [{ i: 0, j: 0 }, { i: 1, j: 0 }], variants, boundaryTags: ["wall"], constraints: [{ n: { requireFeatures: ["door"] } }, {}], seed: 1 });
  assert.ok(r.success);
  const tags = r.assignments[0].variant.tags;
  assert.deepEqual(tags.n, ["door"]);
  assert.deepEqual(tags.e, ["wall"]);
  assert.deepEqual(tags.w, ["wall"]);
  assert.deepEqual(r.assignments[1].variant.tags.s, ["wall"]);
  const lines = describeCellConstraints({ n: { requireFeatures: ["door"] } }, variants, null, { outside: ["n"], boundaryTags: ["wall"] });
  assert.ok(!lines.some(l => l.startsWith("north must be exactly")));
});

test("allowedVariants filters a single cell like the solver does", () => {
  const variants = expandVariants(sampleTiles);
  const all = allowedVariants(variants, {}, null);
  assert.equal(all.length, variants.length);
  const walls = allowedVariants(variants, { n: { compatibleWith: ["wall"] }, e: { compatibleWith: ["wall"] } }, null);
  assert.ok(walls.length > 0);
  for (const v of walls) { assert.deepEqual(v.tags.n, ["wall"]); assert.deepEqual(v.tags.e, ["wall"]); }
  const doors = allowedVariants(variants, { c: { requireFeatures: ["door"] } }, null);
  assert.ok(doors.length > 0 && doors.every(v => v.features.c.includes("door")));
  assert.equal(allowedVariants(variants, { n: { require: ["nothing"] } }, null).length, 0);
});

test("a floor-only zone solves to an open room with walls around it", async () => {
  const { zoneSideRule } = await import("../scripts/lib/zones.js");
  const cells = cellsInPolygon([[0, 0], [600, 0], [600, 500], [0, 500]], 100);
  const variants = expandVariants(sampleTiles);
  const zones = [{ type: "open", polygon: [[100, 100], [500, 100], [500, 400], [100, 400]], tags: ["floor"], border: ["wall"] }];
  const constraints = cells.map(cell => {
    const c = {};
    for (const side of SIDES) {
      const rule = zoneSideRule(zones, cell, side, 100);
      if (rule) c[side] = { require: rule.require };
    }
    return c;
  });
  const r = sampleSolve({ cells, variants, boundaryTags: ["wall"], constraints, seed: "room" });
  assert.ok(r.success, r.failure?.stage);
  assertConsistent(r, cells);
  for (const a of r.assignments) {
    const inside = a.cell.i >= 1 && a.cell.i <= 3 && a.cell.j >= 1 && a.cell.j <= 4;
    if (!inside) continue;
    for (const side of SIDES) {
      const rule = zoneSideRule(zones, a.cell, side, 100);
      assert.deepEqual(a.variant.tags[side], rule.require, `cell ${a.cell.j},${a.cell.i} ${side}`);
    }
  }
});
