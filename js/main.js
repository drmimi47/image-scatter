import { CanvasManager } from "./CanvasManager.js";
import { PhysicsEngine } from "./PhysicsEngine.js";
import { imageGroups }  from "./manifest.js";

// ─── State ────────────────────────────────────────────────────────────────────

let canvas, physics;
let frame;                    // { outer, inner } — recomputed on resize
let isSettled       = false;
let scatterGen      = 0;      // incremented each Generate; cancels in-flight scatter
let showGroupLabels  = false; // toggled by the Groupings button
let groupTargets     = [];   // [{ label, x, y }, …] — set fresh each scatter
let scatterComplete  = false; // true once the launch loop has finished
const imageCache = new Map(); // path → HTMLImageElement
const bodies     = [];        // { body, img, w, h }

// ─── Frame geometry ───────────────────────────────────────────────────────────
// Outer rect: 33 × 22.75 in.  Inner rect: inset by FRAME_OFFSET on all sides.
// Images are contained within the INNER rect — that is the physics boundary.

const FRAME_W      = 33;
const FRAME_H      = 22.75;
const FRAME_OFFSET = 0.5;     // inches; inner rect is (32 × 21.75 in)
const FRAME_MARGIN = 48;      // min px gap between outer rect and viewport edge

function computeFrame(viewW, viewH) {
  const scale  = Math.min(
    (viewW - FRAME_MARGIN * 2) / FRAME_W,
    (viewH - FRAME_MARGIN * 2) / FRAME_H,
  );

  const outerW = FRAME_W * scale;
  const outerH = FRAME_H * scale;
  const outerX = (viewW - outerW) / 2;
  const outerY = (viewH - outerH) / 2;

  const gap    = FRAME_OFFSET * scale;
  const innerX = outerX + gap;
  const innerY = outerY + gap;
  const innerW = outerW - gap * 2;
  const innerH = outerH - gap * 2;

  return {
    outer: { x: outerX, y: outerY, w: outerW, h: outerH },
    inner: { x: innerX, y: innerY, w: innerW, h: innerH },
    pxPerIn: scale, // logical pixels per inch
  };
}

// ─── Image loading ────────────────────────────────────────────────────────────

function loadImage(path) {
  if (imageCache.has(path)) return Promise.resolve(imageCache.get(path));

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // prevents canvas taint on GitHub Pages / CDN
    img.onload  = () => { imageCache.set(path, img); resolve(img); };
    img.onerror = reject;
    img.src = path.split("/").map(encodeURIComponent).join("/");
  });
}

// ─── Weighted target placement ────────────────────────────────────────────────
// Groups with more images claim more space: we place them largest-first and
// score each candidate position by its size-weighted distance to all already-
// placed targets.  Two large groups must be much further apart than two small
// ones to achieve the same score, so big piles naturally spread out.

function computeTargetCenters(inner, groupSizes) {
  const N       = groupSizes.length;
  const maxSize = Math.max(...groupSizes);
  const MARGIN  = 0.16; // keep targets away from the inner-frame edge (fraction) — lower = clusters can reach closer to edges
  const TRIES   = 300;  // candidate positions tried per group

  // Placement order: largest group first so it claims space before smaller ones.
  const order = groupSizes
    .map((size, idx) => ({ size, idx }))
    .sort((a, b) => b.size - a.size)
    .map(({ idx }) => idx);

  const placed     = new Array(N);        // placed[originalGroupIdx] = {x, y}
  const placedList = [];                  // [{x, y, size}, …] in placement order

  for (const origIdx of order) {
    const sizeA = groupSizes[origIdx];
    let best      = null;
    let bestScore = -Infinity;

    for (let t = 0; t < TRIES; t++) {
      const x = inner.x + inner.w * (MARGIN + Math.random() * (1 - 2 * MARGIN));
      const y = inner.y + inner.h * (MARGIN + Math.random() * (1 - 2 * MARGIN));

      // Score = minimum size-weighted distance to every already-placed target.
      // Dividing raw distance by the normalised combined size means a
      // large+large pair needs far more pixels of clearance to score equally.
      let minWeighted = Infinity;
      for (const p of placedList) {
        const dist         = Math.hypot(x - p.x, y - p.y);
        const combinedNorm = (sizeA + p.size) / (2 * maxSize); // 0 < val ≤ 1
        minWeighted        = Math.min(minWeighted, dist / combinedNorm);
      }

      const score = placedList.length === 0 ? Math.random() : minWeighted;
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }

    placed[origIdx] = best;
    placedList.push({ ...best, size: sizeA });
  }

  return placed; // indexed by original group order, same as groupKeys
}

