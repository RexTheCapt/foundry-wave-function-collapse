import { MODULE_ID, TEMPLATES } from "../constants.js";
import { normalizeTags } from "../lib/wfc.js";
import { getMarkers } from "../markers.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Asks which collections to use and how to generate. Resolves with the chosen options or null.
 */
export class GenerateDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "wfc-generate",
    classes: ["wfc-app", "wfc-generate"],
    tag: "form",
    window: { title: "WFC.Generate.Title", icon: "fa-solid fa-dungeon" },
    position: { width: 520, height: "auto" },
    form: { handler: GenerateDialog.#onSubmit, submitOnChange: false, closeOnSubmit: false },
    actions: {
      selectAll: GenerateDialog.#onSelectAll,
      selectNone: GenerateDialog.#onSelectNone,
      randomSeed: GenerateDialog.#onRandomSeed,
      cancel: GenerateDialog.#onCancel
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATES}/generate.hbs` }
  };

  /**
   * @param {{collections: object[], cellCount: number}} data
   * @returns {Promise<object|null>}
   */
  static show(data) {
    return new Promise(resolve => {
      new GenerateDialog({ ...data, resolve }).render(true);
    });
  }

  constructor(options) {
    super(options);
    this.collections = options.collections;
    this.cellCount = options.cellCount;
    this.resolve = options.resolve;
    this.resolved = false;
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
    const markers = getMarkers();
    return {
      collections,
      cellCount: this.cellCount,
      markerCount: markers.length,
      seed: foundry.utils.randomID(8),
      boundaryTags: boundary,
      restrictedTags: last.restrictedTags ?? restrictedDefault,
      matchSurroundings: last.matchSurroundings ?? true,
      placeOutlineWalls: last.placeOutlineWalls ?? true,
      placeTileWalls: last.placeTileWalls ?? true,
      clearExisting: last.clearExisting ?? true,
      mergeWalls: last.mergeWalls ?? true
    };
  }

  _onRender() {
    this.element.addEventListener("change", event => {
      if (!event.target.matches("input[name^='collection-']")) return;
      // When the boundary field is empty, suggest the default of the first selected collection.
      const boundary = this.element.elements.boundaryTags;
      if (boundary.value.trim()) return;
      const checked = this.#selectedCollections();
      const suggestion = checked.find(c => c.mapping.boundary.length)?.mapping.boundary.join(", ") ?? "";
      boundary.value = suggestion;
    });
  }

  #selectedCollections() {
    const inputs = this.element.querySelectorAll("input[name^='collection-']:checked");
    return [...inputs].map(input => this.collections[Number(input.dataset.index)]).filter(Boolean);
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

  static #onCancel() {
    this.close();
  }

  static async #onSubmit(event, form) {
    const selected = this.#selectedCollections();
    if (!selected.length) {
      ui.notifications.warn(game.i18n.localize("WFC.Generate.NoneSelected"));
      return;
    }
    const options = {
      collectionDirs: selected.map(c => c.dir),
      seed: form.elements.seed.value.trim() || foundry.utils.randomID(8),
      boundaryTags: normalizeTags(form.elements.boundaryTags.value),
      restrictedTags: normalizeTags(form.elements.restrictedTags.value),
      matchSurroundings: form.elements.matchSurroundings.checked,
      placeOutlineWalls: form.elements.placeOutlineWalls.checked,
      placeTileWalls: form.elements.placeTileWalls.checked,
      clearExisting: form.elements.clearExisting.checked,
      mergeWalls: form.elements.mergeWalls.checked
    };
    await game.settings.set(MODULE_ID, "lastSelection", {
      collections: options.collectionDirs,
      boundaryTags: form.elements.boundaryTags.value.trim(),
      restrictedTags: form.elements.restrictedTags.value.trim(),
      matchSurroundings: options.matchSurroundings,
      placeOutlineWalls: options.placeOutlineWalls,
      placeTileWalls: options.placeTileWalls,
      clearExisting: options.clearExisting,
      mergeWalls: options.mergeWalls
    });
    this.resolved = true;
    this.resolve(options);
    await this.close();
  }

  _onClose(options) {
    super._onClose?.(options);
    if (!this.resolved) {
      this.resolved = true;
      this.resolve(null);
    }
  }
}
