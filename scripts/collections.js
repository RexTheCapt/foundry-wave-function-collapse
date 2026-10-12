/**
 * Loading, saving and registering tile collections.
 *
 * A collection is a directory in the Foundry user data folder that contains tile images and a
 * mapping.json describing the side tags and walls of every tile in that directory.
 */

import { MODULE_ID, MAPPING_FILE, IMAGE_EXTENSIONS } from "./constants.js";
import { emptyMapping, normalizeMapping } from "./lib/mapping.js";
import { normalizeTile } from "./lib/wfc.js";
import { log } from "./log.js";

/** FilePicker class that works on v12 (global) and v13+ (namespaced). */
export function getFilePicker() {
  return foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
}

export function basename(path) {
  const clean = String(path).replace(/\/+$/, "");
  return clean.slice(clean.lastIndexOf("/") + 1);
}

export function cleanDir(path) {
  return String(path ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function encodePath(path) {
  return path.split("/").map(part => {
    try { return encodeURIComponent(decodeURIComponent(part)); }
    catch { return encodeURIComponent(part); }
  }).join("/");
}

export function isImageFile(path) {
  const ext = basename(path).split(".").pop()?.toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

/** Registered collection directories (world setting). */
export function getRegisteredDirs() {
  const dirs = game.settings.get(MODULE_ID, "collections");
  return Array.isArray(dirs) ? dirs.map(cleanDir).filter(Boolean) : [];
}

export async function registerDir(dir) {
  dir = cleanDir(dir);
  const dirs = getRegisteredDirs();
  if (dirs.includes(dir)) return false;
  dirs.push(dir);
  await game.settings.set(MODULE_ID, "collections", dirs);
  return true;
}

export async function unregisterDir(dir) {
  dir = cleanDir(dir);
  const dirs = getRegisteredDirs().filter(d => d !== dir);
  await game.settings.set(MODULE_ID, "collections", dirs);
}

/**
 * Load a collection from its directory.
 * @param {string} dir
 * @returns {Promise<{dir: string, name: string, mapping: object, hasMapping: boolean, error: string|null}>}
 */
export async function loadCollection(dir) {
  dir = cleanDir(dir);
  const fallbackName = basename(dir);
  const result = { dir, name: fallbackName, mapping: emptyMapping(fallbackName), hasMapping: false, error: null };
  try {
    const response = await fetch(`${encodePath(dir)}/${MAPPING_FILE}`, { cache: "no-store" });
    if (response.ok) {
      const json = await response.json();
      result.mapping = normalizeMapping(json, fallbackName);
      result.hasMapping = true;
    } else if (response.status !== 404) {
      result.error = `${response.status} ${response.statusText}`;
    }
  } catch (err) {
    result.error = err.message;
  }
  result.name = result.mapping.name || fallbackName;
  log.debug(`loaded collection ${dir}`, { name: result.name, hasMapping: result.hasMapping, tiles: Object.keys(result.mapping.tiles).length, error: result.error });
  return result;
}

export async function loadCollections(dirs = getRegisteredDirs()) {
  return Promise.all(dirs.map(loadCollection));
}

async function ensureDirectory(dir) {
  const FP = getFilePicker();
  const parts = cleanDir(dir).split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    try {
      await FP.createDirectory("data", current);
    } catch (err) {
      const message = String(err?.message ?? err);
      if (!message.includes("EEXIST") && !message.includes("already exists")) throw err;
    }
  }
}

/** Write mapping.json into the collection directory. */
export async function saveMapping(dir, mapping) {
  dir = cleanDir(dir);
  const FP = getFilePicker();
  const normalized = normalizeMapping(mapping, basename(dir));
  const file = new File([JSON.stringify(normalized, null, 2)], MAPPING_FILE, { type: "application/json" });
  log.debug(`saving ${MAPPING_FILE} to ${dir}`);
  const response = await FP.upload("data", dir, file, {}, { notify: false });
  log.debug("upload response", response);
  if (!response || response.status === "error" || response.error) {
    throw new Error(response?.error ?? response?.message ?? "upload failed");
  }
  return normalized;
}

/** Create a new, empty collection directory under the configured root and register it. */
export async function createCollection(name) {
  const root = cleanDir(game.settings.get(MODULE_ID, "collectionsRoot"));
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "collection";
  const dir = `${root}/${slug}`;
  log.debug(`creating collection "${name}" at ${dir}`);
  await ensureDirectory(dir);
  const mapping = emptyMapping(name.trim());
  await saveMapping(dir, mapping);
  await registerDir(dir);
  return dir;
}

/** Image files in the directory, as file names relative to the directory. */
export async function listImageFiles(dir) {
  const FP = getFilePicker();
  const result = await FP.browse("data", cleanDir(dir));
  return (result?.files ?? []).filter(isImageFile).map(f => {
    let name = basename(f);
    try { name = decodeURIComponent(name); } catch { /* keep as is */ }
    return name;
  });
}

/** Build solver tiles from a loaded collection. */
export function collectionTiles(collection) {
  return Object.entries(collection.mapping.tiles).map(([file, entry]) => normalizeTile({
    ...entry,
    id: `${collection.dir}/${file}`,
    src: `${collection.dir}/${file}`
  }));
}

/** Resolve a picked image path to a file name inside the collection directory, or null. */
export function relativeTileFile(dir, path) {
  const d = cleanDir(dir);
  const p = cleanDir(path);
  let decoded = p;
  try { decoded = decodeURIComponent(p); } catch { /* ignore */ }
  for (const candidate of [p, decoded]) {
    if (candidate.startsWith(`${d}/`)) {
      const rest = candidate.slice(d.length + 1);
      if (rest && !rest.includes("/")) return rest;
    }
  }
  return null;
}
