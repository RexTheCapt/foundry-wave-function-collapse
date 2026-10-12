/**
 * Empty areas: polygons stored on the scene whose cells are left blank by the generator and
 * treated as outside, with edge markers taking priority on the edges towards them.
 */

import { MODULE_ID } from "./constants.js";
import { pointInPolygon } from "./lib/geometry.js";
import { log } from "./log.js";

const FLAG_PATH = `flags.${MODULE_ID}.emptyAreas`;

/** Empty areas stored on a scene, as arrays of [x, y] points. */
export function getEmptyAreas(scene = canvas.scene) {
  const list = scene?.flags?.[MODULE_ID]?.emptyAreas;
  if (!Array.isArray(list)) return [];
  return list
    .map(poly => (Array.isArray(poly) ? poly.map(pt => [Number(pt[0]), Number(pt[1])]).filter(pt => pt.every(Number.isFinite)) : []))
    .filter(poly => poly.length >= 3);
}

export async function setEmptyAreas(areas, scene = canvas.scene) {
  log.debug(`saving ${areas.length} empty areas on scene ${scene?.id}`);
  await scene.update({ [FLAG_PATH]: areas });
}

export async function addEmptyArea(polygon, scene = canvas.scene) {
  await setEmptyAreas([...getEmptyAreas(scene), polygon], scene);
}

/** Remove the empty area containing the point. Returns whether one was removed. */
export async function removeEmptyAreaAt(x, y, scene = canvas.scene) {
  const areas = getEmptyAreas(scene);
  const kept = areas.filter(a => !pointInPolygon(x, y, a));
  if (kept.length === areas.length) return false;
  await setEmptyAreas(kept, scene);
  return true;
}

export async function clearEmptyAreas(scene = canvas.scene) {
  await setEmptyAreas([], scene);
}
