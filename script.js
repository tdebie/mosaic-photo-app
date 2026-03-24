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

function maskAllowsMosaic(x, y, w, h) {
  if (!state.mask) return true;
  let includeVotes = 0;
  let excludeVotes = 0;
  const sx = Math.max(0, Math.floor(x));
  const sy = Math.max(0, Math.floor(y));
  const ex = Math.min(els.outputCanvas.width - 1, Math.floor(x + w));
  const ey = Math.min(els.outputCanvas.height - 1, Math.floor(y + h));

  for (let py = sy; py < ey; py += 4) {
    for (let px = sx; px < ex; px += 4) {
      const mx = Math.floor((px / els.outputCanvas.width) * els.maskCanvas.width);
      const my = Math.floor((py / els.outputCanvas.height) * els.maskCanvas.height);
      const val = state.mask[my * els.maskCanvas.width + mx];
      if (val === 1) includeVotes++;
      if (val === 2) excludeVotes++;
    }
  }

  if (includeVotes === 0 && excludeVotes === 0) return true;
  return includeVotes >= excludeVotes;
}

function drawPhotoAdjusted(photo, dx, dy, dw, dh, targetStats, adjustTolerance) {
  outputCtx.save();
  outputCtx.drawImage(photo.canvas, dx, dy, dw, dh);

  const satDiff = targetStats.saturation - photo.stats.saturation;
  const briDiff = targetStats.brightness - photo.stats.brightness;
  const maxAdj = adjustTolerance / 100;
  const satAdj = clamp(satDiff, -maxAdj, maxAdj);
  const briAdj = clamp(briDiff, -maxAdj, maxAdj);

  outputCtx.fillStyle = briAdj > 0 ? `rgba(255,255,255,${briAdj * 0.55})` : `rgba(0,0,0,${Math.abs(briAdj) * 0.6})`;
  outputCtx.fillRect(dx, dy, dw, dh);

  if (Math.abs(satAdj) > 0.01) {
    const overlay = satAdj > 0
      ? `rgba(${targetStats.avgColor[0]},${targetStats.avgColor[1]},${targetStats.avgColor[2]},${Math.abs(satAdj) * 0.25})`
      : `rgba(128,128,128,${Math.abs(satAdj) * 0.22})`;
    outputCtx.fillStyle = overlay;
    outputCtx.fillRect(dx, dy, dw, dh);
  }
  outputCtx.restore();
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

      if (maskAllowsMosaic(x, y, w, h)) {
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

  const toLocal = (e) => {
    const rect = els.maskCanvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * els.maskCanvas.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * els.maskCanvas.height);
    return { x, y };
  };

  els.maskCanvas.addEventListener('pointerdown', (e) => {
    if (!state.mask) return;
    painting = true;
    const { x, y } = toLocal(e);
    paintMask(x, y);
  });

  els.maskCanvas.addEventListener('pointermove', (e) => {
    if (!painting || !state.mask) return;
    const { x, y } = toLocal(e);
    paintMask(x, y);
  });

  window.addEventListener('pointerup', () => {
    painting = false;
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
