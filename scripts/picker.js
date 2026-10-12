/**
 * Tile picker: click a cell to choose by hand which tile goes there, offering only the tiles the
 * solver would accept given the surrounding tiles, markers and empty areas.
 */

import { MODULE_ID } from "./constants.js";
import { getRegisteredDirs } from "./collections.js";
import { candidatesForCell } from "./generator.js";
import { TilePickerDialog } from "./apps/tile-picker.js";
import { log } from "./log.js";

export class PickerTool {
  constructor() {
    this.active = false;
    this.graphics = null;
    this._onPointerDown = this.#onPointerDown.bind(this);
    this._onPointerMove = this.#onPointerMove.bind(this);
  }

  get view() {
    return canvas.app?.view ?? document.getElementById("board");
  }

  activate() {
    if (this.active) return;
    if (!canvas.ready) { log.warn("picker tool: canvas not ready"); return; }
    this.active = true;
    this.graphics = new PIXI.Graphics();
    this.graphics.zIndex = 10000;
    (canvas.controls ?? canvas.interface ?? canvas.stage).addChild(this.graphics);
    this.view.addEventListener("pointerdown", this._onPointerDown);
    this.view.addEventListener("pointermove", this._onPointerMove);
    log.debug("picker tool activated");
    ui.notifications.info(game.i18n.localize("WFC.Tools.PickerHint"));
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.view?.removeEventListener("pointerdown", this._onPointerDown);
    this.view?.removeEventListener("pointermove", this._onPointerMove);
    this.graphics?.destroy();
    this.graphics = null;
    log.debug("picker tool deactivated");
  }

  #toCanvas(event) {
    if (typeof canvas.canvasCoordinatesFromClient === "function") {
      return canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
    }
    const rect = this.view.getBoundingClientRect();
    return canvas.stage.toLocal(new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top));
  }

  #cellAt(event) {
    const p = this.#toCanvas(event);
    const size = canvas.grid.size;
    return { i: Math.floor(p.y / size), j: Math.floor(p.x / size) };
  }

  #onPointerMove(event) {
    if (!this.graphics) return;
    const { i, j } = this.#cellAt(event);
    const size = canvas.grid.size;
    this.graphics.clear();
    this.graphics.lineStyle(3, 0x4fa3ff, 0.9);
    this.graphics.drawRect(j * size, i * size, size, size);
  }

  async #onPointerDown(event) {
    if (event.button !== 0) return;
    const cell = this.#cellAt(event);
    log.debug("picker tool click", cell);
    try {
      const last = game.settings.get(MODULE_ID, "lastSelection") ?? {};
      const dirs = Array.isArray(last.collections) && last.collections.length ? last.collections : getRegisteredDirs();
      const data = await candidatesForCell(cell, dirs, { restrictedTags: last.restrictedTags ?? "" });
      TilePickerDialog.open({ cell, ...data });
    } catch (err) {
      log.error("picker failed", err);
      ui.notifications.error(err.message);
    }
  }
}
