/**
 * Generates the bundled "sample-dungeon" collection: simple procedural PNG tiles
 * and the mapping.json that describes their side tags and walls.
 *
 * Run with: npm run sample-tiles
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const SIZE = 128;
const BAND = 10; // wall thickness in pixels: the tile tagged wall draws the whole band inside its own area
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../collections/sample-dungeon");

// ---------- tiny PNG encoder ----------
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

// ---------- raster helpers ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
class Raster {
  constructor(seed) { this.px = Buffer.alloc(SIZE * SIZE * 4); this.rand = rng(seed); }
  set(x, y, [r, g, b]) {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    const o = (y * SIZE + x) * 4;
    this.px[o] = r; this.px[o + 1] = g; this.px[o + 2] = b; this.px[o + 3] = 255;
  }
  rect(x, y, w, h, color, noise = 0) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      const n = noise ? (this.rand() - 0.5) * 2 * noise : 0;
      this.set(i, j, color.map(c => Math.max(0, Math.min(255, Math.round(c + n)))));
    }
  }
}
const FLOOR = [128, 118, 104];
const FLOOR_LINE = [104, 95, 84];
const ROCK = [58, 54, 50];
const WALL = [42, 34, 30];
const WALL_HI = [78, 64, 56];
const DOOR = [138, 86, 36];
const DOOR_DARK = [84, 50, 20];

function floorBase(r) {
  r.rect(0, 0, SIZE, SIZE, FLOOR, 12);
  for (let k = 0; k < SIZE; k += 32) {
    r.rect(k, 0, 1, SIZE, FLOOR_LINE, 6);
    r.rect(0, k, SIZE, 1, FLOOR_LINE, 6);
  }
  for (let k = 0; k < SIZE; k += 32) {
    for (let m = 0; m < SIZE; m += 32) {
      if ((k / 32 + m / 32) % 2 === 0) r.rect(k + 16, m, 1, 32, FLOOR_LINE, 6);
      else r.rect(k, m + 16, 32, 1, FLOOR_LINE, 6);
    }
  }
}
function rockBase(r) {
  r.rect(0, 0, SIZE, SIZE, ROCK, 14);
  for (let k = 0; k < 90; k++) {
    const x = Math.floor(r.rand() * SIZE), y = Math.floor(r.rand() * SIZE);
    r.rect(x, y, 2, 2, [82, 78, 74], 10);
  }
}
/** Draw a wall band along a side; `gap` is [from, to] in 0..1 along the side for a door opening. */
function wallBand(r, side, gap = null) {
  const bands = {
    n: (a, b) => r.rect(a, 0, b - a, BAND, WALL, 8),
    s: (a, b) => r.rect(a, SIZE - BAND, b - a, BAND, WALL, 8),
    w: (a, b) => r.rect(0, a, BAND, b - a, WALL, 8),
    e: (a, b) => r.rect(SIZE - BAND, a, BAND, b - a, WALL, 8)
  };
  const highlights = {
    n: (a, b) => r.rect(a, BAND - 1, b - a, 1, WALL_HI),
    s: (a, b) => r.rect(a, SIZE - BAND, b - a, 1, WALL_HI),
    w: (a, b) => r.rect(BAND - 1, a, 1, b - a, WALL_HI),
    e: (a, b) => r.rect(SIZE - BAND, a, 1, b - a, WALL_HI)
  };
  const segments = gap ? [[0, Math.round(gap[0] * SIZE)], [Math.round(gap[1] * SIZE), SIZE]] : [[0, SIZE]];
  for (const [a, b] of segments) { bands[side](a, b); highlights[side](a, b); }
  if (gap) {
    const a = Math.round(gap[0] * SIZE), b = Math.round(gap[1] * SIZE);
    const doors = {
      n: () => { r.rect(a, 2, b - a, BAND - 4, DOOR, 10); r.rect(a, 2, b - a, 1, DOOR_DARK); r.rect(a, BAND - 3, b - a, 1, DOOR_DARK); },
      s: () => { r.rect(a, SIZE - BAND + 2, b - a, BAND - 4, DOOR, 10); r.rect(a, SIZE - BAND + 2, b - a, 1, DOOR_DARK); r.rect(a, SIZE - 3, b - a, 1, DOOR_DARK); },
      w: () => { r.rect(2, a, BAND - 4, b - a, DOOR, 10); r.rect(2, a, 1, b - a, DOOR_DARK); r.rect(BAND - 3, a, 1, b - a, DOOR_DARK); },
      e: () => { r.rect(SIZE - BAND + 2, a, BAND - 4, b - a, DOOR, 10); r.rect(SIZE - BAND + 2, a, 1, b - a, DOOR_DARK); r.rect(SIZE - 3, a, 1, b - a, DOOR_DARK); }
    };
    doors[side]();
  }
}

