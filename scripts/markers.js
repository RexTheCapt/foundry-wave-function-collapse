/**
 * Markers: requirements pinned to specific cell edges or cells of a scene, stored in scene flags.
 *
 * Edge markers may require side tags and door features on that edge. Cell markers require door
 * features inside the tile. This file holds storage, the canvas layer that renders markers and
 * the tool that edits them.
 */

import { MODULE_ID } from "./constants.js";
import { edgeKey, edgeEndpoints, cellMarkerKey, markerTargetAtPoint, edgesAlongLine } from "./lib/edges.js";
import { normalizeTags } from "./lib/wfc.js";
import { log } from "./log.js";

const FLAG_PATH = `flags.${MODULE_ID}.edgeMarkers`;

function normalizeMarker(m) {
  // Older markers stored separate tags and features; both are plain requirements now.
  const requirements = normalizeTags([...(m.requirements ?? []), ...(m.tags ?? []), ...(m.features ?? [])]);
  if (!requirements.length) return null;
  if (m.kind === "cell") {
    const i = Number(m.i);
    const j = Number(m.j);
    if (!Number.isInteger(i) || !Number.isInteger(j)) return null;
    return { kind: "cell", i, j, requirements };
  }
  const x = Number(m.x);
  const y = Number(m.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { kind: "edge", x, y, dir: m.dir === "v" ? "v" : "h", requirements };
}

export function markerKey(m) {
  return m.kind === "cell" ? cellMarkerKey(m) : edgeKey(m);
}

/** Markers stored on a scene. */
export function getMarkers(scene = canvas.scene) {
  const list = scene?.flags?.[MODULE_ID]?.edgeMarkers;
  if (!Array.isArray(list)) return [];
  return list.map(normalizeMarker).filter(Boolean);
}

export async function setMarkers(markers, scene = canvas.scene) {
  log.debug(`saving ${markers.length} markers on scene ${scene?.id}`);
  await scene.update({ [FLAG_PATH]: markers });
}

/**
 * Set the marker on a target. Empty requirements remove it.
 * @param {{kind: "edge", x, y, dir}|{kind: "cell", i, j}} target
 * @param {string[]|string} requirements
 */
export async function setMarker(target, requirements, scene = canvas.scene) {
  const marker = normalizeMarker({ ...target, requirements: normalizeTags(requirements) });
  const key = markerKey(target);
  const list = getMarkers(scene).filter(m => markerKey(m) !== key);
  if (marker) list.push(marker);
  await setMarkers(list, scene);
}

export async function clearMarkers(scene = canvas.scene) {
  await setMarkers([], scene);
}

function markerLabel(m) {
  return m.requirements.join(", ");
}

/** Draws the markers of the current scene on the canvas. */
export class MarkerLayer {
  constructor() {
    this.container = null;
    this.visible = false;
  }

  show() {
    this.visible = true;
    this.refresh();
  }

  hide() {
    this.visible = false;
    this.#destroy();
  }

  #destroy() {
    this.container?.destroy({ children: true });
    this.container = null;
  }

  refresh() {
    this.#destroy();
    if (!this.visible || !canvas.ready) return;
    const markers = getMarkers();
    const size = canvas.grid.size;
    const container = new PIXI.Container();
    container.zIndex = 9000;
    container.eventMode = "none";
    const g = new PIXI.Graphics();
    container.addChild(g);
    const style = {
      fontFamily: "Signika, sans-serif",
      fontSize: Math.max(12, size * 0.16),
      fill: 0xffffff,
      stroke: 0x000000,
      strokeThickness: 3
    };
    for (const m of markers) {
      let cx;
      let cy;
      if (m.kind === "cell") {
        cx = (m.j + 0.5) * size;
        cy = (m.i + 0.5) * size;
        g.lineStyle(Math.max(3, size * 0.05), 0x3ddc84, 0.9);
        g.beginFill(0x3ddc84, 0.15);
        g.drawCircle(cx, cy, size * 0.3);
        g.endFill();
      } else {
        const [x1, y1, x2, y2] = edgeEndpoints(m, size);
        g.lineStyle(Math.max(4, size * 0.08), 0x3ddc84, 0.9);
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        cx = (x1 + x2) / 2;
        cy = (y1 + y2) / 2;
      }
      const label = new PIXI.Text(markerLabel(m), style);
      label.anchor.set(0.5);
      label.position.set(cx, cy);
      label.resolution = 2;
      container.addChild(label);
    }
    const parent = canvas.controls ?? canvas.interface ?? canvas.stage;
    parent.addChild(container);
    this.container = container;
    log.debug(`marker layer drew ${markers.length} markers`);
  }
}

/**
 * Canvas tool that adds, edits and removes markers. Click a cell edge or a cell center for a
 * single marker; press on an edge and drag along its grid line to mark every edge on the line.
 */
export class MarkerTool {
  constructor({ layer }) {
    this.layer = layer;
    this.active = false;
    this.drag = null;
    this.preview = null;
    this._onPointerDown = this.#onPointerDown.bind(this);
    this._onPointerMove = this.#onPointerMove.bind(this);
    this._onPointerUp = this.#onPointerUp.bind(this);
  }

  get view() {
    return canvas.app?.view ?? document.getElementById("board");
  }

  get last() {
    const v = game.settings.get(MODULE_ID, "lastMarker") ?? {};
    return normalizeTags([...(normalizeTags(v.requirements)), ...normalizeTags(v.tags), ...normalizeTags(v.features)]);
  }

