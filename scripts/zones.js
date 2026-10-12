/**
 * Zones stored on the scene: no-tile zones that stay blank and floor-only zones that become one
 * open room. Edge markers take priority on their borders.
 */

import { MODULE_ID } from "./constants.js";
import { pointInPolygon } from "./lib/geometry.js";
import { normalizeTags } from "./lib/wfc.js";
import { log } from "./log.js";

const FLAG_PATH = `flags.${MODULE_ID}.zones`;

function normalizeZone(raw) {
  const polygon = Array.isArray(raw?.polygon)
    ? raw.polygon.map(pt => [Number(pt[0]), Number(pt[1])]).filter(pt => pt.every(Number.isFinite))
    : [];
  if (polygon.length < 3) return null;
  const type = raw.type === "open" ? "open" : "empty";
  const border = normalizeTags(raw.border);
  // Zones saved by 0.6.0 stored "open tags" instead of forbidden tags: forbid the border and doors.
  const forbid = raw.forbid !== undefined ? normalizeTags(raw.forbid) : normalizeTags([...border, "door"]);
  return { type, polygon, forbid, border };
}

/** Zones stored on a scene. Legacy empty areas are read as empty zones. */
export function getZones(scene = canvas.scene) {
  const flags = scene?.flags?.[MODULE_ID] ?? {};
  const list = Array.isArray(flags.zones) ? flags.zones : [];
  const legacy = Array.isArray(flags.emptyAreas) ? flags.emptyAreas.map(polygon => ({ type: "empty", polygon })) : [];
  return [...legacy, ...list].map(normalizeZone).filter(Boolean);
}

/** Polygons of the no-tile zones. */
export function getEmptyAreas(scene = canvas.scene) {
  return getZones(scene).filter(z => z.type === "empty").map(z => z.polygon);
}

export async function setZones(zones, scene = canvas.scene) {
  log.debug(`saving ${zones.length} zones on scene ${scene?.id}`);
  await scene.update({ [FLAG_PATH]: zones, [`flags.${MODULE_ID}.-=emptyAreas`]: null });
}

export async function addZone(zone, scene = canvas.scene) {
  const normalized = normalizeZone(zone);
  if (!normalized) return;
  await setZones([...getZones(scene), normalized], scene);
}

/** Remove the zone containing the point. Returns whether one was removed. */
export async function removeZoneAt(x, y, scene = canvas.scene) {
  const zones = getZones(scene);
  const kept = zones.filter(z => !pointInPolygon(x, y, z.polygon));
  if (kept.length === zones.length) return false;
  await setZones(kept, scene);
  return true;
}

export async function clearZones(scene = canvas.scene) {
  await setZones([], scene);
}

/**
 * Ask what kind of zone a freshly drawn polygon is. Resolves with the zone or null.
 * @param {number[][]} polygon
 */
export async function promptZone(polygon) {
  const last = game.settings.get(MODULE_ID, "lastZone") ?? {};
  const esc = v => foundry.utils.escapeHTML(String(v ?? ""));
  const selected = t => (last.type ?? "open") === t ? "selected" : "";
  const content = `<div class="form-group">
      <label>${game.i18n.localize("WFC.Zones.Type")}</label>
      <div class="form-fields"><select name="type">
        <option value="open" ${selected("open")}>${game.i18n.localize("WFC.Zones.Open")}</option>
        <option value="empty" ${selected("empty")}>${game.i18n.localize("WFC.Zones.Empty")}</option>
      </select></div>
      <p class="hint">${game.i18n.localize("WFC.Zones.TypeHint")}</p></div>
    <div class="form-group">
      <label>${game.i18n.localize("WFC.Zones.Border")}</label>
      <div class="form-fields"><input type="text" name="border" value="${esc(last.border ?? "wall")}" placeholder="wall"></div>
      <p class="hint">${game.i18n.localize("WFC.Zones.BorderHint")}</p></div>
    <div class="form-group">
      <label>${game.i18n.localize("WFC.Zones.Forbid")}</label>
      <div class="form-fields"><input type="text" name="forbid" value="${esc(last.forbid ?? "wall, door")}" placeholder="wall, door"></div>
      <p class="hint">${game.i18n.localize("WFC.Zones.ForbidHint")}</p></div>`;
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("WFC.Zones.Title"), icon: "fa-solid fa-vector-square" },
    content,
    ok: {
      label: game.i18n.localize("WFC.Zones.Create"),
      icon: "fa-solid fa-check",
      callback: (event, button) => ({
        type: button.form.elements.type.value,
        forbid: button.form.elements.forbid.value,
        border: button.form.elements.border.value
      })
    },
    rejectClose: false
  });
  if (!result) return null;
  await game.settings.set(MODULE_ID, "lastZone", result);
  return { type: result.type, polygon, forbid: normalizeTags(result.forbid), border: normalizeTags(result.border) };
}