// Normalized wall segments along a side, optionally with a door gap.
const EDGE = { n: [0, 0, 1, 0], e: [1, 0, 1, 1], s: [0, 1, 1, 1], w: [0, 0, 0, 1] };
const DOOR_GAP = [0.35, 0.65];
function sideWalls(side, door = false) {
  const [x1, y1, x2, y2] = EDGE[side];
  if (!door) return [{ c: [x1, y1, x2, y2], door: 0 }];
  const lerp = t => [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
  const [a, b] = DOOR_GAP;
  return [
    { c: [...lerp(0), ...lerp(a)], door: 0 },
    { c: [...lerp(a), ...lerp(b)], door: 1 },
    { c: [...lerp(b), ...lerp(1)], door: 0 }
  ];
}

/**
 * Base tile definitions: which sides are walls ("w"), doors ("d") or open floor ("f").
 *
 * Walls are one-sided: the tile whose side is tagged "wall" draws the whole band inside its own
 * area and the tile on the other side shows floor up to the edge. The collection's compatible
 * tags let a wall or door side face any floor side, while two wall sides never meet.
 *
 * To keep walls straight, floor sides remember whether a band ends in their corners:
 * "floor-e" on a north side means "floor here, but my east side carries a wall", so the tile
 * above must continue that wall on its own east side. Rotations are generated as separate
 * images because these corner markers are absolute.
 */
const BASES = [
  { name: "floor", sides: "ffff", weight: 4, base: "floor" },
  { name: "wall-1", sides: "wfff", weight: 3, base: "floor" },
  { name: "wall-corner", sides: "wwff", weight: 2, base: "floor" },
  { name: "wall-corridor", sides: "wfwf", weight: 1.5, base: "floor" },
  { name: "wall-3", sides: "wwfw", weight: 0.6, base: "floor" },
  { name: "rock", sides: "wwww", weight: 0.4, base: "rock" },
  { name: "door-1", sides: "dfff", weight: 0.6, base: "floor" },
  { name: "door-corner", sides: "dwff", weight: 0.5, base: "floor" },
  { name: "door-3", sides: "dwfw", weight: 0.4, base: "floor" },
  { name: "door-mid", sides: "wfwf", weight: 0.5, base: "floor", midDoor: true }
];
const SIDE_NAMES = ["n", "e", "s", "w"];

/**
 * Water tiles. Each has a mask (x, y in 0..1 -> water?) drawn over floor. Edge tags are derived
 * from how much of each edge is water: "water" (whole edge), "water-mid" (the middle, for
 * streams), "water-e"/"water-w" (east or west half of a horizontal edge), "water-n"/"water-s"
 * (north or south half of a vertical edge) or plain "floor".
 */
const STREAM = [0.3, 0.7];
const inBand = (v, [a, b]) => v >= a && v <= b;
const WATER_TILES = [
  { name: "water-pool", weight: 0.3, mask: (x, y) => Math.hypot(x - 0.5, y - 0.5) <= 0.3 },
  { name: "water-end", weight: 0.3, mask: (x, y) => Math.hypot(x - 0.5, y - 0.5) <= 0.2 || (inBand(x, STREAM) && y <= 0.5) },
  { name: "water-straight", weight: 0.4, mask: (x, y) => inBand(x, STREAM) },
  { name: "water-bend", weight: 0.3, mask: (x, y) => Math.hypot(x - 0.5, y - 0.5) <= 0.2 || (inBand(x, STREAM) && y <= 0.5) || (inBand(y, STREAM) && x >= 0.5) },
  { name: "water-t", weight: 0.15, mask: (x, y) => Math.hypot(x - 0.5, y - 0.5) <= 0.2 || (inBand(x, STREAM) && y <= 0.5) || inBand(y, STREAM) },
  { name: "water-cross", weight: 0.1, mask: (x, y) => inBand(x, STREAM) || inBand(y, STREAM) },
  { name: "water-full", weight: 0.5, mask: () => true },
  { name: "water-half", weight: 0.4, mask: (x, y) => x >= 0.5 },
  { name: "water-corner", weight: 0.4, mask: (x, y) => Math.hypot(x - 1, y) <= 0.5 },
  { name: "water-corner-inner", weight: 0.2, mask: (x, y) => Math.hypot(x, y - 1) > 0.5 }
];
const WATER = [46, 96, 168];
const WATER_DEEP = [34, 72, 136];
const SHORE = [70, 60, 48];

function drawWater(r, mask) {
  const m = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) m[y * SIZE + x] = mask((x + 0.5) / SIZE, (y + 0.5) / SIZE) ? 1 : 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!m[y * SIZE + x]) continue;
      const shore = [[2, 0], [-2, 0], [0, 2], [0, -2]].some(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < SIZE && ny < SIZE && !m[ny * SIZE + nx];
      });
      const ripple = Math.sin((x + y) / 6) > 0.7 ? 14 : 0;
      const color = shore ? SHORE : (Math.sin(x / 9) * Math.cos(y / 7) > 0.4 ? WATER_DEEP : WATER);
      const n = (r.rand() - 0.5) * 12 + ripple;
      r.set(x, y, color.map(c => Math.max(0, Math.min(255, Math.round(c + n)))));
    }
  }
  return m;
}

