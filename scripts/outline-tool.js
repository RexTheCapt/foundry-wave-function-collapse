/**
 * Canvas tool that lets the GM click grid vertices to draw a dungeon outline.
 *
 * Left click: add a vertex (snapped to the grid). Click the first vertex or press Enter to finish.
 * Right click: remove the last vertex. Escape: clear the outline.
 */

import { cellsInPolygon } from "./lib/geometry.js";

export class OutlineTool {
  /** @param {{onFinish: (polygon: number[][]) => Promise<void>}} options */
  constructor({ onFinish }) {
    this.onFinish = onFinish;
    this.active = false;
    this.busy = false;
    this.points = [];
    this.cursor = null;
    this.graphics = null;
    this._onPointerDown = this.#onPointerDown.bind(this);
    this._onPointerMove = this.#onPointerMove.bind(this);
    this._onKeyDown = this.#onKeyDown.bind(this);
  }

  get view() {
    return canvas.app?.view ?? document.getElementById("board");
  }

  activate() {
    if (this.active || !canvas.ready) return;
    this.active = true;
    this.graphics = new PIXI.Graphics();
    this.graphics.zIndex = 10000;
    const parent = canvas.controls ?? canvas.interface ?? canvas.stage;
    parent.addChild(this.graphics);
    const view = this.view;
    view.addEventListener("pointerdown", this._onPointerDown);
    view.addEventListener("pointermove", this._onPointerMove);
    window.addEventListener("keydown", this._onKeyDown, { capture: true });
    ui.notifications.info(game.i18n.localize("WFC.Tools.OutlineHint"));
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    const view = this.view;
    view?.removeEventListener("pointerdown", this._onPointerDown);
    view?.removeEventListener("pointermove", this._onPointerMove);
    window.removeEventListener("keydown", this._onKeyDown, { capture: true });
    this.graphics?.destroy({ children: true });
    this.graphics = null;
    this.points = [];
    this.cursor = null;
    this.busy = false;
  }

  reset() {
    this.points = [];
    this.cursor = null;
    this.busy = false;
    this.#draw();
  }

  #toCanvas(event) {
    if (typeof canvas.canvasCoordinatesFromClient === "function") {
      return canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
    }
    const rect = this.view.getBoundingClientRect();
    return canvas.stage.toLocal(new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top));
  }

  #snap(point) {
    const size = canvas.grid.size;
    return { x: Math.round(point.x / size) * size, y: Math.round(point.y / size) * size };
  }

  #isFirst(point) {
    if (!this.points.length) return false;
    const first = this.points[0];
    return Math.hypot(first.x - point.x, first.y - point.y) < canvas.grid.size * 0.5;
  }

  #onPointerDown(event) {
    if (this.busy) return;
    if (event.button === 2) {
      if (this.points.length) {
        this.points.pop();
        this.#draw();
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (event.button !== 0) return;
    const point = this.#snap(this.#toCanvas(event));
    if (this.points.length >= 3 && this.#isFirst(point)) {
      void this.finish();
      return;
    }
    const last = this.points[this.points.length - 1];
    if (last && last.x === point.x && last.y === point.y) return;
    this.points.push(point);
    this.#draw();
  }

  #onPointerMove(event) {
    if (!this.points.length || this.busy) return;
    this.cursor = this.#snap(this.#toCanvas(event));
    this.#draw();
  }

  #onKeyDown(event) {
    const tag = event.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.target?.isContentEditable) return;
    if (this.busy) return;
    if (event.key === "Escape" && this.points.length) {
      this.reset();
      event.stopPropagation();
      event.preventDefault();
    } else if (event.key === "Enter" && this.points.length) {
      void this.finish();
      event.stopPropagation();
      event.preventDefault();
    }
  }

  async finish() {
    if (this.points.length < 3) {
      ui.notifications.warn(game.i18n.localize("WFC.Errors.NeedThreePoints"));
      return;
    }
    const polygon = this.points.map(p => [p.x, p.y]);
    this.busy = true;
    this.cursor = null;
    this.#draw(true);
    try {
      await this.onFinish(polygon);
    } finally {
      if (this.active) this.reset();
    }
  }

  #draw(highlightCells = false) {
    const g = this.graphics;
    if (!g) return;
    g.clear();
    const size = canvas.grid.size;
    if (highlightCells && this.points.length >= 3) {
      const cells = cellsInPolygon(this.points.map(p => [p.x, p.y]), size);
      g.beginFill(0x4fa3ff, 0.2);
      for (const c of cells) g.drawRect(c.j * size, c.i * size, size, size);
      g.endFill();
    }
    if (this.points.length) {
      g.lineStyle(4, 0xff9f1c, 0.9);
      g.moveTo(this.points[0].x, this.points[0].y);
      for (const p of this.points.slice(1)) g.lineTo(p.x, p.y);
      if (this.cursor && !this.busy) {
        g.lineStyle(3, 0xffd166, 0.6);
        const last = this.points[this.points.length - 1];
        g.moveTo(last.x, last.y);
        g.lineTo(this.cursor.x, this.cursor.y);
        if (this.points.length >= 2) {
          g.lineStyle(2, 0xffd166, 0.3);
          g.moveTo(this.cursor.x, this.cursor.y);
          g.lineTo(this.points[0].x, this.points[0].y);
        }
      } else if (this.points.length >= 3) {
        g.lineStyle(4, 0xff9f1c, 0.9);
        const last = this.points[this.points.length - 1];
        g.moveTo(last.x, last.y);
        g.lineTo(this.points[0].x, this.points[0].y);
      }
      g.lineStyle(0);
      this.points.forEach((p, k) => {
        g.beginFill(k === 0 ? 0x4fa3ff : 0xff9f1c, 1);
        g.drawCircle(p.x, p.y, Math.max(5, size * 0.08));
        g.endFill();
      });
    }
  }
}
