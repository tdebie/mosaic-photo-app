const MAX_SOURCES = 200;

const state = {
  masterImage: null,
  sourcePhotos: [],
  mask: null,
  generated: null,
};

const els = {
  masterInput: document.getElementById('masterInput'),
  sourcesInput: document.getElementById('sourcesInput'),
  uploadStatus: document.getElementById('uploadStatus'),
  printPreset: document.getElementById('printPreset'),
  printWidth: document.getElementById('printWidth'),
  printHeight: document.getElementById('printHeight'),
  dpi: document.getElementById('dpi'),
  tileMin: document.getElementById('tileMin'),
  tileMax: document.getElementById('tileMax'),
  varyTileSize: document.getElementById('varyTileSize'),
  resolutionHint: document.getElementById('resolutionHint'),
  mode: document.getElementById('mode'),
  matchTolerance: document.getElementById('matchTolerance'),
  adjustTolerance: document.getElementById('adjustTolerance'),
  excludeColorEnabled: document.getElementById('excludeColorEnabled'),
  excludeColor: document.getElementById('excludeColor'),
  excludeTolerance: document.getElementById('excludeTolerance'),
  patchBlend: document.getElementById('patchBlend'),
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
  const widthIn = parseFloat(els.printWidth.value) || 16;
  const heightIn = parseFloat(els.printHeight.value) || 20;
  const dpi = parseInt(els.dpi.value, 10) || 300;
  const tileMinIn = parseFloat(els.tileMin.value) || 0.5;
  const tileMaxIn = Math.max(tileMinIn, parseFloat(els.tileMax.value) || 1);
  const vary = els.varyTileSize.checked;
  const pxW = Math.round(widthIn * dpi);
  const pxH = Math.round(heightIn * dpi);
  const tileMinPx = Math.max(8, Math.round(tileMinIn * dpi));
  const tileMaxPx = Math.max(tileMinPx, Math.round(tileMaxIn * dpi));
  return { widthIn, heightIn, dpi, tileMinIn, tileMaxIn, pxW, pxH, tileMinPx, tileMaxPx, vary };
}

function updatePrintPreset() {
  if (els.printPreset.value === 'custom') return;
  const [w, h] = els.printPreset.value.split('x').map(Number);
  els.printWidth.value = w;
  els.printHeight.value = h;
  updateResolutionHint();
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
  els.resolutionHint.textContent = `Estimated ${tiles.toLocaleString()} mosaic tiles. Recommended max source downsample: longest edge ≈ ${maxRes}px.`;
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
  drawMaskPreview();
  updateStatus();
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
    if (m === 0) continue;
    const p = i * 4;
    if (m === 1) {
      data[p] = 0;
      data[p + 1] = Math.min(255, data[p + 1] + 80);
      data[p + 2] = 0;
    } else if (m === 2) {
      data[p] = Math.min(255, data[p] + 120);
      data[p + 1] = 0;
      data[p + 2] = 0;
    }
  }
  maskCtx.putImageData(imgData, 0, 0);
}

function paintMask(x, y) {
  const brush = clamp(parseInt(els.brushSize.value, 10) || 24, 4, 180);
  const mode = document.querySelector('input[name="maskMode"]:checked').value;
  const value = mode === 'include' ? 1 : mode === 'exclude' ? 2 : 0;

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

function pickPhoto(tileStats, settings) {
  if (state.sourcePhotos.length === 0) return null;
  const mode = els.mode.value;
  const matchTolerance = parseInt(els.matchTolerance.value, 10) / 100;
  const adjustTolerance = parseInt(els.adjustTolerance.value, 10);

  let best = null;
  let bestScore = Infinity;

  for (const photo of state.sourcePhotos) {
    const usagePenalty = photo.usedCount * 0.03;
    const score = matchScore(tileStats, photo, adjustTolerance) + usagePenalty;
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
      const sa = matchScore(tileStats, a, adjustTolerance) + a.usedCount * 0.08;
      const sb = matchScore(tileStats, b, adjustTolerance) + b.usedCount * 0.08;
      return sa - sb;
    });
    return ordered[0];
  }

  return best;
}