/** Edge tag from the water coverage along one edge of a mask. */
function waterEdgeTag(m, side) {
  const samples = [];
  for (let k = 0; k < SIZE; k++) {
    const idx = side === "n" ? k : side === "s" ? (SIZE - 1) * SIZE + k : side === "w" ? k * SIZE : k * SIZE + SIZE - 1;
    samples.push(m[idx]);
  }
  const covered = samples.filter(Boolean).length / SIZE;
  if (covered === 0) return "floor";
  if (covered >= 0.95) return "water";
  const first = samples.indexOf(1) / SIZE;
  const last = (samples.lastIndexOf(1) + 1) / SIZE;
  const horizontal = side === "n" || side === "s";
  if (first <= 0.05 && last >= 0.45 && last <= 0.55) return horizontal ? "water-w" : "water-n";
  if (first >= 0.45 && first <= 0.55 && last >= 0.95) return horizontal ? "water-e" : "water-s";
  return "water-mid";
}

function rotateMask(src) {
  const dst = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) dst[y * SIZE + x] = src[(SIZE - 1 - x) * SIZE + y];
  return dst;
}

/** Tag of one side, given the side types of the tile. */
function sideTag(types, side) {
  const t = types[side];
  if (t === "w") return "wall";
  if (t === "d") return "door";
  const band = x => types[x] === "w" || types[x] === "d";
  const flags = side === "n" || side === "s"
    ? (band("w") ? "w" : "") + (band("e") ? "e" : "")
    : (band("n") ? "n" : "") + (band("s") ? "s" : "");
  return flags ? `floor-${flags}` : "floor";
}
const FLOOR_TAGS = ["floor", "floor-w", "floor-e", "floor-we", "floor-n", "floor-s", "floor-ns"];

