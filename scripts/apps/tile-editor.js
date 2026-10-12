import { MODULE_ID, TEMPLATES } from "../constants.js";
import { normalizeTileEntry } from "../lib/mapping.js";
import { SIDES, normalizeSideTags, sideTagsToText } from "../lib/wfc.js";
import { distanceToSegment } from "../lib/geometry.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const WALL_COLORS = { 0: "#e63946", 1: "#f4a261", 2: "#b56cff" };
const CANVAS_SIZE = 360;

/**
 * Editor for one tile: side tags, weight, rotation and a click-to-draw wall editor.
 */
export class TileEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["wfc-app", "wfc-tile-editor"],
    tag: "form",
    window: { title: "WFC.Tile.Title", icon: "fa-solid fa-vector-square", resizable: false },
    position: { width: 820, height: "auto" },
    form: { handler: TileEditor.#onSubmit, submitOnChange: false, closeOnSubmit: true },
    actions: {
      clearWalls: TileEditor.#onClearWalls,
      undoWall: TileEditor.#onUndoWall,
      cancel: TileEditor.#onCancel
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATES}/tile-editor.hbs` }
  };

  constructor(options) {
    super({ ...options, id: `wfc-tile-${(options.dir + "/" + options.file).replace(/[^a-z0-9]+/gi, "-")}` });
    this.editor = options.editor;
    this.dir = options.dir;
    this.file = options.file;
    this.entry = foundry.utils.deepClone(normalizeTileEntry(options.entry));
    this.walls = this.entry.walls.map(w => ({ ...w, c: [...w.c] }));
    this.pending = null;
    this.hover = null;
    this.wallType = 0;
    this.image = null;
  }

  get title() {
    return `${game.i18n.localize("WFC.Tile.Title")}: ${this.file}`;
  }

  get divisions() {
    return Math.max(1, Number(game.settings.get(MODULE_ID, "wallSnapDivisions")) || 4);
  }

  async _prepareContext() {
    return {
      file: this.file,
      src: `${this.dir}/${this.file}`,
      tags: Object.fromEntries(SIDES.map(s => [s, sideTagsToText(this.entry.tags[s])])),
      weight: this.entry.weight,
      rotate: this.entry.rotate,
      canvasSize: CANVAS_SIZE,
      divisions: this.divisions,
      wallTypes: [
        { value: 0, label: game.i18n.localize("WFC.Tile.WallNormal") },
        { value: 1, label: game.i18n.localize("WFC.Tile.WallDoor") },
        { value: 2, label: game.i18n.localize("WFC.Tile.WallSecret") }
      ],
      wallCount: this.walls.length
    };
  }

  _onRender() {
    const cnv = this.element.querySelector("canvas[data-wall-canvas]");
    if (!cnv) return;
    this.canvas = cnv;
    cnv.addEventListener("pointerdown", e => this.#onCanvasDown(e));
    cnv.addEventListener("pointermove", e => this.#onCanvasMove(e));
    cnv.addEventListener("pointerleave", () => { this.hover = null; this.#draw(); });
    cnv.addEventListener("contextmenu", e => e.preventDefault());
    const typeSelect = this.element.querySelector("select[name=wallType]");
    typeSelect.value = String(this.wallType);
    typeSelect.addEventListener("change", () => { this.wallType = Number(typeSelect.value); });
    if (!this.image) {
      const img = new Image();
      img.onload = () => { this.image = img; this.#draw(); };
      img.onerror = () => this.#draw();
      img.src = `${this.dir}/${this.file}`;
    }
    this.#draw();
  }

  #snapPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const d = this.divisions;
    const clamp = v => Math.min(1, Math.max(0, v));
    return [clamp(Math.round(x * d) / d), clamp(Math.round(y * d) / d)];
  }

  #rawPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
  }

  #onCanvasDown(event) {
    event.preventDefault();
    if (event.button === 2) {
      if (this.pending) { this.pending = null; this.#draw(); return; }
      const [px, py] = this.#rawPoint(event);
      let best = -1;
      let bestDist = 0.04;
      this.walls.forEach((w, k) => {
        const dist = distanceToSegment(px, py, w.c);
        if (dist < bestDist) { bestDist = dist; best = k; }
      });
      if (best >= 0) { this.walls.splice(best, 1); this.#updateCount(); this.#draw(); }
      return;
    }
    if (event.button !== 0) return;
    const p = this.#snapPoint(event);
    if (!this.pending) {
      this.pending = p;
    } else {
      if (p[0] !== this.pending[0] || p[1] !== this.pending[1]) {
        this.walls.push({ c: [...this.pending, ...p], door: this.wallType });
        this.#updateCount();
      }
      this.pending = event.shiftKey ? p : null;
    }
    this.#draw();
  }

  #onCanvasMove(event) {
    this.hover = this.#snapPoint(event);
    this.#draw();
  }

  #updateCount() {
    const el = this.element.querySelector("[data-wall-count]");
    if (el) el.textContent = String(this.walls.length);
  }

  #draw() {
    const cnv = this.canvas;
    if (!cnv) return;
    const ctx = cnv.getContext("2d");
    const S = cnv.width;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = "#222";
    ctx.fillRect(0, 0, S, S);
    if (this.image) ctx.drawImage(this.image, 0, 0, S, S);
    const d = this.divisions;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    for (let k = 0; k <= d; k++) {
      const v = Math.round((k / d) * S) + 0.5;
      ctx.beginPath(); ctx.moveTo(v, 0); ctx.lineTo(v, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, v); ctx.lineTo(S, v); ctx.stroke();
    }
    ctx.lineCap = "round";
    for (const w of this.walls) {
      ctx.strokeStyle = WALL_COLORS[w.door] ?? WALL_COLORS[0];
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(w.c[0] * S, w.c[1] * S);
      ctx.lineTo(w.c[2] * S, w.c[3] * S);
      ctx.stroke();
    }
    if (this.pending) {
      ctx.fillStyle = "#4fa3ff";
      ctx.beginPath(); ctx.arc(this.pending[0] * S, this.pending[1] * S, 6, 0, Math.PI * 2); ctx.fill();
      if (this.hover) {
        ctx.strokeStyle = "rgba(79,163,255,0.8)";
        ctx.lineWidth = 4;
        ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(this.pending[0] * S, this.pending[1] * S); ctx.lineTo(this.hover[0] * S, this.hover[1] * S); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (this.hover) {
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath(); ctx.arc(this.hover[0] * S, this.hover[1] * S, 4, 0, Math.PI * 2); ctx.fill();
    }
  }

  static #onClearWalls() {
    this.walls = [];
    this.pending = null;
    this.#updateCount();
    this.#draw();
  }

  static #onUndoWall() {
    this.walls.pop();
    this.#updateCount();
    this.#draw();
  }

  static #onCancel() {
    this.close();
  }

  static async #onSubmit(event, form) {
    const tags = {};
    for (const side of SIDES) tags[side] = normalizeSideTags(form.elements[`tags.${side}`].value);
    const entry = normalizeTileEntry({
      tags,
      walls: this.walls,
      weight: Number(form.elements.weight.value),
      rotate: form.elements.rotate.checked
    });
    await this.editor.updateTile(this.file, entry);
  }
}