function createDecisionMap(settings, masterCtx) {
  const mapW = Math.max(80, Math.round(settings.pxW / 32));
  const mapH = Math.max(80, Math.round(settings.pxH / 32));
  let map = new Uint8Array(mapW * mapH);
  const excludeEnabled = els.excludeColorEnabled.checked;
  const excludedColor = hexToRgb(els.excludeColor.value);
  const excludeTolerance = parseInt(els.excludeTolerance.value, 10);

  for (let my = 0; my < mapH; my++) {
    for (let mx = 0; mx < mapW; mx++) {
      const x = Math.floor((mx / mapW) * settings.pxW);
      const y = Math.floor((my / mapH) * settings.pxH);
      const w = Math.max(1, Math.floor(settings.pxW / mapW));
      const h = Math.max(1, Math.floor(settings.pxH / mapH));
      const tileStats = getTileStatsFromMaster(x, y, w, h, masterCtx);
      let allow = 1;
      if (excludeEnabled && colorDistance(tileStats.avgColor, excludedColor) <= excludeTolerance) {
        allow = 0;
      }

      if (state.mask) {
        let includeVotes = 0;
        let excludeVotes = 0;
        for (let py = y; py < Math.min(settings.pxH, y + h); py += 3) {
          for (let px = x; px < Math.min(settings.pxW, x + w); px += 3) {
            const sx = Math.floor((px / settings.pxW) * els.maskCanvas.width);
            const sy = Math.floor((py / settings.pxH) * els.maskCanvas.height);
            const val = state.mask[sy * els.maskCanvas.width + sx];
            if (val === 1) includeVotes++;
            if (val === 2) excludeVotes++;
          }
        }
        if (includeVotes > excludeVotes) allow = 1;
        else if (excludeVotes > includeVotes) allow = 0;
      }

      map[my * mapW + mx] = allow;
    }
  }

  const blendPasses = parseInt(els.patchBlend.value, 10);
  for (let pass = 0; pass < blendPasses; pass++) {
    map = smoothBinaryMap(map, mapW, mapH);
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
  let includeVotes = 0;
  let excludeVotes = 0;

  const sx = Math.max(0, Math.floor((x / els.outputCanvas.width) * decision.mapW));
  const sy = Math.max(0, Math.floor((y / els.outputCanvas.height) * decision.mapH));
  const ex = Math.min(decision.mapW - 1, Math.floor(((x + w) / els.outputCanvas.width) * decision.mapW));
  const ey = Math.min(decision.mapH - 1, Math.floor(((y + h) / els.outputCanvas.height) * decision.mapH));

  for (let py = sy; py <= ey; py++) {
    for (let px = sx; px <= ex; px++) {
      const val = decision.map[py * decision.mapW + px];
      if (val === 1) includeVotes++;
      else excludeVotes++;
    }
  }
  return includeVotes >= excludeVotes;
}

function drawPhotoAdjusted(photo, dx, dy, dw, dh, targetStats, adjustTolerance) {
  const tile = document.createElement('canvas');
  tile.width = Math.max(1, Math.round(dw));
  tile.height = Math.max(1, Math.round(dh));
  const tileCtx = tile.getContext('2d');
  tileCtx.drawImage(photo.canvas, 0, 0, tile.width, tile.height);
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
  }
  tileCtx.putImageData(imageData, 0, 0);
  outputCtx.drawImage(tile, dx, dy, dw, dh);
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
  const decision = createDecisionMap(settings, masterCtx);

  let y = 0;
  let tiles = 0;
  let skipped = 0;
  const adjustTolerance = parseInt(els.adjustTolerance.value, 10);

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

      if (mapAllowsMosaic(x, y, w, h, decision)) {
        const tileStats = getTileStatsFromMaster(x, y, w, h, masterCtx);
        const photo = pickPhoto(tileStats, settings);
        if (photo) {
          drawPhotoAdjusted(photo, x, y, w, h, tileStats, adjustTolerance);
          photo.usedCount += 1;
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
[els.printWidth, els.printHeight, els.dpi, els.tileMin, els.tileMax, els.varyTileSize].forEach((el) => {
  el.addEventListener('input', updateResolutionHint);
});
els.masterInput.addEventListener('change', () => handleMasterUpload().catch(console.error));
els.sourcesInput.addEventListener('change', () => handleSourceUpload().catch(console.error));
els.generateBtn.addEventListener('click', () => generateMosaic().catch(console.error));
els.downloadBtn.addEventListener('click', downloadOutput);
els.clearMask.addEventListener('click', () => {
  if (!state.mask) return;
  state.mask.fill(0);
  drawMaskPreview();
});

initMaskPainting();
updateResolutionHint();
updateStatus();
