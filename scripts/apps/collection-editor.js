import { TEMPLATES } from "../constants.js";
import { getFilePicker, listImageFiles, loadCollection, relativeTileFile, saveMapping } from "../collections.js";
import { describeTags, emptyTileEntry } from "../lib/mapping.js";
import { normalizeTags } from "../lib/wfc.js";
import { TileEditor } from "./tile-editor.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** Editor for a single collection: metadata plus the list of mapped tiles. */
export class CollectionEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["wfc-app", "wfc-collection-editor"],
    tag: "form",
    window: { title: "WFC.Editor.Title", icon: "fa-solid fa-images", resizable: true },
    position: { width: 760, height: 620 },
    form: { handler: CollectionEditor.#onSubmit, submitOnChange: false, closeOnSubmit: false },
    actions: {
      addTile: CollectionEditor.#onAddTile,
      scan: CollectionEditor.#onScan,
      editTile: CollectionEditor.#onEditTile,
      removeTile: CollectionEditor.#onRemoveTile,
      reload: CollectionEditor.#onReload
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATES}/collection-editor.hbs`, scrollable: [".wfc-tile-list"] }
  };

  constructor(options) {
    super({ ...options, id: `wfc-collection-${options.dir.replace(/[^a-z0-9]+/gi, "-")}` });
    this.dir = options.dir;
    this.collection = null;
  }

  get title() {
    return `${game.i18n.localize("WFC.Editor.Title")}: ${this.collection?.name ?? this.dir}`;
  }

  async _prepareContext() {
    this.collection ??= await loadCollection(this.dir);
    const { mapping } = this.collection;
    const tiles = Object.entries(mapping.tiles).map(([file, entry]) => ({
      file,
      src: `${this.dir}/${file}`,
      tags: describeTags(entry.tags),
      walls: entry.walls.length,
      weight: entry.weight,
      rotate: entry.rotate
    }));
    return {
      dir: this.dir,
      name: mapping.name,
      description: mapping.description,
      boundary: mapping.boundary.join(", "),
      hasMapping: this.collection.hasMapping,
      error: this.collection.error,
      tiles
    };
  }

  /** Read the metadata inputs into the in-memory mapping. */
  #readForm() {
    const form = this.element;
    const mapping = this.collection.mapping;
    mapping.name = form.elements.name?.value.trim() || mapping.name;
    mapping.description = form.elements.description?.value ?? "";
    mapping.boundary = normalizeTags(form.elements.boundary?.value ?? "");
  }

  async save() {
    this.#readForm();
    try {
      this.collection.mapping = await saveMapping(this.dir, this.collection.mapping);
      this.collection.hasMapping = true;
      this.collection.name = this.collection.mapping.name;
      ui.notifications.info(game.i18n.localize("WFC.Editor.Saved"));
    } catch (err) {
      console.error(err);
      ui.notifications.error(game.i18n.format("WFC.Errors.SaveFailed", { message: err.message }));
      return false;
    }
    return true;
  }

  /** Called by the tile editor when a tile is saved. */
  async updateTile(file, entry) {
    this.#readForm();
    this.collection.mapping.tiles[file] = entry;
    await this.save();
    await this.render();
  }

  static async #onSubmit() {
    await this.save();
    await this.render();
  }

  static async #onAddTile() {
    const FP = getFilePicker();
    const picker = new FP({
      type: "image",
      current: this.dir,
      callback: path => {
        const file = relativeTileFile(this.dir, path);
        if (!file) {
          ui.notifications.warn(game.i18n.format("WFC.Editor.OutsideDirectory", { dir: this.dir }));
          return;
        }
        this.#openTileEditor(file);
      }
    });
    picker.render(true);
  }

  static async #onScan() {
    try {
      const files = await listImageFiles(this.dir);
      const missing = files.filter(f => !(f in this.collection.mapping.tiles));
      if (!missing.length) {
        ui.notifications.info(game.i18n.localize("WFC.Editor.ScanNone"));
        return;
      }
      this.#readForm();
      for (const f of missing) this.collection.mapping.tiles[f] = emptyTileEntry();
      await this.save();
      ui.notifications.info(game.i18n.format("WFC.Editor.ScanAdded", { count: missing.length }));
      await this.render();
    } catch (err) {
      console.error(err);
      ui.notifications.error(game.i18n.format("WFC.Errors.LoadFailed", { message: err.message }));
    }
  }

  static #onEditTile(event, target) {
    this.#openTileEditor(target.closest("[data-file]").dataset.file);
  }

  static async #onRemoveTile(event, target) {
    const file = target.closest("[data-file]").dataset.file;
    const ok = await DialogV2.confirm({
      window: { title: game.i18n.localize("WFC.Editor.Delete") },
      content: `<p>${game.i18n.format("WFC.Editor.DeleteConfirm", { file })}</p>`,
      rejectClose: false
    });
    if (!ok) return;
    this.#readForm();
    delete this.collection.mapping.tiles[file];
    await this.save();
    await this.render();
  }

  static async #onReload() {
    this.collection = null;
    await this.render();
  }

  #openTileEditor(file) {
    const entry = this.collection.mapping.tiles[file] ?? emptyTileEntry();
    new TileEditor({ editor: this, dir: this.dir, file, entry }).render(true);
  }
}
