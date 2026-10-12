# Wave Function Collapse Dungeons for Foundry VTT

A Foundry VTT module that procedurally generates dungeons from your own tile sets using
[wave function collapse](https://github.com/mxgmn/WaveFunctionCollapse).

Draw the outline of a dungeon on the canvas, pick which tile collections to use, and the module
fills the outline with tiles whose side tags match, places the walls each tile defines, and walls
off the outline.

- **Outline tool** in the Tiles controls: click grid points to draw any shape, or generate from
  selected Drawings (rectangle, polygon, ellipse, circle).
- **Tile collections** are plain directories of images plus a `mapping.json`. Create them from the
  collections menu, register directories you already have, and add or remove tiles at any time.
- **Side tags**: every tile has a tag set for its north, east, south and west side. Two tiles may
  touch only when the tag sets on the shared side are identical.
- **Walls per tile**: draw wall, door and secret door segments on each tile in a small editor. They
  are placed as Foundry walls when the tile is used.
- **Multiple collections** can be combined in one generation. Tags are global, so tiles from
  different collections connect when their tags agree.
- **Regenerate part of a dungeon**: draw an outline over an existing generation. Tiles inside are
  replaced, tiles around it stay and constrain the new ones, walls are clipped at the border.
- **Markers**: pin required tags or a door to a cell edge, or require a door inside a cell, then
  restrict doors to marked places only.
- **Zones**: draw a floor-only zone to get one big open room walled around, or a no-tile zone that
  stays blank. Edge markers on a zone border take priority, so doors go where you mark them.
- **Tile picker**: click a cell and choose by hand among the tiles the solver would allow there.
- Rotation support, weights, seeds for reproducible layouts, and a sample collection to start with.

## Installation

In Foundry's **Add-on Modules** tab choose **Install Module** and paste this manifest URL:

```
https://github.com/RexTheCapt/foundry-wave-function-collapse/releases/latest/download/module.json
```

Requires Foundry VTT v12 to v14 and a scene with a **square grid**.

## Usage

### 1. Draw the outline

1. Open a scene with a square grid and select the **Tiles** control group.
2. Click **Draw dungeon outline (WFC)**.
3. Click on grid points to add vertices. Right-click removes the last vertex, Escape clears.
4. Click the first vertex again (or press Enter) to close the outline.

Alternatively draw a rectangle, polygon, ellipse or circle with the regular Drawing tools, keep it
selected and click **Generate dungeon from selected drawings (WFC)** in the **Drawings** controls.

Every grid cell whose center lies inside the outline receives a tile. The outline itself becomes
walls along the cell edges that face outside.

### 2. Choose collections and generate

A panel asks which tile collections to use (multiple choice), a seed, and optional
**boundary tags**. When boundary tags are set, tile sides that face outside the outline must match
them. The bundled sample collection uses the boundary tag `wall` so the dungeon is closed off.

The outline stays active while the panel is open. Press **Generate** as often as you like with
different settings or seeds (each run replaces the previous one inside the outline when
"Replace previous generation" is on), and press **Done** when you are happy. If no arrangement
exists, the panel explains which cell failed and which of its constraints collide.

Options:

| Option | Effect |
| --- | --- |
| Only where marked | Tags and door features listed here (for example `door`) may only appear where a marker asks for them. |
| Match surrounding tiles | Generated tiles next to the outline constrain the new tiles, and no outline wall is placed between them. |
| Walls along the outline | Create wall segments on the outer edge of the outline. |
| Walls from tiles | Create the walls defined on each placed tile. |
| Merge collinear walls | Join touching wall segments of the same type into longer walls. |
| Replace previous generation | Remove tiles and walls this module placed inside the outline before placing new ones. |

**Remove generated dungeon (WFC)** removes the last generation, everything the module placed on
the scene, or all markers.

### Regenerating an area

Draw a new outline over part of an existing dungeon and generate again. With **Replace previous
generation** on, the tiles inside the outline are removed. With **Match surrounding tiles** on, the
tiles just outside the outline keep their place and the new tiles must match their side tags, so
corridors and rooms stay connected. Existing walls that cross the outline are shortened to the
outside, and walls on the shared border are kept in the pool so doors in neighbouring tiles survive.

### Markers: doors where you want them

Select **Door and edge markers (WFC)** in the Tiles controls.

- Click near a cell edge to place an **edge marker**. It can require side tags on that edge (one of
  the two tiles must have exactly those tags there, the other must be compatible) and door features (`door` or `secret`): at least one of
  the two tiles must draw that kind of door on the edge.
- Click the center of a cell to place a **cell marker** that requires a door drawn inside the tile,
  for example a door across a corridor.
- Shift-click repeats the last marker, right-click removes one. Markers are saved with the scene and
  drawn in green while the Tiles controls are open.

### Zones

Select **Zones (WFC)** and outline an area the same way as a dungeon outline. When you close it, a
prompt asks which kind of zone it is:

- **Floor only**: nothing from the *not allowed inside* list (default `wall, door`) may appear on
  an edge between two cells of the zone, and every edge around the zone must carry the *border
  tags* (default `wall`). The result is one open room with walls around it. Leave the border tags
  empty to let the generator decide.
- **No tiles**: the zone stays blank. The generator treats it as outside, removes anything it placed
  there before, puts walls along its border and applies the boundary tags to the tiles around it.

Edge markers on a zone border take priority over the zone's border tags and the boundary tags, so
a `door` marker opens a doorway into or out of the zone. Right-click inside a zone to remove it, or
clear them all from the "Remove generated dungeon" dialog. Zones are saved with the scene and drawn
while the Tiles controls are open: green for floor-only, red hatched for no-tile.

### Tile picker

Select **Tile picker (WFC)** and click a cell. A window lists the tile variants (including
rotations) that fit that cell under the solver's rules: compatible with the generated tiles around
it, respecting markers on its edges, zones and the last "Only where marked" setting. Click a tile to place it; walls are created and clipped exactly as during generation.
"Show all tiles" lists every variant with the blocked ones dimmed, in case you want to override the
rules on purpose.

To make doors appear *only* at markers, put `door` in **Only where marked** in the generate panel.
Tiles with a door on an unmarked edge or inside an unmarked cell are then never placed there. The
same works for `secret` doors or for any tag, such as `wall`.

### 3. Manage tile collections

Open **Tile collections (WFC)** from the Tiles controls or from the module settings.

- **New collection** creates a directory under the configured root
  (default `worlds/<world>/wfc-collections/<name>`) with an empty `mapping.json`.
- **Add existing directory** registers any directory in your user data.
- Inside a collection, filter the tile list by tag, on any side or on one chosen side, to find the
  tiles that carry a given tag. **Add tile** opens a file picker rooted at the collection directory. Use the
  picker's upload button to copy images into it. **Scan directory** maps every image that is not in
  the mapping yet.
- Each tile has tags per side, a weight, a rotation flag and a wall editor. In the wall editor click
  two snap points to add a wall, hold Shift to chain, right-click a wall to delete it. Choose
  *Wall*, *Door* or *Secret door* before drawing.

## Tag matching rules

- Tags are compared as sets, so order does not matter: `floor,wall` equals `wall,floor`.
- By default the sets on the shared side must be **identical**. A side tagged `floor` does not
  match a side tagged `floor,rubble`.
- A collection can declare **compatible tags** so that differing tags may face each other, for
  example `wall: floor` for art where only one tile draws the wall. A tag listed on the left stops
  matching itself unless it lists itself.
- A side can offer **alternative** tag sets separated by `|`, for example `floor | wall` on a
  plain floor tile so it also fits against a wall drawn by the neighbour. The side matches when
  any of its alternatives matches any alternative of the other side. Internally each combination
  of alternatives becomes its own variant with the tile's full weight, so keep the number of
  alternatives small. In `mapping.json` a side with alternatives is an array of arrays:
  `"e": [["floor"], ["wall"]]`.
- A collection can also declare **incompatible tags**, for example `door: wall, door`. A listed
  pair never faces each other, whatever the compatible table, alternatives or wildcards say.
- An empty tag set only matches another empty tag set.
- The wildcard `*` matches anything, except pairs listed as incompatible.
- When a tile allows rotation, its tags and walls rotate with it (clockwise: north becomes east).

### One-sided or two-sided walls

Two conventions work:

1. **One-sided walls** (the sample): the tile tagged `wall` draws the whole band inside its own
   area and the neighbour shows floor up to the edge. The compatibility table `wall: floor...`
   lets a wall side face any floor side and keeps two wall sides apart, so a wall is never doubled
   and a plain floor tile fits against any wall. To keep straight walls on the same side of the grid
   line, floor sides record which of their corners carry a band: `floor-e` on a north side means
   "my east side is a wall", so the tile above must continue that wall on its own east side. The
   sample generates these tags and bakes rotations into separate images, because the corner
   markers are absolute. Any floor tag (`floor`, `floor-e`, `floor-ns`, ...) is compatible with
   `wall` and `door`.
2. **Centered walls**: the wall sits on the grid line and both tiles draw their half of the band,
   so both sides are tagged `wall` and need no compatibility table. Straight walls are always
   straight, and doors must be drawn half by each tile with both sides tagged `door`. Identical
   wall segments are deduplicated, so the Foundry wall is still single.

### Doors

A door is any wall segment of type *Door* or *Secret door* in the tile editor. The generator reads
**door features** from them:

- A door segment lying on a tile edge is a door feature of that side.
- Any other door segment is a door feature of the tile center.

With one-sided walls a door tile draws the complete door, tags that side `door`, and the
compatibility table makes it face a floor side, so a door never leads into a wall. With centered
walls both tiles draw half of the door and tag that side `door`. Should a plain wall segment ever
share a line with a door, the wall is cut away around the door span so it stays passable.

A door in the middle of a tile (`door-mid.png`) is a center feature and can be demanded with a cell
marker.

## mapping.json format

Each collection directory contains a `mapping.json` that maps every tile image in that directory:

```json
{
  "version": 1,
  "name": "Sample dungeon",
  "description": "Optional text",
  "boundary": ["wall"],
  "tiles": {
    "wall-1.png": {
      "tags": { "n": ["wall"], "e": ["floor"], "s": ["floor"], "w": ["floor"] },
      "walls": [ { "c": [0, 0, 1, 0], "door": 0 } ],
      "weight": 3,
      "rotate": true
    }
  }
}
```

- `tiles` keys are file names relative to the directory.
- `walls[].c` are `[x1, y1, x2, y2]` in normalized tile coordinates from `0` (top/left) to `1`
  (bottom/right). `door` is `0` wall, `1` door, `2` secret door.
- `weight` is the relative probability of the tile. `rotate` enables the three rotated variants.
- `boundary` pre-fills the boundary tags in the generate dialog.
- `restricted` pre-fills "Only where marked" in the generate dialog.
- `compatible` maps a tag to the tags it may face, e.g. `{ "wall": ["floor"] }`. The relation is
  symmetric; tables of all selected collections are merged. New collections start with
  `wall: floor`, which is also assumed when the key is missing; write `{}` to disable it.
- `incompatible` maps a tag to tags it must never face, e.g. `{ "door": ["wall", "door"] }`. Also
  symmetric and merged across collections; it overrides everything else.

You can edit the file by hand; the collection editor reloads it from disk.

## Sample collection

`collections/sample-dungeon` ships with thirty generated stone tiles (ten shapes with their
rotations baked in) using one-sided walls, the tags `wall`, `door` and the `floor-*` family with
corner markers, a compatibility table, and a door across the middle of a corridor. It is registered by default and is a good template for your own art. Regenerate it with
`npm run sample-tiles`.

## API

`game.modules.get("wave-function-collapse").api` exposes:

- `generateDungeon({ polygon, collectionDirs, seed, boundaryTags, restrictedTags, matchSurroundings, placeOutlineWalls, placeTileWalls, clearExisting, mergeWalls })`
- `clearGenerated("last" | "all")`
- `getMarkers()`, `clearMarkers()`, `getZones()` and `clearZones()` for the current scene.
- `candidatesForCell(cell, collectionDirs)` and `placeTileAt(cell, variant)` for manual placement.
- `openCollections()`
- `wfc` and `geometry`, the pure solver and grid helpers.

Example macro that fills a 10x8 cell rectangle at the top-left of the scene:

```js
const api = game.modules.get("wave-function-collapse").api;
const s = canvas.grid.size;
await api.generateDungeon({
  polygon: [[0, 0], [10 * s, 0], [10 * s, 8 * s], [0, 8 * s]],
  collectionDirs: ["modules/wave-function-collapse/collections/sample-dungeon"],
  boundaryTags: ["wall"],
  seed: "my-seed"
});
```

## Troubleshooting

The **Debug logging** setting (on by default) writes detailed messages prefixed with
`wave-function-collapse |` to the browser console (F12). They show when tools activate, every
outline vertex, which collections were loaded, the solver result and the documents created. Include
them when reporting an issue.

## Development

```
npm test              # unit tests for the solver and geometry helpers
npm run sample-tiles  # regenerate the bundled sample collection
```

The solver (`scripts/lib/wfc.js`) and geometry helpers (`scripts/lib/geometry.js`) have no Foundry
dependencies. Releases are built by GitHub Actions when a `v*` tag is pushed.

## License

MIT
