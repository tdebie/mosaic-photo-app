const MAX_SOURCES = 200;

const state = {
  masterImage: null,
  sourcePhotos: [],
  mask: null, // effective mask: 1 include, 2 exclude
  generated: null,
};

const els = {
  masterInput: document.getElementById('masterInput'),
  sourcesInput: document.getElementById('sourcesInput'),
  uploadStatus: document.getElementById('uploadStatus'),
  printPreset: document.getElementById('printPreset'),
  printWidth: document.getElementById('printWidth'),
  printHeight: document.getElementById('printHeight'),
  lockAspect: document.getElementById('lockAspect'),
  dpi: document.getElementById('dpi'),
  tileMin: document.getElementById('tileMin'),
  tileMax: document.getElementById('tileMax'),
  varyTileSize: document.getElementById('varyTileSize'),
  overlapPct: document.getElementById('overlapPct'),
  rotationDeg: document.getElementById('rotationDeg'),
  resolutionHint: document.getElementById('resolutionHint'),
  mode: document.getElementById('mode'),
  matchTolerance: document.getElementById('matchTolerance'),
  adjustTolerance: document.getElementById('adjustTolerance'),
  colorToolEnabled: document.getElementById('colorToolEnabled'),
  colorToolMode: document.getElementById('colorToolMode'),
  excludeColor: document.getElementById('excludeColor'),
  excludeTolerance: document.getElementById('excludeTolerance'),
  smoothMinIsland: document.getElementById('smoothMinIsland'),
  smoothMaskBtn: document.getElementById('smoothMaskBtn'),
  boundarySmoothRadius: document.getElementById('boundarySmoothRadius'),
  smoothBoundaryBtn: document.getElementById('smoothBoundaryBtn'),
  maskCanvas: document.getElementById('maskCanvas'),
  brushSize: document.getElementById('brushSize'),
  clearMask: document.getElementById('clearMask'),
  generateBtn: document.getElementById('generateBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  generateStatus: document.getElementById('generateStatus'),
  outputCanvas: document.getElementById('outputCanvas'),
  report: document.getElementById('report'),
};

const maskCtx = els.maskCanvas.getContext('2d');
const outputCtx = els.outputCanvas.getContext('2d');

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function getSettings() {
  const widthCm = parseFloat(els.printWidth.value) || 32;
  const heightCm = parseFloat(els.printHeight.value) || 40;
  const dpi = parseInt(els.dpi.value, 10) || 300;
  const tileMinCm = parseFloat(els.tileMin.value) || 1.2;
  const tileMaxCm = Math.max(tileMinCm, parseFloat(els.tileMax.value) || 2.5);
  const vary = els.varyTileSize.checked;
  const overlapPct = clamp(parseFloat(els.overlapPct.value) || 0, 0, 30);
  const rotationDeg = clamp(parseFloat(els.rotationDeg.value) || 0, 0, 8);
  const pxW = Math.round((widthCm / 2.54) * dpi);
  const pxH = Math.round((heightCm / 2.54) * dpi);
  const tileMinPx = Math.max(8, Math.round((tileMinCm / 2.54) * dpi));
  const tileMaxPx = Math.max(tileMinPx, Math.round((tileMaxCm / 2.54) * dpi));
  return { widthCm, heightCm, dpi, tileMinCm, tileMaxCm, pxW, pxH, tileMinPx, tileMaxPx, vary, overlapPct, rotationDeg };
}

function updatePrintPreset() {
  if (els.printPreset.value === 'custom') return;
  const longEdgeCm = parseFloat(els.printPreset.value);
  applyProportionalPrintSize(longEdgeCm);
  updateResolutionHint();
}

function applyProportionalPrintSize(longEdgeCm) {
  let ratio = 4 / 5;
  if (state.masterImage) {
    ratio = state.masterImage.width / state.masterImage.height;
  }
  if (!els.lockAspect.checked && els.printPreset.value === 'custom') return;
  if (ratio >= 1) {
    els.printWidth.value = longEdgeCm.toFixed(1);
    els.printHeight.value = (longEdgeCm / ratio).toFixed(1);
  } else {
    els.printHeight.value = longEdgeCm.toFixed(1);
    els.printWidth.value = (longEdgeCm * ratio).toFixed(1);
  }
}

function estimateTileCount(settings) {
  const avgTile = settings.vary ? (settings.tileMinPx + settings.tileMaxPx) / 2 : settings.tileMaxPx;
  const area = settings.pxW * settings.pxH;
  return Math.max(1, Math.round(area / (avgTile * avgTile)));
}

function computeSourceMaxResolution(settings, sourceCount) {
  const tiles = estimateTileCount(settings);
  const photosAvailable = Math.max(1, sourceCount);
  const reuseFactor = Math.max(1, tiles / photosAvailable);
  const base = settings.tileMaxPx;
  return Math.round(base * Math.sqrt(reuseFactor));
}

function updateResolutionHint() {
  const settings = getSettings();
  const tiles = estimateTileCount(settings);
  const maxRes = computeSourceMaxResolution(settings, state.sourcePhotos.length || 1);
  let masterHint = 'Load master image to compute max print at 300 DPI.';
  if (state.masterImage) {
    const maxWidthCm = (state.masterImage.width / 300) * 2.54;
    const maxHeightCm = (state.masterImage.height / 300) * 2.54;
    masterHint = `Master max at 300 DPI: ${maxWidthCm.toFixed(1)} × ${maxHeightCm.toFixed(1)} cm.`;
  }
  els.resolutionHint.textContent = `Estimated ${tiles.toLocaleString()} mosaic tiles. Recommended max source downsample: longest edge ≈ ${maxRes}px. ${masterHint}`;
}

function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rr = 0, gg = 0, bb = 0;
  if (h < 60) [rr, gg, bb] = [c, x, 0];
  else if (h < 120) [rr, gg, bb] = [x, c, 0];
  else if (h < 180) [rr, gg, bb] = [0, c, x];
  else if (h < 240) [rr, gg, bb] = [0, x, c];
  else if (h < 300) [rr, gg, bb] = [x, 0, c];
  else [rr, gg, bb] = [c, 0, x];
  return [
    Math.round((rr + m) * 255),
    Math.round((gg + m) * 255),
    Math.round((bb + m) * 255),
  ];
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
  ];
}

