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

A dialog asks which tile collections to use (multiple choice), a seed, and optional
**boundary tags**. When boundary tags are set, tile sides that face outside the outline must match
them. The bundled sample collection uses the boundary tag `wall` so the dungeon is closed off.

Options:

| Option | Effect |
| --- | --- |
| Walls along the outline | Create wall segments on the outer edge of the outline. |
| Walls from tiles | Create the walls defined on each placed tile. |
| Merge collinear walls | Join touching wall segments of the same type into longer walls. |
| Replace previous generation | Remove tiles and walls this module placed inside the outline before placing new ones. |

**Remove generated dungeon (WFC)** removes the last generation or everything the module placed on
the scene.

### 3. Manage tile collections

Open **Tile collections (WFC)** from the Tiles controls or from the module settings.

- **New collection** creates a directory under the configured root
  (default `worlds/<world>/wfc-collections/<name>`) with an empty `mapping.json`.
- **Add existing directory** registers any directory in your user data.
- Inside a collection, **Add tile** opens a file picker rooted at the collection directory. Use the
  picker's upload button to copy images into it. **Scan directory** maps every image that is not in
  the mapping yet.
- Each tile has tags per side, a weight, a rotation flag and a wall editor. In the wall editor click
  two snap points to add a wall, hold Shift to chain, right-click a wall to delete it. Choose
  *Wall*, *Door* or *Secret door* before drawing.

## Tag matching rules

- Tags are compared as sets, so order does not matter: `floor,wall` equals `wall,floor`.
- The sets on the shared side must be **identical**. A side tagged `floor` does not match a side
  tagged `floor,rubble`.
- An empty tag set only matches another empty tag set.
- The wildcard `*` matches anything.
- When a tile allows rotation, its tags and walls rotate with it (clockwise: north becomes east).

Because adjacent tiles both draw their own walls on the shared edge, identical wall segments are
removed before placing, so a wall tagged side on both tiles results in a single wall. Use a distinct
tag (for example `door`) on both sides of a doorway so that a door tile is always paired with
another door tile.

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

You can edit the file by hand; the collection editor reloads it from disk.

## Sample collection

`collections/sample-dungeon` ships with nine generated stone tiles using the tags `floor`, `wall`
and `door`. It is registered by default and is a good template for your own art. Regenerate it with
`npm run sample-tiles`.

## API

`game.modules.get("wave-function-collapse").api` exposes:

- `generateDungeon({ polygon, collectionDirs, seed, boundaryTags, placeOutlineWalls, placeTileWalls, clearExisting, mergeWalls })`
- `clearGenerated("last" | "all")`
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
