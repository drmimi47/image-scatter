export class CanvasManager {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext("2d");
    this.dpr = window.devicePixelRatio || 1;

    this._resize();
    window.addEventListener("resize", () => this._resize());
  }

  /** Scale the canvas backing store to match the device pixel ratio. */
  _resize() {
    const { canvas, ctx, dpr } = this;
    const w = window.innerWidth;
    const h = window.innerHeight;

    // Backing store dimensions (physical pixels)
    canvas.width  = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    // CSS display dimensions (logical pixels)
    canvas.style.width  = `${w}px`;
    canvas.style.height = `${h}px`;

    // Scale all draw calls so coordinates stay in logical pixels
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.width  = w;
    this.height = h;
  }

  get logicalWidth()  { return this.width; }
  get logicalHeight() { return this.height; }

  clear(fillStyle = "#F9F9F9") {
    const { ctx, width, height } = this;
    ctx.fillStyle = fillStyle;
    ctx.fillRect(0, 0, width, height);
  }

  /**
   * Export the current canvas contents as a high-res PNG and trigger a download.
   * @param {string} filename
   */
  exportPNG(filename = "scatter.png") {
    // toDataURL reads the raw backing-store buffer at physical-pixel resolution.
    const link = document.createElement("a");
    link.download = filename;
    link.href = this.canvas.toDataURL("image/png");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Crop to a logical-pixel rect and download as a high-res PNG.
   * Coordinates are in logical pixels; internally converted to physical pixels
   * via dpr before sampling the backing store.
   *
   * @param {{ x: number, y: number, w: number, h: number }} rect
   * @param {string} filename
   */
  exportRegionPNG(rect, filename = "scatter.png") {
    const { dpr } = this;
    const sx = Math.round(rect.x * dpr);
    const sy = Math.round(rect.y * dpr);
    const sw = Math.round(rect.w * dpr);
    const sh = Math.round(rect.h * dpr);

    const tmp    = document.createElement("canvas");
    tmp.width    = sw;
    tmp.height   = sh;
    tmp.getContext("2d").drawImage(this.canvas, sx, sy, sw, sh, 0, 0, sw, sh);

    const link = document.createElement("a");
    link.download = filename;
    link.href = tmp.toDataURL("image/png");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