function colorDistance(a, b) {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 +
    (a[1] - b[1]) ** 2 +
    (a[2] - b[2]) ** 2
  );
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function filterSmallComponents(binary, w, h, targetValue, minSize, replacementValue) {
  if (minSize <= 0) return;
  const visited = new Uint8Array(binary.length);
  const stackX = new Int32Array(binary.length);
  const stackY = new Int32Array(binary.length);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (visited[idx] || binary[idx] !== targetValue) continue;

      let count = 0;
      let top = 0;
      stackX[top] = x;
      stackY[top] = y;
      visited[idx] = 1;
      const members = [];

      while (top >= 0) {
        const cx = stackX[top];
        const cy = stackY[top];
        top--;
        const ci = cy * w + cx;
        members.push(ci);
        count++;

        const neighbors = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (visited[ni] || binary[ni] !== targetValue) continue;
          visited[ni] = 1;
          top++;
          stackX[top] = nx;
          stackY[top] = ny;
        }
      }

      if (count < minSize) {
        for (const m of members) binary[m] = replacementValue;
      }
    }
  }
}

function applyColorToolToMask() {
  if (!state.masterImage || !state.mask || !els.colorToolEnabled.checked) return;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = els.maskCanvas.width;
  tempCanvas.height = els.maskCanvas.height;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(state.masterImage, 0, 0, tempCanvas.width, tempCanvas.height);
  const img = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
  const data = img.data;
  const selectedColor = hexToRgb(els.excludeColor.value);
  const tol = parseInt(els.excludeTolerance.value, 10);
  const modeVal = els.colorToolMode.value === 'include' ? 1 : 2;
  for (let i = 0; i < state.mask.length; i++) {
    const p = i * 4;
    const c = [data[p], data[p + 1], data[p + 2]];
    if (colorDistance(c, selectedColor) <= tol) state.mask[i] = modeVal;
  }
  drawMaskPreview();
}

function smoothMaskIslands() {
  if (!state.mask) return;
  const minIsland = Math.max(0, parseInt(els.smoothMinIsland.value, 10) || 0);
  const binary = new Uint8Array(state.mask.length);
  for (let i = 0; i < state.mask.length; i++) {
    binary[i] = state.mask[i] === 1 ? 1 : 0;
  }
  filterSmallComponents(binary, els.maskCanvas.width, els.maskCanvas.height, 1, minIsland, 0);
  filterSmallComponents(binary, els.maskCanvas.width, els.maskCanvas.height, 0, minIsland, 1);
  for (let i = 0; i < state.mask.length; i++) {
    state.mask[i] = binary[i] === 1 ? 1 : 2;
  }
  drawMaskPreview();
}

