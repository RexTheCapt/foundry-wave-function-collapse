import { TEMPLATES } from "../constants.js";
import { describeTags } from "../lib/mapping.js";
import { describeCellConstraints } from "../lib/wfc.js";
import { placeTileAt } from "../generator.js";
import { log } from "../log.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Lists the tiles allowed in a cell and places the one that is clicked. */
export class TilePickerDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "wfc-tile-picker",
    classes: ["wfc-app", "wfc-tile-picker"],
    window: { title: "WFC.Picker.Title", icon: "fa-solid fa-hand-pointer", resizable: true },
    position: { width: 620, height: 520 },
    actions: {
      pick: TilePickerDialog.#onPick,
      toggleAll: TilePickerDialog.#onToggleAll
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATES}/tile-picker.hbs`, scrollable: [".wfc-picker-grid"] }
  };

  static open(data) {
    const existing = foundry.applications.instances.get("wfc-tile-picker");
    if (existing) existing.close();
    new TilePickerDialog(data).render(true);
  }

  constructor(options) {
    super(options);
    this.cell = options.cell;
    this.variants = options.variants;
    this.allowed = options.allowed;
    this.constraints = options.constraints;
    this.compatible = options.compatible;
    this.incompatible = options.incompatible;
    this.existingTile = options.existingTile;
    this.showAll = false;
  }

  get title() {
    return `${game.i18n.localize("WFC.Picker.Title")} (${this.cell.j + 1}, ${this.cell.i + 1})`;
  }

  async _prepareContext() {
    const list = this.showAll ? this.variants : this.allowed;
    const allowedSet = new Set(this.allowed);
    return {
      cell: `${this.cell.j + 1}, ${this.cell.i + 1}`,
      allowedCount: this.allowed.length,
      totalCount: this.variants.length,
      showAll: this.showAll,
      rules: describeCellConstraints(this.constraints, this.variants, this.compatible, { incompatible: this.incompatible }),
      current: this.existingTile ? this.existingTile.flags?.["wave-function-collapse"]?.tile?.split("/").pop() : null,
      candidates: list.map((v, index) => ({
        index: this.variants.indexOf(v),
        src: v.tile.src,
        name: v.tile.src.split("/").pop(),
        rotation: v.rotation,
        tags: describeTags(v.tags),
        allowed: allowedSet.has(v)
      }))
    };
  }

  static async #onToggleAll() {
    this.showAll = !this.showAll;
    await this.render();
  }

  static async #onPick(event, target) {
    const variant = this.variants[Number(target.dataset.index)];
    if (!variant) return;
    try {
      await placeTileAt(this.cell, variant);
      ui.notifications.info(game.i18n.format("WFC.Picker.Placed", { name: variant.tile.src.split("/").pop(), rotation: variant.rotation }));
      await this.close();
    } catch (err) {
      log.error("manual placement failed", err);
      ui.notifications.error(err.message);
    }
  }
}