/** Rotate a raster 90 degrees clockwise. */
function rotateRaster(src) {
  const dst = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const sx = y;
      const sy = SIZE - 1 - x;
      src.copy(dst, (y * SIZE + x) * 4, (sy * SIZE + sx) * 4, (sy * SIZE + sx) * 4 + 4);
    }
  }
  return dst;
}
const rotatePoint = ([x, y]) => [1 - y, x];
const rotateTypes = t => ({ n: t.w, e: t.n, s: t.e, w: t.s });
const rotateWalls = walls => walls.map(w => ({ ...w, c: [...rotatePoint([w.c[0], w.c[1]]), ...rotatePoint([w.c[2], w.c[3]])] }));

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith(".png")) fs.unlinkSync(path.join(OUT, f));
const mapping = {
  version: 1,
  name: "Sample dungeon",
  description: "Simple generated stone tiles with one-sided walls: the tile tagged wall draws the band, any floor side may face it, and corner markers on floor sides keep walls straight. Use boundary tag \"wall\" to close the outline; restrict \"door\" to place doors only at markers.",
  boundary: ["wall"],
  compatible: { wall: FLOOR_TAGS, door: FLOOR_TAGS },
  tiles: {}
};
let count = 0;
BASES.forEach((def, index) => {
  const r = new Raster(1000 + index);
  if (def.base === "rock") rockBase(r); else floorBase(r);
  let types = {};
  let walls = [];
  SIDE_NAMES.forEach((side, k) => {
    const kind = def.sides[k];
    types[side] = kind;
    if (kind === "w") { wallBand(r, side); walls.push(...sideWalls(side)); }
    if (kind === "d") { wallBand(r, side, DOOR_GAP); walls.push(...sideWalls(side, true)); }
  });
  if (def.midDoor) {
    const x0 = Math.round(SIZE / 2) - 6;
    r.rect(x0, BAND, 12, SIZE - 2 * BAND, DOOR, 10);
    r.rect(x0, BAND, 1, SIZE - 2 * BAND, DOOR_DARK);
    r.rect(x0 + 11, BAND, 1, SIZE - 2 * BAND, DOOR_DARK);
    walls.push({ c: [0.5, 0, 0.5, 1], door: 1 });
  }
  let px = r.px;
  const seen = new Set();
  for (let rot = 0; rot < 4; rot++) {
    const signature = SIDE_NAMES.map(sd => types[sd]).join("") + (def.midDoor ? `|${rot % 2}` : "");
    if (!seen.has(signature)) {
      seen.add(signature);
      const file = rot === 0 ? `${def.name}.png` : `${def.name}-${rot * 90}.png`;
      fs.writeFileSync(path.join(OUT, file), encodePNG(SIZE, SIZE, px));
      const tags = {};
      for (const sd of SIDE_NAMES) tags[sd] = [sideTag(types, sd)];
      mapping.tiles[file] = { tags, walls: walls.map(w => ({ ...w, c: w.c.map(v => Math.round(v * 1000) / 1000) })), weight: def.weight, rotate: false };
      count++;
    }
    px = rotateRaster(px);
    types = rotateTypes(types);
    walls = rotateWalls(walls);
  }
});
WATER_TILES.forEach((def, index) => {
  const r = new Raster(2000 + index);
  floorBase(r);
  let mask = drawWater(r, def.mask);
  let px = r.px;
  const seen = new Set();
  for (let rot = 0; rot < 4; rot++) {
    const tags = {};
    for (const sd of SIDE_NAMES) tags[sd] = [waterEdgeTag(mask, sd)];
    const signature = SIDE_NAMES.map(sd => tags[sd][0]).join("/");
    if (!seen.has(signature)) {
      seen.add(signature);
      const file = rot === 0 ? `${def.name}.png` : `${def.name}-${rot * 90}.png`;
      fs.writeFileSync(path.join(OUT, file), encodePNG(SIZE, SIZE, px));
      mapping.tiles[file] = { tags, walls: [], weight: def.weight, rotate: false };
      count++;
    }
    px = rotateRaster(px);
    mask = rotateMask(mask);
  }
});
mapping.description += " Water tiles connect through water, water-mid (streams), water-e/w/n/s (half edges) tags.";
fs.writeFileSync(path.join(OUT, "mapping.json"), JSON.stringify(mapping, null, 2) + "\n");
console.log(`Wrote ${count} tiles to ${OUT}`);