function smoothMaskBoundaries() {
  if (!state.mask) return;
  const r = clamp(parseInt(els.boundarySmoothRadius.value, 10) || 2, 1, 8);
  const w = els.maskCanvas.width;
  const h = els.maskCanvas.height;
  const source = new Uint8Array(state.mask.length);
  for (let i = 0; i < state.mask.length; i++) source[i] = state.mask[i] === 1 ? 1 : 0;
  const out = new Uint8Array(source.length);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ones = 0;
      let total = 0;
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (ox * ox + oy * oy > r * r) continue;
          total++;
          if (source[ny * w + nx] === 1) ones++;
        }
      }
      out[y * w + x] = ones >= Math.ceil(total / 2) ? 1 : 0;
    }
  }

  for (let i = 0; i < state.mask.length; i++) state.mask[i] = out[i] === 1 ? 1 : 2;
  drawMaskPreview();
}

function computePhotoStats(canvasCtx, w, h) {
  const sampleStep = Math.max(1, Math.floor(Math.sqrt((w * h) / 20000)));
  const data = canvasCtx.getImageData(0, 0, w, h).data;
  let r = 0, g = 0, b = 0, v = 0, s = 0, n = 0;

  for (let y = 0; y < h; y += sampleStep) {
    for (let x = 0; x < w; x += sampleStep) {
      const i = (y * w + x) * 4;
      const rr = data[i];
      const gg = data[i + 1];
      const bb = data[i + 2];
      const hsv = rgbToHsv(rr, gg, bb);
      r += rr;
      g += gg;
      b += bb;
      s += hsv.s;
      v += hsv.v;
      n++;
    }
  }

  return {
    avgColor: [r / n, g / n, b / n],
    saturation: s / n,
    brightness: v / n,
  };
}

async function processSourceFile(file, maxEdge) {
  const img = await loadImage(file);
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const stats = computePhotoStats(ctx, w, h);

  return {
    id: `${file.name}-${Math.random().toString(36).slice(2, 9)}`,
    name: file.name,
    canvas,
    stats,
    usedCount: 0,
  };
}

async function handleMasterUpload() {
  const file = els.masterInput.files[0];
  if (!file) return;
  state.masterImage = await loadImage(file);
  fitMaskCanvas();
  if (els.lockAspect.checked && els.printPreset.value !== 'custom') {
    applyProportionalPrintSize(parseFloat(els.printPreset.value));
  }
  drawMaskPreview();
  updateStatus();
  updateResolutionHint();
}

