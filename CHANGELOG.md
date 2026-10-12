# Changelog

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
