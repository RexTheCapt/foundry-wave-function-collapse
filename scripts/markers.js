/**
 * Markers: requirements pinned to specific cell edges or cells of a scene, stored in scene flags.
 *
 * Edge markers may require side tags and door features on that edge. Cell markers require door
 * features inside the tile. This file holds storage, the canvas layer that renders markers and
 * the tool that edits them.
 */

import { MODULE_ID } from "./constants.js";
import { edgeKey, edgeEndpoints, cellMarkerKey, markerTargetAtPoint } from "./lib/edges.js";
import { normalizeTags } from "./lib/wfc.js";
import { log } from "./log.js";

const FLAG_PATH = `flags.${MODULE_ID}.edgeMarkers`;

function normalizeMarker(m) {
  const tags = normalizeTags(m.tags);
  const features = normalizeTags(m.features);
  if (m.kind === "cell") {
    const i = Number(m.i);
    const j = Number(m.j);
    if (!Number.isInteger(i) || !Number.isInteger(j) || !features.length) return null;
    return { kind: "cell", i, j, features };
  }
  const x = Number(m.x);
  const y = Number(m.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || (!tags.length && !features.length)) return null;
  return { kind: "edge", x, y, dir: m.dir === "v" ? "v" : "h", tags, features };
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
 * Set the marker on a target. Empty tags and features remove it.
 * @param {{kind: "edge", x, y, dir}|{kind: "cell", i, j}} target
 * @param {{tags?: string[]|string, features?: string[]|string}} data
 */
export async function setMarker(target, data, scene = canvas.scene) {
  const marker = normalizeMarker({ ...target, tags: data.tags, features: data.features });
  const key = markerKey(target);
  const list = getMarkers(scene).filter(m => markerKey(m) !== key);
  if (marker) list.push(marker);
  await setMarkers(list, scene);
}

export async function clearMarkers(scene = canvas.scene) {
  await setMarkers([], scene);
}

function markerLabel(m) {
  const parts = [];
  if (m.tags?.length) parts.push(m.tags.join(", "));
  if (m.features?.length) parts.push(m.features.map(f => `[${f}]`).join(" "));
  return parts.join(" ");
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

/** Canvas tool that adds, edits and removes markers by clicking on cell edges or cell centers. */
export class MarkerTool {
  constructor({ layer }) {
    this.layer = layer;
    this.active = false;
    this._onPointerDown = this.#onPointerDown.bind(this);
  }

  get view() {
    return canvas.app?.view ?? document.getElementById("board");
  }

  get last() {
    const v = game.settings.get(MODULE_ID, "lastMarker") ?? {};
    return { tags: normalizeTags(v.tags), features: normalizeTags(v.features) };
  }

  activate() {
    if (this.active) return;
    if (!canvas.ready) { log.warn("marker tool: canvas not ready"); return; }
    this.active = true;
    this.view.addEventListener("pointerdown", this._onPointerDown);
    this.layer.show();
    log.debug("marker tool activated");
    ui.notifications.info(game.i18n.localize("WFC.Tools.MarkersHint"));
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.view?.removeEventListener("pointerdown", this._onPointerDown);
    log.debug("marker tool deactivated");
  }

  #toCanvas(event) {
    if (typeof canvas.canvasCoordinatesFromClient === "function") {
      return canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
    }
    const rect = this.view.getBoundingClientRect();
    return canvas.stage.toLocal(new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top));
  }

  async #onPointerDown(event) {
    if (event.button !== 0 && event.button !== 2) return;
    const point = this.#toCanvas(event);
    const target = markerTargetAtPoint(point.x, point.y, canvas.grid.size);
    const existing = getMarkers().find(m => markerKey(m) === markerKey(target));
    log.debug("marker tool click", { button: event.button, target, existing });
    try {
      if (event.button === 2) {
        if (existing) await setMarker(target, {});
        return;
      }
      const last = this.last;
      if (event.shiftKey && !existing) {
        const quick = target.kind === "cell" ? { features: last.features } : last;
        if (quick.features.length || quick.tags?.length) await setMarker(target, quick);
        return;
      }
      const initial = existing ?? (target.kind === "cell" ? { features: last.features } : last);
      const data = await MarkerTool.prompt(target.kind, initial);
      if (!data) return;
      if (data.tags.length || data.features.length) {
        await game.settings.set(MODULE_ID, "lastMarker", { tags: data.tags.join(", "), features: data.features.join(", ") });
      }
      await setMarker(target, data);
    } catch (err) {
      log.error("marker tool failed", err);
      ui.notifications.error(err.message);
    }
  }

  /** Ask for marker contents. Resolves with { tags, features }, or null when cancelled. */
  static async prompt(kind, initial = {}) {
    const esc = v => foundry.utils.escapeHTML(String(v ?? ""));
    const tagsRow = kind === "edge" ? `<div class="form-group">
        <label>${game.i18n.localize("WFC.Markers.Tags")}</label>
        <div class="form-fields"><input type="text" name="tags" value="${esc((initial.tags ?? []).join(", "))}" autofocus></div>
        <p class="hint">${game.i18n.localize("WFC.Markers.TagsHint")}</p></div>` : "";
    const content = `${tagsRow}<div class="form-group">
        <label>${game.i18n.localize("WFC.Markers.Features")}</label>
        <div class="form-fields"><input type="text" name="features" value="${esc((initial.features ?? []).join(", "))}" ${kind === "cell" ? "autofocus" : ""}></div>
        <p class="hint">${game.i18n.localize(kind === "cell" ? "WFC.Markers.CellFeaturesHint" : "WFC.Markers.FeaturesHint")}</p></div>
      <p class="hint">${game.i18n.localize("WFC.Markers.EmptyHint")}</p>`;
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize(kind === "cell" ? "WFC.Markers.CellTitle" : "WFC.Markers.EdgeTitle"), icon: "fa-solid fa-door-open" },
      content,
      ok: {
        label: game.i18n.localize("WFC.Markers.Set"),
        icon: "fa-solid fa-check",
        callback: (event, button) => ({
          tags: button.form.elements.tags?.value ?? "",
          features: button.form.elements.features?.value ?? ""
        })
      },
      rejectClose: false
    });
    if (!result) return null;
    return { tags: normalizeTags(result.tags), features: normalizeTags(result.features) };
  }
}