async function handleSourceUpload() {
  let files = Array.from(els.sourcesInput.files).filter((f) => f.type.startsWith('image/'));
  if (files.length > MAX_SOURCES) files = files.slice(0, MAX_SOURCES);
  const settings = getSettings();
  const maxEdge = computeSourceMaxResolution(settings, files.length || 1);
  state.sourcePhotos = [];
  updateStatus(`Processing ${files.length} photos...`);

  for (let i = 0; i < files.length; i++) {
    const processed = await processSourceFile(files[i], maxEdge);
    state.sourcePhotos.push(processed);
    if ((i + 1) % 10 === 0 || i === files.length - 1) {
      updateStatus(`Processed ${i + 1}/${files.length} source photos...`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  updateStatus();
  updateResolutionHint();
}

function updateStatus(override) {
  if (override) {
    els.uploadStatus.textContent = override;
    return;
  }
  const master = state.masterImage ? 'Master: loaded' : 'Master: missing';
  const sources = `Sources: ${state.sourcePhotos.length}/${MAX_SOURCES}`;
  els.uploadStatus.textContent = `${master} | ${sources}`;
}

function fitMaskCanvas() {
  if (!state.masterImage) return;
  const maxW = 1200;
  const maxH = 700;
  const scale = Math.min(maxW / state.masterImage.width, maxH / state.masterImage.height, 1);
  els.maskCanvas.width = Math.round(state.masterImage.width * scale);
  els.maskCanvas.height = Math.round(state.masterImage.height * scale);
  state.mask = new Uint8Array(els.maskCanvas.width * els.maskCanvas.height);
  state.mask.fill(1);
}

function drawMaskPreview() {
  if (!state.masterImage) return;
  maskCtx.clearRect(0, 0, els.maskCanvas.width, els.maskCanvas.height);
  maskCtx.drawImage(state.masterImage, 0, 0, els.maskCanvas.width, els.maskCanvas.height);

  if (!state.mask) return;
  const imgData = maskCtx.getImageData(0, 0, els.maskCanvas.width, els.maskCanvas.height);
  const data = imgData.data;
  for (let i = 0; i < state.mask.length; i++) {
    const m = state.mask[i];
    const p = i * 4;
    if (m === 1) {
      const a = 0.17;
      data[p] = Math.round(data[p] * (1 - a));
      data[p + 1] = Math.round(data[p + 1] * (1 - a) + 255 * a);
      data[p + 2] = Math.round(data[p + 2] * (1 - a));
    } else if (m === 2) {
      const a = 0.24;
      data[p] = Math.round(data[p] * (1 - a) + 255 * a);
      data[p + 1] = Math.round(data[p + 1] * (1 - a));
      data[p + 2] = Math.round(data[p + 2] * (1 - a));
    }
  }
  maskCtx.putImageData(imgData, 0, 0);
}

function paintMask(x, y) {
  const brush = clamp(parseInt(els.brushSize.value, 10) || 24, 4, 180);
  const mode = document.querySelector('input[name="maskMode"]:checked').value;
  const value = mode === 'include' ? 1 : mode === 'exclude' ? 2 : 1;

  for (let py = -brush; py <= brush; py++) {
    for (let px = -brush; px <= brush; px++) {
      if (px * px + py * py > brush * brush) continue;
      const tx = x + px;
      const ty = y + py;
      if (tx < 0 || ty < 0 || tx >= els.maskCanvas.width || ty >= els.maskCanvas.height) continue;
      state.mask[ty * els.maskCanvas.width + tx] = value;
    }
  }
  drawMaskPreview();
}

function getTileStatsFromMaster(srcX, srcY, srcW, srcH, sampleCtx) {
  const block = sampleCtx.getImageData(srcX, srcY, srcW, srcH).data;
  let r = 0, g = 0, b = 0, s = 0, v = 0, n = 0;
  for (let i = 0; i < block.length; i += 16) {
    const rr = block[i];
    const gg = block[i + 1];
    const bb = block[i + 2];
    const hsv = rgbToHsv(rr, gg, bb);
    r += rr;
    g += gg;
    b += bb;
    s += hsv.s;
    v += hsv.v;
    n++;
  }
  return {
    avgColor: [r / n, g / n, b / n],
    saturation: s / n,
    brightness: v / n,
  };
}

function getTileStatsFromMasterMasked(srcX, srcY, srcW, srcH, sampleCtx, outputAllowMask, canvasW, canvasH) {
  const block = sampleCtx.getImageData(srcX, srcY, srcW, srcH).data;
  let r = 0, g = 0, b = 0, s = 0, v = 0, n = 0;
  let i = 0;
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const ox = Math.min(canvasW - 1, srcX + x);
      const oy = Math.min(canvasH - 1, srcY + y);
      const alpha = outputAllowMask[oy * canvasW + ox];
      if (alpha <= 0.02) {
        i += 4;
        continue;
      }
      const rr = block[i];
      const gg = block[i + 1];
      const bb = block[i + 2];
      const hsv = rgbToHsv(rr, gg, bb);
      r += rr * alpha;
      g += gg * alpha;
      b += bb * alpha;
      s += hsv.s * alpha;
      v += hsv.v * alpha;
      n += alpha;
      i += 4;
    }
  }

  if (n === 0) return null;
  return {
    avgColor: [r / n, g / n, b / n],
    saturation: s / n,
    brightness: v / n,
  };
}

function matchScore(tileStats, photo, adjustTolerance) {
  const [tr, tg, tb] = tileStats.avgColor;
  const [pr, pg, pb] = photo.stats.avgColor;
  const colorDist = Math.sqrt((tr - pr) ** 2 + (tg - pg) ** 2 + (tb - pb) ** 2) / 441.67;
  const satDist = Math.abs(tileStats.saturation - photo.stats.saturation);
  const briDist = Math.abs(tileStats.brightness - photo.stats.brightness);
  const raw = colorDist * 0.65 + satDist * 0.2 + briDist * 0.15;
  const adjustmentAllowance = adjustTolerance / 100;
  return Math.max(0, raw - adjustmentAllowance * 0.25);
}

function getProximityPenalty(photo, x, y, w, h, placements) {
  let penalty = 0;
  for (let i = placements.length - 1; i >= 0; i--) {
    const p = placements[i];
    const dx = Math.abs((x + w / 2) - (p.x + p.w / 2));
    const dy = Math.abs((y + h / 2) - (p.y + p.h / 2));
    const adjacentX = dx <= (w + p.w) / 2 + 2;
    const adjacentY = dy <= (h + p.h) / 2 + 2;
    if (p.photoId === photo.id && adjacentX && adjacentY) return Infinity;

    if (p.photoId === photo.id) {
      const nearDist = Math.hypot(dx, dy);
      if (nearDist < Math.max(w, h) * 2.8) penalty += 0.45;
      else if (nearDist < Math.max(w, h) * 4.5) penalty += 0.2;
    }
    if (placements.length - i > 200) break;
  }
  return penalty;
}

function pickPhoto(tileStats, settings, x, y, w, h, placements) {
  if (state.sourcePhotos.length === 0) return null;
  const mode = els.mode.value;
  const matchTolerance = parseInt(els.matchTolerance.value, 10) / 100;
  const adjustTolerance = parseInt(els.adjustTolerance.value, 10);

  let best = null;
  let bestScore = Infinity;

  for (const photo of state.sourcePhotos) {
    const usagePenalty = photo.usedCount * 0.03;
    const proximityPenalty = getProximityPenalty(photo, x, y, w, h, placements);
    if (!Number.isFinite(proximityPenalty)) continue;
    const score = matchScore(tileStats, photo, adjustTolerance) + usagePenalty + proximityPenalty;
    if (score < bestScore) {
      best = photo;
      bestScore = score;
    }
  }

  if (mode === 'best' && bestScore > matchTolerance) {
    return null;
  }

  if (mode === 'all') {
    // Bias toward least-used images while keeping color relevance.
    const ordered = [...state.sourcePhotos].sort((a, b) => {
      const pa = getProximityPenalty(a, x, y, w, h, placements);
      const pb = getProximityPenalty(b, x, y, w, h, placements);
      const sa = (Number.isFinite(pa) ? pa : 999) + matchScore(tileStats, a, adjustTolerance) + a.usedCount * 0.08;
      const sb = (Number.isFinite(pb) ? pb : 999) + matchScore(tileStats, b, adjustTolerance) + b.usedCount * 0.08;
      return sa - sb;
    });
    return ordered.find((p) => Number.isFinite(getProximityPenalty(p, x, y, w, h, placements))) || null;
  }

  return best;
}

function createDecisionMap(settings, masterCtx) {
  const mapW = Math.max(80, Math.round(settings.pxW / 32));
  const mapH = Math.max(80, Math.round(settings.pxH / 32));
  let map = new Uint8Array(mapW * mapH);

  for (let my = 0; my < mapH; my++) {
    for (let mx = 0; mx < mapW; mx++) {
      const x = Math.floor((mx / mapW) * settings.pxW);
      const y = Math.floor((my / mapH) * settings.pxH);
      const w = Math.max(1, Math.floor(settings.pxW / mapW));
      const h = Math.max(1, Math.floor(settings.pxH / mapH));
      let allow = 1;

      if (state.mask) {
        let includeVotes = 0;
        let excludeVotes = 0;
        for (let py = y; py < Math.min(settings.pxH, y + h); py += 3) {
          for (let px = x; px < Math.min(settings.pxW, x + w); px += 3) {
            const sx = Math.floor((px / settings.pxW) * els.maskCanvas.width);
            const sy = Math.floor((py / settings.pxH) * els.maskCanvas.height);
            const val = state.mask[sy * els.maskCanvas.width + sx];
            if (val === 1) includeVotes++;
            else excludeVotes++;
          }
        }
        if (includeVotes > excludeVotes) allow = 1;
        else if (excludeVotes > includeVotes) allow = 0;
      }

      map[my * mapW + mx] = allow;
    }
  }

  return { map, mapW, mapH };
}

function smoothBinaryMap(source, w, h) {
  const out = new Uint8Array(source.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ones = 0;
      let total = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          total++;
          if (source[ny * w + nx] === 1) ones++;
        }
      }
      out[y * w + x] = ones >= Math.ceil(total / 2) ? 1 : 0;
    }
  }
  return out;
}