  activate() {
    if (this.active) return;
    if (!canvas.ready) { log.warn("marker tool: canvas not ready"); return; }
    this.active = true;
    const view = this.view;
    view.addEventListener("pointerdown", this._onPointerDown);
    view.addEventListener("pointermove", this._onPointerMove);
    window.addEventListener("pointerup", this._onPointerUp);
    this.layer.show();
    log.debug("marker tool activated");
    ui.notifications.info(game.i18n.localize("WFC.Tools.MarkersHint"));
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    const view = this.view;
    view?.removeEventListener("pointerdown", this._onPointerDown);
    view?.removeEventListener("pointermove", this._onPointerMove);
    window.removeEventListener("pointerup", this._onPointerUp);
    this.drag = null;
    this.#clearPreview();
    log.debug("marker tool deactivated");
  }

  #toCanvas(event) {
    if (typeof canvas.canvasCoordinatesFromClient === "function") {
      return canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
    }
    const rect = this.view.getBoundingClientRect();
    return canvas.stage.toLocal(new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top));
  }

  #targetAt(event) {
    const point = this.#toCanvas(event);
    return markerTargetAtPoint(point.x, point.y, canvas.grid.size);
  }

  #onPointerDown(event) {
    if (event.button !== 0 && event.button !== 2) return;
    const target = this.#targetAt(event);
    this.drag = { button: event.button, shift: event.shiftKey, start: target, current: target, clientX: event.clientX, clientY: event.clientY };
    log.debug("marker tool press", target);
  }

  #onPointerMove(event) {
    if (!this.drag || this.drag.start.kind !== "edge") return;
    const target = this.#targetAt(event);
    this.drag.current = target;
    const edges = edgesAlongLine(this.drag.start, target, canvas.grid.size);
    this.#drawPreview(edges, this.drag.button === 2);
  }

  async #onPointerUp(event) {
    const drag = this.drag;
    if (!drag || event.button !== drag.button) return;
    this.drag = null;
    this.#clearPreview();
    const moved = Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) > 6;
    let targets;
    if (moved && drag.start.kind === "edge") {
      const end = this.#targetAt(event);
      targets = edgesAlongLine(drag.start, end, canvas.grid.size).map(e => ({ kind: "edge", ...e }));
      if (!targets.length) return;
    } else {
      targets = [drag.start];
    }
    log.debug(`marker tool release: ${targets.length} target(s), button ${drag.button}`, targets);
    try {
      const markers = getMarkers();
      const existingFor = t => markers.find(m => markerKey(m) === markerKey(t));
      if (drag.button === 2) {
        const keys = new Set(targets.map(markerKey));
        if (markers.some(m => keys.has(markerKey(m)))) await setMarkers(markers.filter(m => !keys.has(markerKey(m))));
        return;
      }
      const single = targets.length === 1 ? targets[0] : null;
      const existing = single ? existingFor(single) : null;
      const kind = targets[0].kind;
      let requirements;
      if (drag.shift && !existing) {
        requirements = this.last;
        if (!requirements.length) return;
      } else {
        requirements = await MarkerTool.prompt(kind, existing?.requirements ?? this.last);
        if (requirements === null) return;
        if (requirements.length) await game.settings.set(MODULE_ID, "lastMarker", { requirements: requirements.join(", ") });
      }
      const keys = new Set(targets.map(markerKey));
      const kept = markers.filter(m => !keys.has(markerKey(m)));
      const added = requirements.length ? targets.map(t => ({ ...t, requirements })) : [];
      await setMarkers([...kept, ...added]);
    } catch (err) {
      log.error("marker tool failed", err);
      ui.notifications.error(err.message);
    }
  }

  #drawPreview(edges, removing) {
    this.#clearPreview();
    if (!edges.length) return;
    const g = new PIXI.Graphics();
    g.zIndex = 9500;
    g.eventMode = "none";
    const size = canvas.grid.size;
    g.lineStyle(Math.max(4, size * 0.08), removing ? 0xff5555 : 0xffd166, 0.8);
    for (const e of edges) {
      const [x1, y1, x2, y2] = edgeEndpoints(e, size);
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
    }
    (canvas.controls ?? canvas.interface ?? canvas.stage).addChild(g);
    this.preview = g;
  }

  #clearPreview() {
    this.preview?.destroy();
    this.preview = null;
  }

  /** Ask for marker requirements. Resolves with a normalized list, or null when cancelled. */
  static async prompt(kind, initial = []) {
    const esc = v => foundry.utils.escapeHTML(String(v ?? ""));
    const cell = kind === "cell";
    const content = `<div class="form-group">
        <label>${game.i18n.localize(cell ? "WFC.Markers.CellRequirements" : "WFC.Markers.Requirements")}</label>
        <div class="form-fields"><input type="text" name="requirements" value="${esc(initial.join(", "))}" placeholder="${cell ? "door" : "wall"}" autofocus></div>
        <p class="hint">${game.i18n.localize(cell ? "WFC.Markers.CellRequirementsHint" : "WFC.Markers.RequirementsHint")}</p></div>
      <p class="hint">${game.i18n.localize("WFC.Markers.EmptyHint")}</p>`;
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize(cell ? "WFC.Markers.CellTitle" : "WFC.Markers.EdgeTitle"), icon: "fa-solid fa-draw-polygon" },
      content,
      ok: {
        label: game.i18n.localize("WFC.Markers.Set"),
        icon: "fa-solid fa-check",
        callback: (event, button) => button.form.elements.requirements.value
      },
      rejectClose: false
    });
    if (result === null || result === undefined) return null;
    return normalizeTags(result);
  }
}