// ─── Physics lifecycle ────────────────────────────────────────────────────────

function buildPhysics() {
  if (physics) physics.destroy();

  physics = new PhysicsEngine(frame.inner);

  physics.onAfterUpdate(() => {
    drawScene();

    // Enable export once the launch loop is done and every card is at rest.
    // Polling velocity each tick is more reliable than sleepStart events,
    // which can stall when low-frictionAir cards oscillate without fully sleeping.
    if (!isSettled && scatterComplete && bodies.length > 0) {
      const allQuiet = bodies.every(({ body }) =>
        body.isSleeping ||
        (Math.hypot(body.velocity.x, body.velocity.y) < 0.5 &&
         Math.abs(body.angularVelocity) < 0.02)
      );
      if (allQuiet) {
        isSettled = true;
        setExportEnabled(true);
      }
    }
  });

  physics.start();
}

// ─── Scatter ──────────────────────────────────────────────────────────────────

const TOSS_INTERVAL = 80; // ms between each card launch

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function setExportEnabled(enabled) {
  document.getElementById("btn-export").disabled = !enabled;
}

async function scatter() {
  const gen = ++scatterGen;

  isSettled        = false;
  scatterComplete  = false;
  setExportEnabled(false);
  bodies.length = 0;

  // Full physics teardown + rebuild — prevents memory leaks and stale state.
  buildPhysics();

  const groupKeys  = Object.keys(imageGroups);
  const groupSizes = groupKeys.map(k => imageGroups[k].length);
  const targets    = computeTargetCenters(frame.inner, groupSizes);

  // Store for the group-number overlay — use the folder name as the label.
  groupTargets = groupKeys.map((key, gi) => ({
    label: key,
    x: targets[gi].x,
    y: targets[gi].y,
  }));
  const shortSide = Math.min(frame.inner.w, frame.inner.h);

  // Pre-load all images; shuffle each group independently.
  const groups = await Promise.all(groupKeys.map(async (key, gi) => {
    const entries = [...imageGroups[key]].sort(() => Math.random() - 0.5);
    const loaded  = [];
    for (const entry of entries) {
      try {
        const img = await loadImage(entry.path);
        loaded.push({ entry, img, target: targets[gi] });
      } catch { /* skip unloadable */ }
    }
    return loaded;
  }));

  // Round-robin: one card per group per round → all piles grow simultaneously.
  const maxLen = Math.max(...groups.map(g => g.length));
  for (let round = 0; round < maxLen; round++) {
    for (let gi = 0; gi < groups.length; gi++) {
      if (gen !== scatterGen) return;
      const card = groups[gi][round];
      if (!card) continue;

      const { entry, img, target } = card;
      const longestEdgePx = (entry.scale * shortSide) / 3 / 1.25;
      const imgScale = longestEdgePx / Math.max(img.naturalWidth, img.naturalHeight);
      const w = img.naturalWidth  * imgScale;
      const h = img.naturalHeight * imgScale;

      const body = physics.launchCardToTarget({ w, h, targetX: target.x, targetY: target.y });
      bodies.push({ body, img, w, h, gi });

      await delay(TOSS_INTERVAL);
    }
  }

  // Mark launch complete only if this scatter wasn't superseded by a newer one.
  if (gen === scatterGen) scatterComplete = true;
}

// ─── Export (300 dpi) ─────────────────────────────────────────────────────────
// Renders the inner-frame contents to an off-screen canvas at 300 dpi.
// Inner frame = (FRAME_W - 2×FRAME_OFFSET) × (FRAME_H - 2×FRAME_OFFSET) inches
//             = 32 × 21.75 in → 9600 × 6525 px at 300 dpi.

