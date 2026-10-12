import { MODULE_ID, TEMPLATES } from "../constants.js";
import { normalizeTags } from "../lib/wfc.js";
import { getMarkers } from "../markers.js";
import { log } from "../log.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Generation panel. Stays open so the same outline can be generated again with different
 * settings until the user presses Done. Resolves (via `open`) when closed.
 */
export class GenerateDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "wfc-generate",
    classes: ["wfc-app", "wfc-generate"],
    tag: "form",
    window: { title: "WFC.Generate.Title", icon: "fa-solid fa-dungeon" },
    position: { width: 540, height: "auto" },
    form: { handler: GenerateDialog.#onGenerate, submitOnChange: false, closeOnSubmit: false },
    actions: {
      selectAll: GenerateDialog.#onSelectAll,
      selectNone: GenerateDialog.#onSelectNone,
      randomSeed: GenerateDialog.#onRandomSeed,
      copyStatus: GenerateDialog.#onCopyStatus,
      done: GenerateDialog.#onDone
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATES}/generate.hbs` }
  };

  /**
   * Open the panel. `onGenerate(options)` runs a generation and resolves with
   * `{ok, message}`. The returned promise resolves when the panel is closed.
   * @param {{collections: object[], cellCount: number, onGenerate: Function}} data
   * @returns {Promise<void>}
   */
  static open(data) {
    const existing = foundry.applications.instances.get("wfc-generate");
    if (existing) existing.close();
    return new Promise(resolve => {
      new GenerateDialog({ ...data, resolve }).render(true);
    });
  }

  constructor(options) {
    super(options);
    this.collections = options.collections;
    this.cellCount = options.cellCount;
    this.onGenerate = options.onGenerate;
    this.resolve = options.resolve;
    this.running = false;
    this.status = "";
    this.statusOk = true;
    this.runs = 0;
  }

  async _prepareContext() {
    const last = game.settings.get(MODULE_ID, "lastSelection") ?? {};
    const lastDirs = Array.isArray(last.collections) ? last.collections : null;
    const collections = this.collections.map((c, index) => ({
      index,
      dir: c.dir,
      name: c.name,
      count: Object.keys(c.mapping.tiles).length,
      boundary: c.mapping.boundary.join(", "),
      checked: lastDirs ? lastDirs.includes(c.dir) : true
    }));
    const selected = collections.filter(c => c.checked);
    const boundary = last.boundaryTags ?? (selected.find(c => c.boundary)?.boundary ?? collections.find(c => c.boundary)?.boundary ?? "");
    const restrictedDefault = this.collections.map(c => c.mapping.restricted.join(", ")).find(Boolean) ?? "";
    return {
      collections,
      cellCount: this.cellCount,
      markerCount: getMarkers().length,
      seed: foundry.utils.randomID(8),
      newSeed: last.newSeed ?? true,
      boundaryTags: boundary,
      restrictedTags: last.restrictedTags ?? restrictedDefault,
      matchSurroundings: last.matchSurroundings ?? true,
      placeOutlineWalls: last.placeOutlineWalls ?? true,
      placeTileWalls: last.placeTileWalls ?? true,
      clearExisting: last.clearExisting ?? true,
      mergeWalls: last.mergeWalls ?? true,
      status: this.status,
      statusOk: this.statusOk
    };
  }

  _onRender() {
    this.element.addEventListener("change", event => {
      if (!event.target.matches("input[name^='collection-']")) return;
      const boundary = this.element.elements.boundaryTags;
      if (boundary.value.trim()) return;
      const checked = this.#selectedCollections();
      boundary.value = checked.find(c => c.mapping.boundary.length)?.mapping.boundary.join(", ") ?? "";
    });
  }

  #selectedCollections() {
    const inputs = this.element.querySelectorAll("input[name^='collection-']:checked");
    return [...inputs].map(input => this.collections[Number(input.dataset.index)]).filter(Boolean);
  }

  #setStatus(text, ok = true) {
    this.status = text;
    this.statusOk = ok;
    const el = this.element.querySelector("[data-status]");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("wfc-status-error", !ok);
  }

  #setBusy(busy) {
    this.running = busy;
    for (const b of this.element.querySelectorAll("button")) b.disabled = busy;
  }

  static #onSelectAll() {
    this.element.querySelectorAll("input[name^='collection-']").forEach(i => { i.checked = true; });
  }

  static #onSelectNone() {
    this.element.querySelectorAll("input[name^='collection-']").forEach(i => { i.checked = false; });
  }

  static #onRandomSeed() {
    this.element.elements.seed.value = foundry.utils.randomID(8);
  }

  static async #onDone() {
    await this.close();
  }

  static async #onCopyStatus() {
    if (!this.status) return;
    try {
      if (game.clipboard?.copyPlainText) game.clipboard.copyPlainText(this.status);
      else await navigator.clipboard.writeText(this.status);
      ui.notifications.info(game.i18n.localize("WFC.Generate.Copied"));
    } catch (err) {
      log.warn("copy failed", err);
    }
  }

  static async #onGenerate(event, form) {
    if (this.running) return;
    const selected = this.#selectedCollections();
    if (!selected.length) {
      ui.notifications.warn(game.i18n.localize("WFC.Generate.NoneSelected"));
      return;
    }
    const seedInput = form.elements.seed;
    const options = {
      collectionDirs: selected.map(c => c.dir),
      seed: seedInput.value.trim() || foundry.utils.randomID(8),
      boundaryTags: normalizeTags(form.elements.boundaryTags.value),
      restrictedTags: normalizeTags(form.elements.restrictedTags.value),
      matchSurroundings: form.elements.matchSurroundings.checked,
      placeOutlineWalls: form.elements.placeOutlineWalls.checked,
      placeTileWalls: form.elements.placeTileWalls.checked,
      clearExisting: form.elements.clearExisting.checked,
      mergeWalls: form.elements.mergeWalls.checked
    };
    const newSeed = form.elements.newSeed.checked;
    await game.settings.set(MODULE_ID, "lastSelection", {
      collections: options.collectionDirs,
      boundaryTags: form.elements.boundaryTags.value.trim(),
      restrictedTags: form.elements.restrictedTags.value.trim(),
      matchSurroundings: options.matchSurroundings,
      placeOutlineWalls: options.placeOutlineWalls,
      placeTileWalls: options.placeTileWalls,
      clearExisting: options.clearExisting,
      mergeWalls: options.mergeWalls,
      newSeed
    });
    this.#setBusy(true);
    this.#setStatus(game.i18n.localize("WFC.Generate.Running"));
    try {
      const result = await this.onGenerate(options);
      this.runs++;
      this.#setStatus(result?.message ?? "", result?.ok !== false);
      if (newSeed) seedInput.value = foundry.utils.randomID(8);
    } catch (err) {
      log.error("generation failed", err);
      this.#setStatus(err.message, false);
    } finally {
      this.#setBusy(false);
    }
  }

  _onClose(options) {
    super._onClose?.(options);
    if (this.resolve) {
      const resolve = this.resolve;
      this.resolve = null;
      resolve();
    }
  }
}
