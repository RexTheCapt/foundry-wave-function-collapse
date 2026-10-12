# Changelog

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
