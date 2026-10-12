import { MODULE_ID, SAMPLE_COLLECTION, TOOL_OUTLINE, TOOL_MARKERS, TOOL_AREAS, TOOL_PICKER, TOOL_FROM_DRAWING, TOOL_COLLECTIONS, TOOL_CLEAR } from "./constants.js";
import { PickerTool } from "./picker.js";
import { addZone, removeZoneAt, clearZones, getZones, getEmptyAreas, promptZone } from "./zones.js";
import { MarkerLayer, MarkerTool, clearMarkers, getMarkers } from "./markers.js";
import { OutlineTool } from "./outline-tool.js";
import { log } from "./log.js";
import { assertSquareGrid, clearGenerated, generateDungeon, candidatesForCell, placeTileAt } from "./generator.js";
import { getRegisteredDirs, loadCollections } from "./collections.js";
import { cellsInPolygonExcluding, drawingToPolygon } from "./lib/geometry.js";
import * as wfc from "./lib/wfc.js";
import * as geometry from "./lib/geometry.js";
import { CollectionsApp } from "./apps/collections-app.js";
import { GenerateDialog } from "./apps/generate-dialog.js";

const outlineTool = new OutlineTool({ onFinish: polygon => generateForPolygons([polygon]) });
const markerLayer = new MarkerLayer();
const markerTool = new MarkerTool({ layer: markerLayer });
const pickerTool = new PickerTool();
const zoneTool = new OutlineTool({
  color: 0x3ddc84,
  fill: 0x3ddc84,
  hint: "WFC.Tools.ZonesHint",
  highlightCells: false,
  onFinish: async polygon => {
    const zone = await promptZone(polygon);
    if (!zone) return;
    await addZone(zone);
    ui.notifications.info(game.i18n.localize(zone.type === "empty" ? "WFC.Zones.AddedEmpty" : "WFC.Zones.AddedOpen"));
  },
  onRightClickIdle: async point => {
    if (await removeZoneAt(point.x, point.y)) ui.notifications.info(game.i18n.localize("WFC.Zones.Removed"));
  }
});

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
  game.settings.register(MODULE_ID, "debug", {
    name: "WFC.Settings.Debug.Name",
    hint: "WFC.Settings.Debug.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, "lastZone", {
    scope: "client",
    config: false,
    type: Object,
    default: { type: "open", tags: "floor", border: "wall" }
  });
  game.settings.register(MODULE_ID, "lastMarker", {
    scope: "client",
    config: false,
    type: Object,
    default: { tags: "", features: "door" }
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
  log.debug("generateForPolygons", { polygons });
  try {
    assertSquareGrid();
  } catch (err) {
    log.warn("cannot generate:", err.message);
    ui.notifications.error(err.message);
    return;
  }
  const size = canvas.grid.size;
  const areas = getEmptyAreas();
  const cellCount = polygons.reduce((n, p) => n + cellsInPolygonExcluding(p, areas, size).cells.length, 0);
  log.debug(`grid size ${size}, ${cellCount} cells inside ${polygons.length} polygon(s) after excluding ${areas.length} empty areas`);
  if (!cellCount) {
    ui.notifications.warn(game.i18n.localize("WFC.Generate.NoCells"));
    return;
  }
  const registered = getRegisteredDirs();
  const loaded = await loadCollections(registered);
  log.debug("registered collections", registered, loaded.map(c => ({ dir: c.dir, name: c.name, tiles: Object.keys(c.mapping.tiles).length, hasMapping: c.hasMapping, error: c.error })));
  const collections = loaded.filter(c => Object.keys(c.mapping.tiles).length);
  if (!collections.length) {
    log.warn("no usable collections");
    ui.notifications.warn(game.i18n.localize("WFC.Generate.NoCollections"));
    CollectionsApp.open();
    return;
  }
  log.debug("opening generate panel");
  await GenerateDialog.open({
    collections,
    cellCount,
    onGenerate: async options => {
      log.debug("generate requested", options);
      const results = [];
      for (const polygon of polygons) results.push(await generateDungeon({ polygon, ...options }));
      const failed = results.find(r => !r.ok);
      if (failed) return failed;
      const tiles = results.reduce((n, r) => n + (r.tiles ?? 0), 0);
      const walls = results.reduce((n, r) => n + (r.walls ?? 0), 0);
      return { ok: true, message: game.i18n.format("WFC.Generate.Placed", { tiles, walls, seed: options.seed }) };
    }
  });
  log.debug("generate panel closed");
}

async function generateFromDrawings() {
  const docs = (canvas.drawings?.controlled ?? []).map(d => d.document);
  log.debug("generateFromDrawings: controlled drawings", docs.map(d => ({ id: d.id, type: d.shape?.type, x: d.x, y: d.y, rotation: d.rotation })));
  const polygons = docs.map(drawingToPolygon).filter(p => p && p.length >= 3);
  if (!polygons.length) {
    ui.notifications.warn(game.i18n.localize("WFC.Errors.NoDrawing"));
    return;
  }
  await generateForPolygons(polygons);
}

async function clearDialog() {
  log.debug("clearDialog");
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
      { action: "markers", label: game.i18n.format("WFC.Clear.Markers", { count: getMarkers().length }), icon: "fa-solid fa-door-open" },
      { action: "zones", label: game.i18n.format("WFC.Clear.Zones", { count: getZones().length }), icon: "fa-solid fa-vector-square" },
      { action: "cancel", label: game.i18n.localize("WFC.Clear.Cancel"), icon: "fa-solid fa-xmark" }
    ],
    rejectClose: false
  });
  if (choice === "last" || choice === "all") await clearGenerated(choice);
  else if (choice === "markers") {
    await clearMarkers();
    ui.notifications.info(game.i18n.localize("WFC.Clear.MarkersDone"));
  } else if (choice === "zones") {
    await clearZones();
    ui.notifications.info(game.i18n.localize("WFC.Clear.ZonesDone"));
  }
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

