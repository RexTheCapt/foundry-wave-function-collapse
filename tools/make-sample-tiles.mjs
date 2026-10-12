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
const BAND = 12; // wall thickness in pixels
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

/** Tile definitions: which sides are walls ("w"), doors ("d") or open floor ("f"). */
const TILES = [
  { file: "floor.png", sides: "ffff", weight: 4, rotate: false, base: "floor" },
  { file: "wall-1.png", sides: "wfff", weight: 3, rotate: true, base: "floor" },
  { file: "wall-corner.png", sides: "wwff", weight: 2, rotate: true, base: "floor" },
  { file: "wall-corridor.png", sides: "wfwf", weight: 1.5, rotate: true, base: "floor" },
  { file: "wall-3.png", sides: "wwfw", weight: 0.6, rotate: true, base: "floor" },
  { file: "rock.png", sides: "wwww", weight: 0.4, rotate: false, base: "rock" },
  { file: "door-1.png", sides: "dfff", weight: 0.6, rotate: true, base: "floor" },
  { file: "door-corner.png", sides: "dwff", weight: 0.5, rotate: true, base: "floor" },
  { file: "door-3.png", sides: "dwfw", weight: 0.4, rotate: true, base: "floor" }
];
const TAG = { f: ["floor"], w: ["wall"], d: ["door"] };

fs.mkdirSync(OUT, { recursive: true });
const mapping = {
  version: 1,
  name: "Sample dungeon",
  description: "Simple generated stone tiles. Side tags: floor, wall, door. Use boundary tag \"wall\" to close the outline.",
  boundary: ["wall"],
  tiles: {}
};
TILES.forEach((def, index) => {
  const r = new Raster(1000 + index);
  if (def.base === "rock") rockBase(r); else floorBase(r);
  const tags = {};
  const walls = [];
  ["n", "e", "s", "w"].forEach((side, k) => {
    const kind = def.sides[k];
    tags[side] = TAG[kind];
    if (kind === "w") { wallBand(r, side); walls.push(...sideWalls(side)); }
    if (kind === "d") { wallBand(r, side, DOOR_GAP); walls.push(...sideWalls(side, true)); }
  });
  fs.writeFileSync(path.join(OUT, def.file), encodePNG(SIZE, SIZE, r.px));
  mapping.tiles[def.file] = { tags, walls, weight: def.weight, rotate: def.rotate };
});
fs.writeFileSync(path.join(OUT, "mapping.json"), JSON.stringify(mapping, null, 2) + "\n");
console.log(`Wrote ${TILES.length} tiles to ${OUT}`);
