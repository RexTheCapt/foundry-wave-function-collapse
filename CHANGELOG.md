# Changelog

## 0.4.2

- Edge markers have separate side tags and door features again. The features field only accepts
  door types; other entries become side tags with a notice. Markers saved by 0.4.1 are migrated.

## 0.4.1

- Edge markers no longer distinguish tags from door features. A marker lists what must be on the
  edge (`wall`, `door`, ...) and is satisfied by a side tag or a drawn door of that name. Existing
  markers are migrated. A marker asking for `wall` previously could never be satisfied.
- Text in the generate panel can be selected, and a button copies the status message.

## 0.4.0

- The generate dialog is now a panel that keeps the outline active: generate repeatedly with
  different settings or seeds and press Done to finish. A "new seed for every generation" option
  rolls the seed after each run.
- Failed generations explain themselves: the panel and the console name the failing cell, which
  neighbour forced it, and every constraint on that cell with the number of tiles satisfying it.
  Deterministic failures no longer waste 20 restarts.
- Markers tool renamed to "Edge markers". Press on an edge and drag along its grid line to mark or
  (with the right button) unmark the whole line.

## 0.3.0

- Collections can declare compatible tags (`"compatible": { "wall": ["floor"] }`), so differing
  tags may face each other and a listed tag stops matching itself. Editable in the collection
  editor.
- Sample collection rebuilt with one-sided walls: only one tile draws the wall on an edge and doors
  always open onto floor. Fixes doubled wall art and doors leading into walls. `door-wall.png` is
  gone; `door-1.png` now serves that purpose.
- Surrounding tiles constrain regeneration through compatibility instead of exact equality, and
  edge markers with tags require the tags on one side of the edge with a compatible other side.

## 0.2.1

- Fixed tiles being placed half a cell off on Foundry v14, where a tile's x and y are the position
  of its texture anchor and the default anchor is the tile center. Placement now follows the
  anchor default of the running version, so v12 and v13 are unchanged.

## 0.2.0

- Regenerate part of a dungeon: tiles inside the outline are replaced while generated tiles next to
  it constrain the new tiles ("Match surrounding tiles"). Existing walls are clipped to the outline
  instead of deleted and no outline wall is placed towards existing tiles.
- Door and edge markers tool: pin required side tags or door features to a cell edge, or require a
  door inside a cell. Markers are stored on the scene and drawn while the Tiles controls are open.
- "Only where marked" restriction keeps tags and door features (door, secret) out of every place
  without a matching marker.
- Door features are read from a tile's door segments, so a tile can draw a complete door on a
  wall-tagged side or a door across its middle. Plain walls on the same line are cut around doors.
- Sample collection gains door-wall.png and door-mid.png. Collections may declare default
  restricted tags.

## 0.1.1

- Fixed the outline tool never activating on Foundry v13 and v14, where selecting a tool does not
  re-render the scene controls. The tool now reacts to its own `onChange` callback.
- Moved "Generate dungeon from selected drawings" into the Drawings control group. Switching to the
  Tiles group released the selection, so the button never had anything to work with.
- Added a "Debug logging" client setting (on by default) that writes troubleshooting output to the
  browser console.
- Fixed every window failing to open with "Template part must render a single HTML element".
- Marked the module as verified for Foundry v14.

## 0.1.0

- Initial release.
- Outline drawing tool and generation from selected drawings.
- Tile collections stored as directories with `mapping.json`.
- Collection and tile editors with side tags, weights, rotation and a wall editor.
- Wave function collapse solver with boundary tags, seeds and restarts.
- Bundled sample collection.