const TOOLS = { [TOOL_OUTLINE]: () => outlineTool, [TOOL_MARKERS]: () => markerTool, [TOOL_AREAS]: () => zoneTool, [TOOL_PICKER]: () => pickerTool };

function syncOutlineTool() {
  const control = getActiveControl();
  const tool = getActiveTool();
  const onTiles = canvas?.ready && control === "tiles";
  log.debug(`syncTools: control=${control} tool=${tool} canvasReady=${canvas?.ready}`);
  for (const [name, get] of Object.entries(TOOLS)) {
    if (onTiles && tool === name) get().activate();
    else get().deactivate();
  }
  if (onTiles) markerLayer.show();
  else markerLayer.hide();
}

function registerControls(controls) {
  if (!game.user.isGM) return;
  const tileTools = [
    { name: TOOL_OUTLINE, title: "WFC.Tools.Outline", icon: "fa-solid fa-draw-polygon" },
    { name: TOOL_MARKERS, title: "WFC.Tools.Markers", icon: "fa-solid fa-door-open" },
    { name: TOOL_AREAS, title: "WFC.Tools.Zones", icon: "fa-solid fa-vector-square" },
    { name: TOOL_PICKER, title: "WFC.Tools.Picker", icon: "fa-solid fa-hand-pointer" },
    { name: TOOL_COLLECTIONS, title: "WFC.Tools.Collections", icon: "fa-solid fa-layer-group", button: true, handler: () => CollectionsApp.open() },
    { name: TOOL_CLEAR, title: "WFC.Tools.Clear", icon: "fa-solid fa-eraser", button: true, handler: clearDialog }
  ];
  // Lives in the Drawings group so the drawing selection is still intact when it is clicked.
  const drawingTools = [
    { name: TOOL_FROM_DRAWING, title: "WFC.Tools.FromDrawing", icon: "fa-solid fa-dungeon", button: true, handler: generateFromDrawings }
  ];

  if (Array.isArray(controls)) {
    // Foundry v12: array of controls, array of tools. Tool changes re-render the controls,
    // so the renderSceneControls hook keeps the outline tool in sync.
    log.debug("registering scene controls (v12 array API)");
    const add = (controlName, defs) => {
      const control = controls.find(c => c.name === controlName);
      if (!control) { log.warn(`control group "${controlName}" not found`); return; }
      for (const def of defs) {
        const tool = { name: def.name, title: def.title, icon: def.icon, visible: true };
        if (def.button) { tool.button = true; tool.onClick = def.handler; }
        control.tools.push(tool);
      }
    };
    add("tiles", tileTools);
    add("drawings", drawingTools);
    return;
  }

  // Foundry v13+: record of controls, record of tools with an explicit order. Activating a tool
  // does not re-render the controls, so the tool's own onChange callback drives activation.
  log.debug("registering scene controls (v13+ record API); groups:", Object.keys(controls));
  const add = (controlName, defs) => {
    const control = controls[controlName];
    if (!control) { log.warn(`control group "${controlName}" not found`); return; }
    let order = Object.values(control.tools ?? {}).reduce((max, t) => Math.max(max, t.order ?? 0), 0);
    for (const def of defs) {
      const tool = { name: def.name, title: def.title, icon: def.icon, visible: true, order: ++order };
      if (def.button) {
        tool.button = true;
        tool.onChange = event => {
          log.debug(`button "${def.name}" clicked`);
          def.handler(event);
        };
      } else {
        // v14 flags: this tool neither selects nor creates placeables.
        tool.interaction = false;
        tool.control = false;
        tool.creation = false;
        tool.onChange = (event, active) => {
          log.debug(`tool "${def.name}" onChange active=${active}`);
          const instance = TOOLS[def.name]();
          if (active) instance.activate();
          else instance.deactivate();
        };
      }
      control.tools[def.name] = tool;
      log.debug(`added tool "${def.name}" to "${controlName}" (order ${tool.order})`);
    }
  };
  add("tiles", tileTools);
  add("drawings", drawingTools);
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  registerSettings();
  log.info(`initialized (Foundry ${game.version}, module ${game.modules.get(MODULE_ID)?.version})`);
});

Hooks.once("ready", () => {
  const module = game.modules.get(MODULE_ID);
  module.api = {
    generateDungeon,
    clearGenerated,
    openCollections: () => CollectionsApp.open(),
    outlineTool,
    markerTool,
    getMarkers,
    clearMarkers,
    getZones,
    clearZones,
    getEmptyAreas,
    candidatesForCell,
    placeTileAt,
    wfc,
    geometry
  };
  log.debug("ready; registered collection directories:", getRegisteredDirs());
});

Hooks.on("getSceneControlButtons", registerControls);
Hooks.on("renderSceneControls", syncOutlineTool);
Hooks.on("canvasReady", syncOutlineTool);
Hooks.on("activateTilesLayer", () => { log.debug("activateTilesLayer"); syncOutlineTool(); });
const deactivateAll = () => { for (const get of Object.values(TOOLS)) get().deactivate(); markerLayer.hide(); };
Hooks.on("deactivateTilesLayer", () => { log.debug("deactivateTilesLayer"); deactivateAll(); });
Hooks.on("canvasTearDown", () => { log.debug("canvasTearDown"); deactivateAll(); });
Hooks.on("updateScene", (scene, changes) => {
  if (scene.id !== canvas.scene?.id) return;
  if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) || foundry.utils.hasProperty(changes, `flags.-=${MODULE_ID}`)) {
    log.debug("scene markers changed, redrawing");
    markerLayer.refresh();
  }
});