function mapAllowsMosaic(x, y, w, h, decision) {
  if (!decision) return true;
  return true;
}

function bilinearMaskSample(fx, fy) {
  const w = els.maskCanvas.width;
  const h = els.maskCanvas.height;
  const x0 = clamp(Math.floor(fx), 0, w - 1);
  const y0 = clamp(Math.floor(fy), 0, h - 1);
  const x1 = clamp(x0 + 1, 0, w - 1);
  const y1 = clamp(y0 + 1, 0, h - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const v00 = state.mask[y0 * w + x0] === 1 ? 1 : 0;
  const v10 = state.mask[y0 * w + x1] === 1 ? 1 : 0;
  const v01 = state.mask[y1 * w + x0] === 1 ? 1 : 0;
  const v11 = state.mask[y1 * w + x1] === 1 ? 1 : 0;
  const top = v00 * (1 - tx) + v10 * tx;
  const bottom = v01 * (1 - tx) + v11 * tx;
  return top * (1 - ty) + bottom * ty;
}

function buildOutputAllowMask(settings) {
  const mask = new Float32Array(settings.pxW * settings.pxH);
  for (let y = 0; y < settings.pxH; y++) {
    const sy = (y / settings.pxH) * (els.maskCanvas.height - 1);
    for (let x = 0; x < settings.pxW; x++) {
      const sx = (x / settings.pxW) * (els.maskCanvas.width - 1);
      mask[y * settings.pxW + x] = bilinearMaskSample(sx, sy);
    }
  }
  return mask;
}

function tileHasCoverage(x, y, w, h, allowMask, canvasW, canvasH) {
  const step = Math.max(1, Math.floor(Math.min(w, h) / 8));
  for (let py = y; py < y + h; py += step) {
    for (let px = x; px < x + w; px += step) {
      const ox = Math.min(canvasW - 1, Math.floor(px));
      const oy = Math.min(canvasH - 1, Math.floor(py));
      if (allowMask[oy * canvasW + ox] > 0.08) return true;
    }
  }
  return false;
}

function drawPhotoAdjusted(photo, dx, dy, dw, dh, targetStats, adjustTolerance, outputAllowMask, rotationDeg) {
  const tile = document.createElement('canvas');
  tile.width = Math.max(1, Math.round(dw));
  tile.height = Math.max(1, Math.round(dh));
  const tileCtx = tile.getContext('2d');
  const srcRatio = photo.canvas.width / photo.canvas.height;
  const dstRatio = tile.width / tile.height;
  let sx = 0, sy = 0, sw = photo.canvas.width, sh = photo.canvas.height;
  if (srcRatio > dstRatio) {
    sw = Math.round(photo.canvas.height * dstRatio);
    sx = Math.floor((photo.canvas.width - sw) / 2);
  } else if (srcRatio < dstRatio) {
    sh = Math.round(photo.canvas.width / dstRatio);
    sy = Math.floor((photo.canvas.height - sh) / 2);
  }
  const angleRad = ((Math.random() * 2 - 1) * rotationDeg * Math.PI) / 180;
  tileCtx.save();
  tileCtx.translate(tile.width / 2, tile.height / 2);
  tileCtx.rotate(angleRad);
  tileCtx.drawImage(photo.canvas, sx, sy, sw, sh, -tile.width / 2, -tile.height / 2, tile.width, tile.height);
  tileCtx.restore();
  const imageData = tileCtx.getImageData(0, 0, tile.width, tile.height);
  const data = imageData.data;
  const satDiff = targetStats.saturation - photo.stats.saturation;
  const briDiff = targetStats.brightness - photo.stats.brightness;
  const maxAdj = adjustTolerance / 100;
  const satFactor = clamp(1 + satDiff * 2.5, 1 - maxAdj * 1.4, 1 + maxAdj * 1.6);
  const briFactor = clamp(1 + briDiff * 2.0, 1 - maxAdj * 1.2, 1 + maxAdj * 1.3);
  const target = targetStats.avgColor;
  const source = photo.stats.avgColor;
  const channelGain = [
    clamp(target[0] / Math.max(1, source[0]), 1 - maxAdj, 1 + maxAdj),
    clamp(target[1] / Math.max(1, source[1]), 1 - maxAdj, 1 + maxAdj),
    clamp(target[2] / Math.max(1, source[2]), 1 - maxAdj, 1 + maxAdj),
  ];
  const colorBlend = 0.35 + maxAdj * 0.45;

  for (let i = 0; i < data.length; i += 4) {
    const hsv = rgbToHsv(data[i], data[i + 1], data[i + 2]);
    hsv.s = clamp(hsv.s * satFactor, 0, 1);
    hsv.v = clamp(hsv.v * briFactor, 0, 1);
    const [rr, gg, bb] = hsvToRgb(hsv.h, hsv.s, hsv.v);
    const cr = clamp(rr * channelGain[0], 0, 255);
    const cg = clamp(gg * channelGain[1], 0, 255);
    const cb = clamp(bb * channelGain[2], 0, 255);
    data[i] = Math.round(cr * (1 - colorBlend) + target[0] * colorBlend);
    data[i + 1] = Math.round(cg * (1 - colorBlend) + target[1] * colorBlend);
    data[i + 2] = Math.round(cb * (1 - colorBlend) + target[2] * colorBlend);
    const p = i / 4;
    const localX = p % tile.width;
    const localY = Math.floor(p / tile.width);
    const ox = Math.min(els.outputCanvas.width - 1, Math.floor(dx + localX));
    const oy = Math.min(els.outputCanvas.height - 1, Math.floor(dy + localY));
    const allowedAlpha = outputAllowMask[oy * els.outputCanvas.width + ox];
    data[i + 3] = Math.round(data[i + 3] * allowedAlpha);
  }
  tileCtx.putImageData(imageData, 0, 0);
  outputCtx.drawImage(tile, dx, dy, dw, dh);
}

function getJitteredDrawRect(x, y, w, h, overlapPct) {
  if (overlapPct <= 0) return { dx: x, dy: y, dw: w, dh: h };
  const overlap = overlapPct / 100;
  const dw = w * (1 + overlap);
  const dh = h * (1 + overlap);
  const slackX = dw - w;
  const slackY = dh - h;
  const jitterX = (Math.random() * 2 - 1) * slackX * 0.35;
  const jitterY = (Math.random() * 2 - 1) * slackY * 0.35;
  let dx = x - slackX / 2 + jitterX;
  let dy = y - slackY / 2 + jitterY;
  // Keep original tile footprint fully covered.
  dx = clamp(dx, x - slackX, x);
  dy = clamp(dy, y - slackY, y);
  return { dx, dy, dw, dh };
}

async function generateMosaic() {
  if (!state.masterImage || state.sourcePhotos.length === 0) {
    els.generateStatus.textContent = 'Please load a master image and at least one source photo.';
    return;
  }

  const settings = getSettings();
  els.outputCanvas.width = settings.pxW;
  els.outputCanvas.height = settings.pxH;
  outputCtx.clearRect(0, 0, settings.pxW, settings.pxH);
  outputCtx.drawImage(state.masterImage, 0, 0, settings.pxW, settings.pxH);

  for (const p of state.sourcePhotos) p.usedCount = 0;

  const masterCanvas = document.createElement('canvas');
  masterCanvas.width = settings.pxW;
  masterCanvas.height = settings.pxH;
  const masterCtx = masterCanvas.getContext('2d');
  masterCtx.drawImage(state.masterImage, 0, 0, settings.pxW, settings.pxH);
  const outputAllowMask = buildOutputAllowMask(settings);

  let y = 0;
  let tiles = 0;
  let skipped = 0;
  const adjustTolerance = parseInt(els.adjustTolerance.value, 10);
  const placements = [];

  while (y < settings.pxH) {
    const rowH = settings.vary
      ? Math.round(settings.tileMinPx + Math.random() * (settings.tileMaxPx - settings.tileMinPx))
      : settings.tileMaxPx;
    let x = 0;
    while (x < settings.pxW) {
      const tileW = settings.vary
        ? Math.round(settings.tileMinPx + Math.random() * (settings.tileMaxPx - settings.tileMinPx))
        : settings.tileMaxPx;
      const w = Math.min(tileW, settings.pxW - x);
      const h = Math.min(rowH, settings.pxH - y);

      if (tileHasCoverage(x, y, w, h, outputAllowMask, settings.pxW, settings.pxH)) {
        const tileStats = getTileStatsFromMasterMasked(
          x,
          y,
          w,
          h,
          masterCtx,
          outputAllowMask,
          settings.pxW,
          settings.pxH
        );
        if (!tileStats) {
          x += w;
          continue;
        }
        const photo = pickPhoto(tileStats, settings, x, y, w, h, placements);
        if (photo) {
          const drawRect = getJitteredDrawRect(x, y, w, h, settings.overlapPct);
          drawPhotoAdjusted(
            photo,
            drawRect.dx,
            drawRect.dy,
            drawRect.dw,
            drawRect.dh,
            tileStats,
            adjustTolerance,
            outputAllowMask,
            settings.rotationDeg
          );
          photo.usedCount += 1;
          placements.push({ x: drawRect.dx, y: drawRect.dy, w: drawRect.dw, h: drawRect.dh, photoId: photo.id });
        } else {
          skipped += 1;
        }
      }

      tiles += 1;
      x += w;
    }
    y += Math.min(rowH, settings.pxH - y);
    els.generateStatus.textContent = `Generating... ${Math.round((y / settings.pxH) * 100)}%`;
    await new Promise((r) => setTimeout(r, 0));
  }

  state.generated = els.outputCanvas.toDataURL('image/png');
  els.downloadBtn.disabled = false;

  const used = state.sourcePhotos.filter((p) => p.usedCount > 0);
  const unused = state.sourcePhotos.filter((p) => p.usedCount === 0);
  used.sort((a, b) => b.usedCount - a.usedCount);

  els.generateStatus.textContent = `Done. ${tiles.toLocaleString()} tiles processed (${skipped.toLocaleString()} tiles left as master).`;
  els.report.textContent = [
    `Used photos: ${used.length}/${state.sourcePhotos.length}`,
    `Unused photos: ${unused.length}`,
    '',
    'Top used photos:',
    ...used.slice(0, 20).map((p) => ` - ${p.name}: ${p.usedCount} tiles`),
    '',
    unused.length ? `Unused file names:\n${unused.map((p) => ` - ${p.name}`).join('\n')}` : 'All photos were used at least once.'
  ].join('\n');
}

function downloadOutput() {
  if (!state.generated) return;
  const a = document.createElement('a');
  a.href = state.generated;
  a.download = 'mosaic-output.png';
  a.click();
}

function initMaskPainting() {
  let painting = false;
  let lastPoint = null;

  const toLocal = (e) => {
    const rect = els.maskCanvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * els.maskCanvas.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * els.maskCanvas.height);
    return { x, y };
  };

  els.maskCanvas.addEventListener('pointerdown', (e) => {
    if (!state.mask) return;
    els.maskCanvas.setPointerCapture(e.pointerId);
    painting = true;
    const { x, y } = toLocal(e);
    lastPoint = { x, y };
    paintMask(x, y);
  });

  els.maskCanvas.addEventListener('pointermove', (e) => {
    if (!painting || !state.mask) return;
    const { x, y } = toLocal(e);
    if (lastPoint) {
      const dx = x - lastPoint.x;
      const dy = y - lastPoint.y;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const steps = Math.max(1, Math.ceil(dist / 2));
      for (let i = 1; i <= steps; i++) {
        const ix = Math.round(lastPoint.x + (dx * i) / steps);
        const iy = Math.round(lastPoint.y + (dy * i) / steps);
        paintMask(ix, iy);
      }
    } else {
      paintMask(x, y);
    }
    lastPoint = { x, y };
  });

  window.addEventListener('pointerup', () => {
    painting = false;
    lastPoint = null;
  });
}