async function exportHighRes() {
  const includeBorder = confirm("Include frame border in the exported PNG?");

  const INNER_W_IN = FRAME_W - 2 * FRAME_OFFSET; // 32 in
  const INNER_H_IN = FRAME_H - 2 * FRAME_OFFSET; // 21.75 in
  const DPI        = 300;

  const exportW = Math.round(INNER_W_IN * DPI); // 9600
  const exportH = Math.round(INNER_H_IN * DPI); // 6525

  // Scale: logical px in frame.inner → export px
  // Since frame.inner.w = INNER_W_IN × pxPerIn, exportScale = DPI / pxPerIn
  const exportScale = exportW / frame.inner.w;

  const tmp = document.createElement("canvas");
  tmp.width  = exportW;
  tmp.height = exportH;
  const ctx = tmp.getContext("2d");

  // Fill background
  ctx.fillStyle = "#F9F9F9";
  ctx.fillRect(0, 0, exportW, exportH);

  // Transform: logical inner-frame coords → export canvas coords
  ctx.save();
  ctx.scale(exportScale, exportScale);
  ctx.translate(-frame.inner.x, -frame.inner.y);

  for (const { body, img, w, h } of bodies) {
    const { x, y } = body.position;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(body.angle);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  ctx.filter = "none";

  ctx.restore();

  // Optional inner-frame border (1 logical px → exportScale px thick)
  if (includeBorder) {
    ctx.save();
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth   = Math.max(1, Math.round(exportScale));
    ctx.strokeRect(0, 0, exportW, exportH);
    ctx.restore();
  }

  // Download via Blob (avoids memory limits of toDataURL on large canvases)
  tmp.toBlob(blob => {
    if (!blob) {
      alert("Export failed: canvas could not be read. This usually means an image was blocked by CORS. Try reloading the page.");
      return;
    }
    const url  = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = "image-scatter.png";
    link.href     = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, "image/png");
}

// ─── Render loop ──────────────────────────────────────────────────────────────

function drawScene() {
  canvas.clear();
  const ctx = canvas.ctx;

  for (const { body, img, w, h } of bodies) {
    const { x, y } = body.position;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(body.angle);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  ctx.filter = "none";

  // Frame outlines drawn last (on top of images)
  ctx.save();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth   = 1;

  const { outer, inner } = frame;
  ctx.strokeRect(outer.x, outer.y, outer.w, outer.h);
  ctx.strokeRect(inner.x, inner.y, inner.w, inner.h);

  ctx.restore();

  if (showGroupLabels) drawGroupLabels(ctx);
}

function drawGroupLabels(ctx) {
  const FONT     = "bold 10px 'JetBrains Mono', 'Courier New', monospace";
  const LINE_H   = 15;  // px between baselines
  const PAD_X    = 10;
  const PAD_Y    = 8;
  const RADIUS   = 6;   // rounded-rect corner radius

  ctx.save();
  ctx.shadowColor = "transparent";
  ctx.font        = FONT;

  for (let gi = 0; gi < groupTargets.length; gi++) {
    const { label } = groupTargets[gi];

    // Compute live centroid from current body positions for this group.
    const groupBodies = bodies.filter(b => b.gi === gi);
    if (groupBodies.length === 0) continue;
    const x = groupBodies.reduce((s, b) => s + b.body.position.x, 0) / groupBodies.length;
    const y = groupBodies.reduce((s, b) => s + b.body.position.y, 0) / groupBodies.length;

    // Use the folder name as-is (e.g. "Building", "Light", …).
    const lines = [label];

    // Measure the widest line to size the pill.
    const maxLineW = Math.max(...lines.map(l => ctx.measureText(l).width));
    const boxW     = maxLineW + PAD_X * 2;
    const boxH     = lines.length * LINE_H + PAD_Y * 2;
    const bx       = x - boxW / 2;
    const by       = y - boxH / 2;

    // Rounded rect background
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, RADIUS);
    ctx.fillStyle = "rgba(20, 20, 20, 0.82)";
    ctx.fill();

    // Text lines centered in the pill
    ctx.fillStyle    = "#ffffff";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    const firstLineY = y - ((lines.length - 1) * LINE_H) / 2;
    lines.forEach((line, i) => ctx.fillText(line, x, firstLineY + i * LINE_H));
  }

  ctx.restore();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  canvas = new CanvasManager(document.getElementById("canvas"));
  frame  = computeFrame(canvas.logicalWidth, canvas.logicalHeight);

  buildPhysics();

  window.addEventListener("resize", () => {
    frame = computeFrame(canvas.logicalWidth, canvas.logicalHeight);
    physics.resize(frame.inner);
    drawScene();
  });

  document.getElementById("btn-generate").addEventListener("click", scatter);
  document.getElementById("btn-export").addEventListener("click", exportHighRes);
  document.getElementById("btn-groups").addEventListener("click", () => {
    showGroupLabels = !showGroupLabels;
    drawScene();
  });

  drawScene();
}

init();
