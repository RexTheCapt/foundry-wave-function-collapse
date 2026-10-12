import { MODULE_ID, TEMPLATES } from "../constants.js";
import { createCollection, getFilePicker, getRegisteredDirs, loadCollections, registerDir, unregisterDir, cleanDir } from "../collections.js";
import { CollectionEditor } from "./collection-editor.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** Menu listing all registered tile collections. */
export class CollectionsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "wfc-collections",
    classes: ["wfc-app", "wfc-collections"],
    window: { title: "WFC.Collections.Title", icon: "fa-solid fa-layer-group", resizable: true },
    position: { width: 620, height: "auto" },
    actions: {
      create: CollectionsApp.#onCreate,
      addExisting: CollectionsApp.#onAddExisting,
      open: CollectionsApp.#onOpen,
      remove: CollectionsApp.#onRemove,
      refresh: CollectionsApp.#onRefresh
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATES}/collections.hbs` }
  };

  /** Singleton accessor. */
  static get instance() {
    return (this._instance ??= new CollectionsApp());
  }

  static open() {
    return this.instance.render(true);
  }

  async _prepareContext() {
    const collections = await loadCollections(getRegisteredDirs());
    return {
      collections: collections.map(c => ({
        dir: c.dir,
        name: c.name,
        count: Object.keys(c.mapping.tiles).length,
        hasMapping: c.hasMapping,
        error: c.error
      }))
    };
  }

  static async #onCreate() {
    const name = await DialogV2.prompt({
      window: { title: game.i18n.localize("WFC.Collections.New") },
      content: `<div class="form-group"><label>${game.i18n.localize("WFC.Collections.NameLabel")}</label>
        <div class="form-fields"><input type="text" name="name" autofocus required></div></div>`,
      ok: {
        label: game.i18n.localize("WFC.Collections.Create"),
        callback: (event, button) => button.form.elements.name.value.trim()
      },
      rejectClose: false
    });
    if (!name) return;
    try {
      const dir = await createCollection(name);
      ui.notifications.info(game.i18n.format("WFC.Collections.Created", { dir }));
      await this.render();
      new CollectionEditor({ dir }).render(true);
    } catch (err) {
      console.error(err);
      ui.notifications.error(game.i18n.format("WFC.Errors.SaveFailed", { message: err.message }));
    }
  }

  static async #onAddExisting() {
    const FP = getFilePicker();
    const root = cleanDir(game.settings.get(MODULE_ID, "collectionsRoot"));
    const picker = new FP({
      type: "folder",
      current: root,
      callback: async path => {
        const added = await registerDir(path);
        if (!added) ui.notifications.warn(game.i18n.localize("WFC.Collections.AlreadyRegistered"));
        await this.render();
      }
    });
    picker.render(true);
  }

  static async #onOpen(event, target) {
    new CollectionEditor({ dir: target.dataset.dir }).render(true);
  }

  static async #onRemove(event, target) {
    const dir = target.dataset.dir;
    const ok = await DialogV2.confirm({
      window: { title: game.i18n.localize("WFC.Collections.Remove") },
      content: `<p>${game.i18n.format("WFC.Collections.RemoveConfirm", { dir })}</p>`,
      rejectClose: false
    });
    if (!ok) return;
    await unregisterDir(dir);
    ui.notifications.info(game.i18n.localize("WFC.Collections.Removed"));
    await this.render();
  }

  static async #onRefresh() {
    await this.render();
  }
}