els.printPreset.addEventListener('change', updatePrintPreset);
[els.dpi, els.tileMin, els.tileMax, els.varyTileSize, els.overlapPct, els.rotationDeg].forEach((el) => {
  el.addEventListener('input', updateResolutionHint);
});
els.printWidth.addEventListener('input', () => {
  if (els.lockAspect.checked && state.masterImage) {
    const ratio = state.masterImage.width / state.masterImage.height;
    const w = parseFloat(els.printWidth.value) || 1;
    els.printHeight.value = (w / ratio).toFixed(1);
  }
  updateResolutionHint();
});
els.printHeight.addEventListener('input', () => {
  if (els.lockAspect.checked && state.masterImage) {
    const ratio = state.masterImage.width / state.masterImage.height;
    const h = parseFloat(els.printHeight.value) || 1;
    els.printWidth.value = (h * ratio).toFixed(1);
  }
  updateResolutionHint();
});
els.lockAspect.addEventListener('input', () => {
  if (els.lockAspect.checked && els.printPreset.value !== 'custom') {
    applyProportionalPrintSize(parseFloat(els.printPreset.value));
  }
  updateResolutionHint();
});
[
  els.colorToolEnabled,
  els.colorToolMode,
  els.excludeColor,
  els.excludeTolerance,
].forEach((el) => {
  el.addEventListener('input', applyColorToolToMask);
});
els.masterInput.addEventListener('change', () => handleMasterUpload().catch(console.error));
els.sourcesInput.addEventListener('change', () => handleSourceUpload().catch(console.error));
els.generateBtn.addEventListener('click', () => generateMosaic().catch(console.error));
els.downloadBtn.addEventListener('click', downloadOutput);
els.clearMask.addEventListener('click', () => {
  if (!state.mask) return;
  state.mask.fill(1);
  drawMaskPreview();
});
els.smoothMaskBtn.addEventListener('click', smoothMaskIslands);
els.smoothBoundaryBtn.addEventListener('click', smoothMaskBoundaries);

initMaskPainting();
updateResolutionHint();
updateStatus();
