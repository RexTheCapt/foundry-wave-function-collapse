import { MODULE_ID, SAMPLE_COLLECTION, TOOL_OUTLINE, TOOL_FROM_DRAWING, TOOL_COLLECTIONS, TOOL_CLEAR } from "./constants.js";
import { OutlineTool } from "./outline-tool.js";
import { assertSquareGrid, clearGenerated, generateDungeon } from "./generator.js";
import { getRegisteredDirs, loadCollections } from "./collections.js";
import { cellsInPolygon, drawingToPolygon } from "./lib/geometry.js";
import * as wfc from "./lib/wfc.js";
import * as geometry from "./lib/geometry.js";
import { CollectionsApp } from "./apps/collections-app.js";
import { GenerateDialog } from "./apps/generate-dialog.js";

const outlineTool = new OutlineTool({ onFinish: polygon => generateForPolygons([polygon]) });

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

function registerSettings() {
  game.settings.register(MODULE_ID, "collectionsRoot", {
    name: "WFC.Settings.CollectionsRoot.Name",
    hint: "WFC.Settings.CollectionsRoot.Hint",
    scope: "world",
    config: true,
    type: String,
    default: `worlds/${game.world.id}/wfc-collections`
  });
  game.settings.register(MODULE_ID, "wallSnapDivisions", {
    name: "WFC.Settings.WallSnapDivisions.Name",
    hint: "WFC.Settings.WallSnapDivisions.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 1, max: 16, step: 1 },
    default: 4
  });
  game.settings.register(MODULE_ID, "collections", {
    scope: "world",
    config: false,
    type: Array,
    default: [SAMPLE_COLLECTION]
  });
  game.settings.register(MODULE_ID, "lastGeneration", {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
  game.settings.register(MODULE_ID, "lastSelection", {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  const menu = {
    name: "WFC.Settings.CollectionsMenu.Name",
    label: "WFC.Settings.CollectionsMenu.Label",
    hint: "WFC.Settings.CollectionsMenu.Hint",
    icon: "fa-solid fa-layer-group",
    restricted: true
  };
  try {
    game.settings.registerMenu(MODULE_ID, "collectionsMenu", { ...menu, type: CollectionsApp });
  } catch (err) {
    // Older validation only accepts FormApplication subclasses: wrap the AppV2 in a shim.
    const Base = foundry.appv1?.api?.FormApplication ?? globalThis.FormApplication;
    if (!Base) throw err;
    class CollectionsMenuShim extends Base {
      render() { CollectionsApp.open(); return this; }
      async _updateObject() {}
    }
    game.settings.registerMenu(MODULE_ID, "collectionsMenu", { ...menu, type: CollectionsMenuShim });
  }
}

/* -------------------------------------------- */
/*  Generation flow                             */
/* -------------------------------------------- */

/** Ask which collections to use, then generate for each polygon. */
async function generateForPolygons(polygons) {
  try {
    assertSquareGrid();
  } catch (err) {
    ui.notifications.error(err.message);
    return;
  }
  const size = canvas.grid.size;
  const cellCount = polygons.reduce((n, p) => n + cellsInPolygon(p, size).length, 0);
  if (!cellCount) {
    ui.notifications.warn(game.i18n.localize("WFC.Generate.NoCells"));
    return;
  }
  const collections = (await loadCollections(getRegisteredDirs())).filter(c => Object.keys(c.mapping.tiles).length);
  if (!collections.length) {
    ui.notifications.warn(game.i18n.localize("WFC.Generate.NoCollections"));
    CollectionsApp.open();
    return;
  }
  const options = await GenerateDialog.show({ collections, cellCount });
  if (!options) return;
  for (const polygon of polygons) {
    try {
      await generateDungeon({ polygon, ...options });
    } catch (err) {
      console.error(`${MODULE_ID} | generation failed`, err);
      ui.notifications.error(err.message);
    }
  }
}

async function generateFromDrawings() {
  const docs = (canvas.drawings?.controlled ?? []).map(d => d.document);
  const polygons = docs.map(drawingToPolygon).filter(p => p && p.length >= 3);
  if (!polygons.length) {
    ui.notifications.warn(game.i18n.localize("WFC.Errors.NoDrawing"));
    return;
  }
  await generateForPolygons(polygons);
}

async function clearDialog() {
  try {
    assertSquareGrid();
  } catch (err) {
    ui.notifications.error(err.message);
    return;
  }
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("WFC.Clear.Title"), icon: "fa-solid fa-eraser" },
    content: `<p>${game.i18n.localize("WFC.Clear.Content")}</p>`,
    buttons: [
      { action: "last", label: game.i18n.localize("WFC.Clear.Last"), icon: "fa-solid fa-rotate-left", default: true },
      { action: "all", label: game.i18n.localize("WFC.Clear.All"), icon: "fa-solid fa-trash" },
      { action: "cancel", label: game.i18n.localize("WFC.Clear.Cancel"), icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if (choice === "last" || choice === "all") await clearGenerated(choice);
}

/* -------------------------------------------- */
/*  Scene controls                              */
/* -------------------------------------------- */

const nameOf = value => (typeof value === "string" ? value : value?.name ?? null);

function getActiveControl() {
  return nameOf(ui.controls?.control) ?? ui.controls?.activeControl ?? null;
}

function getActiveTool() {
  return nameOf(ui.controls?.tool) ?? ui.controls?.activeTool ?? null;
}

function syncOutlineTool() {
  const active = canvas?.ready && getActiveControl() === "tiles" && getActiveTool() === TOOL_OUTLINE;
  if (active) outlineTool.activate();
  else outlineTool.deactivate();
}

function registerControls(controls) {
  if (!game.user.isGM) return;
  const defs = [
    { name: TOOL_OUTLINE, title: "WFC.Tools.Outline", icon: "fa-solid fa-draw-polygon" },
    { name: TOOL_FROM_DRAWING, title: "WFC.Tools.FromDrawing", icon: "fa-solid fa-vector-square", button: true, handler: generateFromDrawings },
    { name: TOOL_COLLECTIONS, title: "WFC.Tools.Collections", icon: "fa-solid fa-layer-group", button: true, handler: () => CollectionsApp.open() },
    { name: TOOL_CLEAR, title: "WFC.Tools.Clear", icon: "fa-solid fa-eraser", button: true, handler: clearDialog }
  ];

  if (Array.isArray(controls)) {
    // Foundry v12: array of controls, array of tools.
    const tiles = controls.find(c => c.name === "tiles");
    if (!tiles) return;
    for (const def of defs) {
      const tool = { name: def.name, title: def.title, icon: def.icon, visible: true };
      if (def.button) { tool.button = true; tool.onClick = def.handler; }
      tiles.tools.push(tool);
    }
    return;
  }

  // Foundry v13+: record of controls, record of tools with an explicit order.
  const tiles = controls.tiles;
  if (!tiles) return;
  let order = Object.values(tiles.tools).reduce((max, t) => Math.max(max, t.order ?? 0), 0);
  for (const def of defs) {
    const tool = { name: def.name, title: def.title, icon: def.icon, visible: true, order: ++order };
    if (def.button) {
      tool.button = true;
      tool.onChange = () => def.handler();
    } else {
      tool.onChange = () => syncOutlineTool();
    }
    tiles.tools[def.name] = tool;
  }
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  registerSettings();
  console.log(`${MODULE_ID} | initialized`);
});

Hooks.once("ready", () => {
  const module = game.modules.get(MODULE_ID);
  module.api = {
    generateDungeon,
    clearGenerated,
    openCollections: () => CollectionsApp.open(),
    outlineTool,
    wfc,
    geometry
  };
});

Hooks.on("getSceneControlButtons", registerControls);
Hooks.on("renderSceneControls", syncOutlineTool);
Hooks.on("canvasReady", syncOutlineTool);
Hooks.on("canvasTearDown", () => outlineTool.deactivate());
