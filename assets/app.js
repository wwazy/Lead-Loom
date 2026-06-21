/* Bead Loom · core logic
   Data model: each pattern carries its own `colors` table; grid holds indices into it.
   This lets the editor add custom colors and move emptied colors into a history list. */
const palettes = {
  MARD: [
    ['M01', '瓷白', '#f7f1e6'], ['M08', '蜜橙', '#e7a336'], ['M14', '胭脂红', '#b84a3a'], ['M22', '织蓝', '#456da3'],
    ['M31', '青瓷绿', '#8fbf9f'], ['M43', '紫藤', '#7f668f'], ['M52', '榛棕', '#7a523b'], ['M66', '墨黑', '#25211c']
  ],
  Artkal: [['A01','White','#f7f1e6'],['A18','Orange','#f08a2e'],['A29','Red','#c83e36'],['A45','Blue','#3f6fb1'],['A61','Green','#6eb37d'],['A77','Purple','#7554a1'],['A89','Brown','#7c5136'],['A99','Black','#222222']],
  Hama: [['H01','White','#f8f4ec'],['H04','Orange','#ec9c33'],['H05','Red','#b83b38'],['H09','Blue','#4266a9'],['H10','Green','#78ad72'],['H20','Purple','#80649c'],['H21','Brown','#7f563d'],['H18','Black','#26231f']],
  Perler: [['P80','White','#f5efe5'],['P83','Butterscotch','#e4a13e'],['P90','Rust','#a94438'],['P96','Denim','#42679d'],['P74','Sage','#91b889'],['P41','Plum','#826286'],['P12','Tan','#8d603f'],['P18','Black','#24211f']],
  Nabbi: [['N01','White','#fbf2e7'],['N06','Orange','#e99f34'],['N11','Red','#bd4638'],['N26','Blue','#496fa7'],['N36','Green','#84b980'],['N44','Violet','#836396'],['N52','Brown','#79513b'],['N60','Black','#25211c']]
};

const palette = name => (palettes[name] || palettes.MARD).map(([code, n, color]) => ({ code, name: n, color }));
// merge large external libraries (assets/palettes.js) if present
if (typeof window !== 'undefined' && window.BEAD_PALETTES) Object.assign(palettes, window.BEAD_PALETTES);
// human-readable names for the palette <select> and library tags
const paletteLabels = {
  MARD221: 'MARD 标准 221', MARD291: 'MARD 全色 291', Artkal176: 'Artkal',
  MARD: 'MARD', Artkal: 'Artkal 基础', Hama: 'Hama', Perler: 'Perler', Nabbi: 'Nabbi'
};
const paletteLabel = name => paletteLabels[name] || name;
// active color-matching tier + sampling mode (set from the convert page controls)
let matchQuality = 'default'; // 'default'=CIE76 | 'fast'=CIE94 | 'quality'=CIEDE2000
let sampleMode = 'default';   // 'default' | 'dominant' | 'smooth'
const storageKey = 'beadLoomStateV3';
const page = document.body.dataset.page;
const maxPixels = 9216;
const defaultState = {
  paletteName: 'MARD',
  selectedColor: 2,
  selectedPixels: [],
  reserve: 10,
  current: null,
  projects: []
};
let state = loadState();
let sourceImage = null;
let customWatermark = null;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    const merged = saved ? { ...structuredClone(defaultState), ...saved } : seedState();
    merged.projects.forEach(migratePattern);
    if (merged.current) migratePattern(merged.current);
    else merged.current = newPattern('当前图案', 48, 48, makeSeedGrid(48, 48, merged.paletteName), merged.paletteName);
    return merged;
  } catch {
    return seedState();
  }
}
function saveState() {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); }
  catch { /* quota: keep working in-memory */ }
}
function seedState() {
  const seeded = structuredClone(defaultState);
  seeded.current = newPattern('当前图案', 48, 48, makeSeedGrid(48, 48, 'MARD'), 'MARD');
  seeded.projects = [
    newPattern('樱桃钥匙扣', 32, 32, makeSeedGrid(32, 32, 'MARD', 1), 'MARD'),
    newPattern('蓝色小屋杯垫', 48, 32, makeSeedGrid(48, 32, 'MARD', 4), 'MARD'),
    newPattern('像素猫挂画', 40, 40, makeSeedGrid(40, 40, 'MARD', 7), 'MARD')
  ];
  return seeded;
}

/* Build a pattern object whose colors table is a copy of the chosen palette.
   grid indices refer to `colors`, not the global palette. */
function newPattern(name, width, height, grid, paletteName = 'MARD') {
  const colors = palette(paletteName).map(c => ({ ...c }));
  const p = {
    id: crypto.randomUUID(), name, width, height,
    grid: grid.slice(), paletteName, colors,
    historyColors: [], thumbnail: '',
    history: [], historyIndex: -1
  };
  pushHistory(p, true);
  updateThumbnail(p);
  return p;
}

/* Older saved data used global-palette indices and no colors table. */
function migratePattern(p) {
  if (!p) return;
  if (!Array.isArray(p.colors) || !p.colors.length) p.colors = palette(p.paletteName || 'MARD').map(c => ({ ...c }));
  if (!Array.isArray(p.historyColors)) p.historyColors = [];
  if (!Array.isArray(p.history)) { p.history = []; p.historyIndex = -1; pushHistory(p, true); }
  if (typeof p.historyIndex !== 'number') p.historyIndex = p.history.length - 1;
  if (!p.thumbnail) updateThumbnail(p);
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value))); }
function toast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
}
function hexRgb(hex) {
  const m = (hex || '#000000').replace('#', '').match(/.{1,2}/g) || ['0', '0', '0'];
  return m.slice(0, 3).map(x => parseInt(x.padEnd(2, x), 16));
}
function rgbHex(r, g, b) {
  return '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}
/* nearest index inside an arbitrary colors table */
function nearestInColors(r, g, b, colors) {
  let best = 0, bestDistance = Infinity;
  colors.forEach((item, index) => {
    const [cr, cg, cb] = hexRgb(item.color);
    const distance = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (distance < bestDistance) { best = index; bestDistance = distance; }
  });
  return best;
}
function nearestColor(r, g, b, paletteName = state.paletteName) {
  return nearestInColors(r, g, b, palette(paletteName));
}
function makeSeedGrid(width, height, paletteName = state.paletteName, offset = 0) {
  const len = palette(paletteName).length;
  return Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const wave = Math.sin((x + offset) / 3.4) + Math.cos((y + offset) / 4.2) + Math.sin((x + y) / 7);
    return Math.abs(Math.round(wave * 2 + x / width * 3 + y / height * 2)) % len;
  });
}

function smartSize(width = 1, height = 1) {
  const ratio = width / height;
  const target = ratio > 1.4 || ratio < .72 ? 2800 : 2304;
  let w = Math.round(Math.sqrt(target * ratio));
  let h = Math.round(w / ratio);
  w = clamp(w, 24, 72);
  h = clamp(h, 24, 72);
  while (w * h > 3600) { w -= 1; h = Math.max(12, Math.round(w / ratio)); }
  return { width: w, height: h };
}
function sizeFromResolution(total, ratio = 1) {
  const safeTotal = clamp(total, 144, maxPixels);
  let width = Math.round(Math.sqrt(safeTotal * ratio));
  let height = Math.round(width / ratio);
  width = clamp(width, 12, 96);
  height = clamp(height, 12, 96);
  while (width * height > maxPixels) ratio >= 1 ? width-- : height--;
  return { width, height };
}

/* History: snapshot grid + colors + historyColors so undo/redo restores everything. */
function pushHistory(pattern, reset = false) {
  if (reset) { pattern.history = []; pattern.historyIndex = -1; }
  if (pattern.historyIndex < pattern.history.length - 1) {
    pattern.history = pattern.history.slice(0, pattern.historyIndex + 1);
  }
  pattern.history.push({
    grid: pattern.grid.slice(),
    colors: pattern.colors.map(c => ({ ...c })),
    historyColors: pattern.historyColors.map(c => ({ ...c }))
  });
  if (pattern.history.length > 120) pattern.history.shift();
  pattern.historyIndex = pattern.history.length - 1;
}
function applySnapshot(pattern, snap) {
  pattern.grid = snap.grid.slice();
  pattern.colors = snap.colors.map(c => ({ ...c }));
  pattern.historyColors = snap.historyColors.map(c => ({ ...c }));
}
function canUndo(pattern) { return pattern.historyIndex > 0; }
function canRedo(pattern) { return pattern.historyIndex < pattern.history.length - 1; }
function undo(pattern) {
  if (!canUndo(pattern)) return false;
  pattern.historyIndex -= 1;
  applySnapshot(pattern, pattern.history[pattern.historyIndex]);
  return true;
}
function redo(pattern) {
  if (!canRedo(pattern)) return false;
  pattern.historyIndex += 1;
  applySnapshot(pattern, pattern.history[pattern.historyIndex]);
  return true;
}

/* Find or add a color in the pattern's table; revives from historyColors when matched. */
function ensureColor(pattern, hex, codeHint) {
  hex = hex.toLowerCase();
  let idx = pattern.colors.findIndex(c => c.color.toLowerCase() === hex);
  if (idx >= 0) return idx;
  const revivedAt = pattern.historyColors.findIndex(c => c.color.toLowerCase() === hex);
  let entry;
  if (revivedAt >= 0) { entry = pattern.historyColors.splice(revivedAt, 1)[0]; }
  else {
    const [r, g, b] = hexRgb(hex);
    const base = palette(pattern.paletteName)[nearestColor(r, g, b, pattern.paletteName)];
    entry = { code: codeHint || `${base.code}+`, name: base.name, color: hex };
  }
  pattern.colors.push(entry);
  return pattern.colors.length - 1;
}
/* Ensure the pattern has a transparent swatch and return its index. Transparent
   beads render as a checkerboard and are excluded from all bead counts. */
function ensureTransparent(pattern) {
  let idx = pattern.colors.findIndex(c => c.transparent);
  if (idx >= 0) return idx;
  pattern.colors.push({ code: '透明', name: '透明', color: '#00000000', transparent: true });
  return pattern.colors.length - 1;
}
/* Most common color along the pattern border — a good guess for the background. */
function detectBackgroundColor(pattern) {
  const { width, height, grid } = pattern;
  if (!grid.length) return -1;
  const tally = {};
  const add = i => { const v = grid[i]; if (!pattern.colors[v]?.transparent) tally[v] = (tally[v] || 0) + 1; };
  for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { add(y * width); add(y * width + width - 1); }
  let best = -1, bestN = 0;
  for (const k in tally) if (tally[k] > bestN) { bestN = tally[k]; best = Number(k); }
  return best;
}
/* After edits, move any color no longer present on the grid into historyColors. */
function reconcileColors(pattern) {
  const used = new Set(pattern.grid);
  for (let i = pattern.colors.length - 1; i >= 0; i--) {
    if (!used.has(i)) {
      if (pattern.colors[i].transparent) continue; // keep the transparent swatch available
      const removed = pattern.colors[i];
      // remap grid indices above i
      pattern.grid = pattern.grid.map(v => v > i ? v - 1 : v);
      pattern.colors.splice(i, 1);
      if (!pattern.historyColors.some(c => c.color.toLowerCase() === removed.color.toLowerCase())) {
        pattern.historyColors.push(removed);
      }
    }
  }
}

function counts(grid, colors) {
  const total = Array(colors.length).fill(0);
  grid.forEach(index => { if (index < total.length) total[index]++; });
  return total;
}
/* Aggregate usage across all projects keyed by color code (+name). Transparent
   beads are not real beads, so they are excluded from inventory totals. */
function aggregateInventory() {
  const map = new Map();
  state.projects.forEach(project => {
    const c = counts(project.grid, project.colors);
    project.colors.forEach((col, i) => {
      if (!c[i] || col.transparent) return;
      const key = col.code + '|' + col.color.toLowerCase();
      const row = map.get(key) || { code: col.code, name: col.name, color: col.color, count: 0 };
      row.count += c[i];
      map.set(key, row);
    });
  });
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/* generateGridFromImage: produces a grid against an arbitrary colors table.
   For photo conversion we pass the palette table. `strongCast` enables the
   aggressive low-quality-image color correction. */
function generateGridFromImage(image, width, height, colors, method, crop = null, strongCast = false) {
  if (method === 'crisp' || method === undefined) return generateGridCrisp(image, width, height, colors, crop, strongCast, sampleMode);
  if (method === 'crisp8') return generateGridCrispRedmean(image, width, height, colors, crop, strongCast);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = method !== 'nearest' && method !== 'pixel';
  if (crop) ctx.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
  else ctx.drawImage(image, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  correctColorCast(data, strongCast);
  const grid = [];
  let er = Array(width + 1).fill(0), eg = Array(width + 1).fill(0), eb = Array(width + 1).fill(0);
  for (let y = 0; y < height; y++) {
    const ner = Array(width + 1).fill(0), neg = Array(width + 1).fill(0), neb = Array(width + 1).fill(0);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let r = data[i] + er[x], g = data[i + 1] + eg[x], b = data[i + 2] + eb[x];
      if (method === 'contrast') { r = (r - 128) * 1.18 + 128; g = (g - 128) * 1.18 + 128; b = (b - 128) * 1.18 + 128; }
      if (method === 'soft') { r = r * .94 + 12; g = g * .94 + 12; b = b * .94 + 12; }
      if (method === 'poster') { r = Math.round(r / 48) * 48; g = Math.round(g / 48) * 48; b = Math.round(b / 48) * 48; }
      const colorIndex = nearestPerceptual(r, g, b, colors);
      grid.push(colorIndex);
      if (method === 'dither') {
        const [cr, cg, cb] = hexRgb(colors[colorIndex].color);
        er[x + 1] += (r - cr) * 7 / 16; eg[x + 1] += (g - cg) * 7 / 16; eb[x + 1] += (b - cb) * 7 / 16;
        ner[x] += (r - cr) * 5 / 16; neg[x] += (g - cg) * 5 / 16; neb[x] += (b - cb) * 5 / 16;
        ner[x + 1] += (r - cr) * 1 / 16; neg[x + 1] += (g - cg) * 1 / 16; neb[x + 1] += (b - cb) * 1 / 16;
      }
    }
    er = ner; eg = neg; eb = neb;
  }
  return grid;
}

/* "清晰" sampler (default). Crisp edges, no fabricated in-between hues.
   1) Supersample: render the (cropped) image at ss× the target so each bead cell
      covers ss×ss source sub-pixels.
   2) Mode-quantize: map every sub-pixel to its nearest palette color FIRST, then
      pick the majority palette index for the cell. Because we never average raw
      RGB across an edge, no muddy intermediate colors (e.g. green between red &
      blue) are ever produced. Ties break toward the color closest to the cell mean.
   3) Light saturation lift on the cell mean improves vividness before voting.
   4) Majority denoise removes isolated single-bead specks for cleaner outlines. */
function generateGridCrisp(image, width, height, colors, crop = null, strongCast = false, mode = 'default') {
  const ss = clamp(Math.round(720 / Math.max(width, height)), 2, 4); // sub-pixels per cell edge
  const sw = width * ss, sh = height * ss;
  const canvas = document.createElement('canvas');
  canvas.width = sw; canvas.height = sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (crop) ctx.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, sw, sh);
  else ctx.drawImage(image, 0, 0, sw, sh);
  const data = ctx.getImageData(0, 0, sw, sh).data;
  correctColorCast(data, strongCast); // neutralize green/other casts common in re-compressed web images
  const grid = new Array(width * height);
  const votes = new Array(colors.length);
  for (let cy = 0; cy < height; cy++) for (let cx = 0; cx < width; cx++) {
    votes.fill(0);
    let mr = 0, mg = 0, mb = 0, n = 0;
    // tally exact sub-pixel colors for the 'dominant' mode
    const freq = mode === 'dominant' ? new Map() : null;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const px = cx * ss + sx, py = cy * ss + sy;
      const i = (py * sw + px) * 4;
      let r = data[i], g = data[i + 1], b = data[i + 2];
      mr += r; mg += g; mb += b; n++;
      if (freq) { const key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3); freq.set(key, (freq.get(key) || 0) + 1); }
      // mild saturation lift around luma to keep colors vivid, not washed out
      const luma = r * .299 + g * .587 + b * .114;
      r = clamp(luma + (r - luma) * 1.18, 0, 255);
      g = clamp(luma + (g - luma) * 1.18, 0, 255);
      b = clamp(luma + (b - luma) * 1.18, 0, 255);
      votes[nearestPerceptual(r, g, b, colors)]++;
    }
    mr /= n; mg /= n; mb /= n;
    if (mode === 'smooth') {
      // match the cell average once — softer, fewer speckles in gradients
      grid[cy * width + cx] = nearestPerceptual(mr, mg, mb, colors);
    } else if (mode === 'dominant') {
      // match the single most frequent sub-pixel color — cleanest flat blocks
      let domKey = 0, domN = -1;
      freq.forEach((c, k) => { if (c > domN) { domN = c; domKey = k; } });
      const r = ((domKey >> 10) & 31) << 3, g = ((domKey >> 5) & 31) << 3, b = (domKey & 31) << 3;
      grid[cy * width + cx] = nearestPerceptual(r, g, b, colors);
    } else {
      // default: majority vote, ties broken toward the cell mean (active metric)
      const meanLab = rgbToLab(mr, mg, mb);
      let best = 0, bestVotes = -1, bestDist = Infinity;
      for (let k = 0; k < colors.length; k++) {
        if (!votes[k]) continue;
        const dist = activeLabDistance(meanLab, labOf(colors[k].color));
        if (votes[k] > bestVotes || (votes[k] === bestVotes && dist < bestDist)) { best = k; bestVotes = votes[k]; bestDist = dist; }
      }
      grid[cy * width + cx] = best;
    }
  }
  return denoiseGrid(grid, width, height);
}

/* "清晰（次推荐）": the v8 sampler preserved verbatim — redmean matching, redmean
   tie-break, and the original 4-neighbour orthogonal denoise. Kept as an option
   because some images quantize more pleasingly under the simpler RGB metric. */
function generateGridCrispRedmean(image, width, height, colors, crop = null, strongCast = false) {
  const ss = clamp(Math.round(720 / Math.max(width, height)), 2, 4);
  const sw = width * ss, sh = height * ss;
  const canvas = document.createElement('canvas');
  canvas.width = sw; canvas.height = sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  if (crop) ctx.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, sw, sh);
  else ctx.drawImage(image, 0, 0, sw, sh);
  const data = ctx.getImageData(0, 0, sw, sh).data;
  correctColorCast(data, strongCast);
  const nearestRM = (r, g, b) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < colors.length; i++) {
      if (colors[i].transparent) continue;
      const [cr, cg, cb] = hexRgb(colors[i].color);
      const d = redmean(r, g, b, cr, cg, cb);
      if (d < bd) { best = i; bd = d; }
    }
    return best;
  };
  const grid = new Array(width * height);
  const votes = new Array(colors.length);
  for (let cy = 0; cy < height; cy++) for (let cx = 0; cx < width; cx++) {
    votes.fill(0);
    let mr = 0, mg = 0, mb = 0, n = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const px = cx * ss + sx, py = cy * ss + sy, i = (py * sw + px) * 4;
      let r = data[i], g = data[i + 1], b = data[i + 2];
      mr += r; mg += g; mb += b; n++;
      const luma = r * .299 + g * .587 + b * .114;
      r = clamp(luma + (r - luma) * 1.18, 0, 255);
      g = clamp(luma + (g - luma) * 1.18, 0, 255);
      b = clamp(luma + (b - luma) * 1.18, 0, 255);
      votes[nearestRM(r, g, b)]++;
    }
    mr /= n; mg /= n; mb /= n;
    let best = 0, bestVotes = -1, bestDist = Infinity;
    for (let k = 0; k < colors.length; k++) {
      if (!votes[k]) continue;
      const [pr, pg, pb] = hexRgb(colors[k].color);
      const dist = redmean(mr, mg, mb, pr, pg, pb);
      if (votes[k] > bestVotes || (votes[k] === bestVotes && dist < bestDist)) { best = k; bestVotes = votes[k]; bestDist = dist; }
    }
    grid[cy * width + cx] = best;
  }
  return denoiseGridOrthogonal(grid, width, height);
}
/* v8 denoise: 4-neighbour orthogonal speck removal (kept for crisp8 parity). */
function denoiseGridOrthogonal(grid, width, height) {
  const out = grid.slice();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    const up = y > 0 ? grid[i - width] : -1;
    const dn = y < height - 1 ? grid[i + width] : -1;
    const lf = x > 0 ? grid[i - 1] : -1;
    const rt = x < width - 1 ? grid[i + 1] : -1;
    const neigh = [up, dn, lf, rt].filter(v => v >= 0);
    if (neigh.length >= 3 && neigh.every(v => v === neigh[0]) && grid[i] !== neigh[0]) out[i] = neigh[0];
  }
  return out;
}

/* Gray-world white balance: re-compressed web images often carry a global green
   (or other) cast that drags warm browns toward sage-green. Assume the scene
   average should be roughly neutral and rescale each channel toward that average.
   `strong` mode (the low-quality toggle) applies a fuller correction plus an
   extra green-specific knockdown, since web JPEGs most often skew green. */
function correctColorCast(data, strong = false) {
  let sr = 0, sg = 0, sb = 0, n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) { sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; }
  const ar = sr / n, ag = sg / n, ab = sb / n;
  const avg = (ar + ag + ab) / 3;
  if (avg < 1) return;
  const lo = strong ? 0.7 : 0.82, hi = strong ? 1.4 : 1.22;
  const gain = a => clamp(avg / Math.max(a, 1), lo, hi);
  let gr = gain(ar), gg = gain(ag), gb = gain(ab);
  const spread = (Math.max(ar, ag, ab) - Math.min(ar, ag, ab)) / avg;
  if (!strong && spread < 0.04) return; // normal mode: only correct a real cast
  const strength = strong ? clamp(0.45 + spread * 1.3, 0, 0.9) : clamp(spread * 1.6, 0, 0.7);
  gr = 1 + (gr - 1) * strength; gg = 1 + (gg - 1) * strength; gb = 1 + (gb - 1) * strength;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp(data[i] * gr, 0, 255);
    data[i + 1] = clamp(data[i + 1] * gg, 0, 255);
    data[i + 2] = clamp(data[i + 2] * gb, 0, 255);
  }
}

/* Redmean: a low-cost perceptually-weighted color distance. Penalizes green
   differences heavily, so a warm brown is correctly kept far from sage-green
   even when channels are close in plain RGB. */
function redmean(r1, g1, b1, r2, g2, b2) {
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

/* CIELAB color matching — far more perceptually accurate than RGB/redmean for
   choosing the closest bead color. sRGB -> linear -> XYZ (D65) -> Lab.
   Results are cached per hex string so palette colors convert only once. */
const _labCache = new Map();
function rgbToLab(r, g, b) {
  const srgb = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  // linear sRGB -> XYZ
  let x = srgb[0] * 0.4124 + srgb[1] * 0.3576 + srgb[2] * 0.1805;
  let y = srgb[0] * 0.2126 + srgb[1] * 0.7152 + srgb[2] * 0.0722;
  let z = srgb[0] * 0.0193 + srgb[1] * 0.1192 + srgb[2] * 0.9505;
  // normalize by D65 white
  x /= 0.95047; y /= 1.0; z /= 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function labOf(hex) {
  let v = _labCache.get(hex);
  if (!v) { const [r, g, b] = hexRgb(hex); v = rgbToLab(r, g, b); _labCache.set(hex, v); }
  return v;
}
/* CIE76 squared distance in Lab; chroma (a,b) weighted slightly up so hue
   confusions like brown<->green are penalized harder than lightness drift. */
function labDistance(lab1, lab2) {
  const dl = lab1[0] - lab2[0], da = lab1[1] - lab2[1], db = lab1[2] - lab2[2];
  return dl * dl + 1.35 * (da * da + db * db);
}
/* CIE94 (graphic-arts weights) squared distance — better lightness/chroma balance. */
function labDistanceCIE94(lab1, lab2) {
  const dl = lab1[0] - lab2[0];
  const c1 = Math.hypot(lab1[1], lab1[2]), c2 = Math.hypot(lab2[1], lab2[2]);
  const dc = c1 - c2;
  const da = lab1[1] - lab2[1], db = lab1[2] - lab2[2];
  const dh2 = Math.max(0, da * da + db * db - dc * dc);
  const sc = 1 + 0.045 * c1, sh = 1 + 0.015 * c1;
  return dl * dl + (dc * dc) / (sc * sc) + dh2 / (sh * sh);
}
/* CIEDE2000 squared distance — most perceptually accurate, a bit heavier. */
function labDistanceCIEDE2000(lab1, lab2) {
  const [L1, a1, b1] = lab1, [L2, a2, b2] = lab2;
  const avgLp = (L1 + L2) / 2;
  const c1 = Math.hypot(a1, b1), c2 = Math.hypot(a2, b2);
  const avgC = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(avgC ** 7 / (avgC ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + g), a2p = a2 * (1 + g);
  const c1p = Math.hypot(a1p, b1), c2p = Math.hypot(a2p, b2);
  const avgCp = (c1p + c2p) / 2;
  const deg = x => x * 180 / Math.PI, rad = x => x * Math.PI / 180;
  let h1p = deg(Math.atan2(b1, a1p)); if (h1p < 0) h1p += 360;
  let h2p = deg(Math.atan2(b2, a2p)); if (h2p < 0) h2p += 360;
  const dLp = L2 - L1, dCp = c2p - c1p;
  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin(rad(dhp) / 2);
  let avghp = h1p + h2p;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) avghp += (avghp < 360 ? 360 : -360);
    avghp /= 2;
  }
  const t = 1 - 0.17 * Math.cos(rad(avghp - 30)) + 0.24 * Math.cos(rad(2 * avghp))
    + 0.32 * Math.cos(rad(3 * avghp + 6)) - 0.20 * Math.cos(rad(4 * avghp - 63));
  const sl = 1 + (0.015 * (avgLp - 50) ** 2) / Math.sqrt(20 + (avgLp - 50) ** 2);
  const sc = 1 + 0.045 * avgCp, sh = 1 + 0.015 * avgCp * t;
  const dTheta = 30 * Math.exp(-(((avghp - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(avgCp ** 7 / (avgCp ** 7 + 25 ** 7));
  const rt = -rc * Math.sin(rad(2 * dTheta));
  const de = (dLp / sl) ** 2 + (dCp / sc) ** 2 + (dHp / sh) ** 2 + rt * (dCp / sc) * (dHp / sh);
  return de; // already squared-magnitude
}
/* dispatch to the active quality tier */
function activeLabDistance(lab1, lab2) {
  if (matchQuality === 'fast') return labDistanceCIE94(lab1, lab2);
  if (matchQuality === 'quality') return labDistanceCIEDE2000(lab1, lab2);
  return labDistance(lab1, lab2);
}
/* nearest palette index for an (r,g,b) using the active Lab metric. Skips transparent. */
function nearestPerceptual(r, g, b, colors) {
  const lab = rgbToLab(r, g, b);
  let best = 0, bestDistance = Infinity;
  for (let i = 0; i < colors.length; i++) {
    if (colors[i].transparent) continue;
    const d = activeLabDistance(lab, labOf(colors[i].color));
    if (d < bestDistance) { best = i; bestDistance = d; }
  }
  return best;
}
/* rank palette colors by closeness to a hex (for brush / replace match lists). */
function rankByCloseness(hex, colors, limit = 5) {
  const lab = labOf(hex);
  return colors.map((c, i) => ({ ...c, index: i, d: c.transparent ? Infinity : activeLabDistance(lab, labOf(c.color)) }))
    .filter(c => !c.transparent)
    .sort((a, b) => a.d - b.d).slice(0, limit);
}

/* Remove only TRULY isolated specks (a bead matching none of its 8 neighbours),
   replacing it with the most common neighbour. Using 8-connectivity preserves
   thin and diagonal lines — a diagonal line bead still has matching diagonal
   neighbours, so it is never erased, keeping outlines continuous. */
function denoiseGrid(grid, width, height) {
  const out = grid.slice();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    const neigh = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) neigh.push(grid[ny * width + nx]);
    }
    if (neigh.some(v => v === grid[i])) continue; // has a like neighbour: keep (line continuity)
    // truly isolated: replace with the dominant neighbour color
    const tally = {}; let mode = neigh[0], modeN = 0;
    neigh.forEach(v => { tally[v] = (tally[v] || 0) + 1; if (tally[v] > modeN) { modeN = tally[v]; mode = v; } });
    out[i] = mode;
  }
  return out;
}

/* Pixel-pattern reader: detect the bead cell size by scanning for the dominant
   color-change period, then sample the center of each cell (no resampling blur). */
function readPixelPattern(image, colors) {
  const maxSide = 240;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const sw = Math.max(1, Math.round(image.width * scale));
  const sh = Math.max(1, Math.round(image.height * scale));
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.imageSmoothingEnabled = false;
  cx.drawImage(image, 0, 0, sw, sh);
  const data = cx.getImageData(0, 0, sw, sh).data;
  const at = (x, y) => { const i = (y * sw + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const diff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  // edge projection along x and y
  const colEdges = Array(sw).fill(0), rowEdges = Array(sh).fill(0);
  for (let y = 0; y < sh; y++) for (let x = 1; x < sw; x++) { if (diff(at(x, y), at(x - 1, y)) > 40) { colEdges[x]++; } }
  for (let x = 0; x < sw; x++) for (let y = 1; y < sh; y++) { if (diff(at(x, y), at(x, y - 1)) > 40) { rowEdges[y]++; } }
  const period = axis => {
    const peaks = [];
    for (let i = 2; i < axis.length - 2; i++) if (axis[i] > axis[i - 1] && axis[i] >= axis[i + 1] && axis[i] > 2) peaks.push(i);
    if (peaks.length < 2) return 0;
    const gaps = [];
    for (let i = 1; i < peaks.length; i++) gaps.push(peaks[i] - peaks[i - 1]);
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)] || 0;
  };
  let cell = Math.max(period(colEdges), period(rowEdges));
  if (cell < 3) cell = Math.max(3, Math.round(Math.min(sw, sh) / 32));
  let width = clamp(Math.round(sw / cell), 8, 96);
  let height = clamp(Math.round(sh / cell), 8, 96);
  // sample center of each detected cell
  const grid = [];
  for (let gy = 0; gy < height; gy++) for (let gx = 0; gx < width; gx++) {
    const px = clamp(Math.round((gx + 0.5) * sw / width), 0, sw - 1);
    const py = clamp(Math.round((gy + 0.5) * sh / height), 0, sh - 1);
    const [r, g, b] = at(px, py);
    grid.push(nearestInColors(r, g, b, colors));
  }
  return { grid, width, height };
}

/* Size a canvas so that, when codes are requested, each bead cell is at least
   `minCell` px (enough to render a 3-char color code). For large grids this makes
   the canvas big; the caller wraps it in a zoom/scroll stage. Returns the cell px. */
function sizeCanvasFor(canvas, pattern, { codes = false, base = 720, minCell = 18 } = {}) {
  const dim = Math.max(pattern.width, pattern.height);
  let cell = Math.floor(base / dim);
  if (codes) cell = Math.max(cell, minCell);
  cell = Math.max(cell, 2);
  canvas.width = cell * pattern.width;
  canvas.height = cell * pattern.height;
  return cell;
}

function drawPattern(canvas, pattern, options = {}) {
  if (!canvas || !pattern || !pattern.grid?.length) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fffaf1';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const colorSet = pattern.colors || palette(pattern.paletteName || state.paletteName);
  const cell = Math.floor(Math.min(canvas.width / pattern.width, canvas.height / pattern.height));
  const offsetX = Math.floor((canvas.width - cell * pattern.width) / 2);
  const offsetY = Math.floor((canvas.height - cell * pattern.height) / 2);
  pattern.grid.forEach((colorIndex, index) => {
    const x = index % pattern.width;
    const y = Math.floor(index / pattern.width);
    const col = colorSet[colorIndex] || { color: '#fff', code: '' };
    const cellX = offsetX + x * cell, cellY = offsetY + y * cell;
    if (col.transparent) {
      // render transparency as a small checkerboard so it's visually obvious
      const h = Math.max(2, Math.floor(cell / 2));
      ctx.fillStyle = '#ffffff'; ctx.fillRect(cellX, cellY, cell, cell);
      ctx.fillStyle = '#d9d2c4';
      ctx.fillRect(cellX, cellY, h, h);
      ctx.fillRect(cellX + h, cellY + h, cell - h, cell - h);
    } else {
      ctx.fillStyle = col.color;
      ctx.fillRect(cellX, cellY, cell, cell);
    }
    if (options.grid && cell >= 5) {
      ctx.strokeStyle = 'rgba(35,31,26,.18)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cellX, cellY, cell, cell);
    }
    if (options.codes && cell >= 14 && !col.transparent) {
      const [r, g, b] = hexRgb(col.color);
      ctx.fillStyle = (r * .299 + g * .587 + b * .114) < 150 ? '#fffaf1' : '#231f1a';
      ctx.font = `${Math.max(8, cell * .24)}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(col.code, cellX + cell / 2, cellY + cell / 2);
    }
    if (options.selection?.has(index)) {
      ctx.fillStyle = 'rgba(63,111,159,.34)';
      ctx.fillRect(cellX, cellY, cell, cell);
      ctx.strokeStyle = '#3f6f9f';
      ctx.lineWidth = 2;
      ctx.strokeRect(cellX + 1, cellY + 1, cell - 2, cell - 2);
    }
  });
  if (options.watermark) drawWatermark(ctx, canvas.width, offsetY + cell * pattern.height, options.watermark);
}

function renderStats(container, pattern) {
  if (!container || !pattern) return;
  const colorSet = pattern.colors || palette(pattern.paletteName || state.paletteName);
  const rows = counts(pattern.grid, colorSet).map((count, index) => ({ ...colorSet[index], count })).filter(row => row.count && !row.transparent).sort((a, b) => b.count - a.count);
  container.innerHTML = rows.slice(0, 8).map(row => `<div class="metric-card"><strong>${row.count}</strong><span><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${row.color};vertical-align:middle"></i> ${row.code} ${row.name}</span></div>`).join('');
}
function updateThumbnail(project) {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 320;
  drawPattern(canvas, project, { grid: false, codes: false });
  project.thumbnail = canvas.toDataURL('image/png');
}

/* Smart optimize: not just denoise. Three passes operating on a copy:
   1) remove isolated noise pixels (replace with dominant neighbour)
   2) fill thin single-pixel gaps inside solid regions (add color blocks)
   3) nudge near-duplicate colors toward their neighbours for harmony (modify colors)
   Returns true if anything changed. */
function smartOptimize(pattern) {
  const w = pattern.width, h = pattern.height;
  const src = pattern.grid;
  const next = src.slice();
  const idx = (x, y) => y * w + x;
  const neighbours = (x, y) => {
    const out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) out.push(src[idx(nx, ny)]);
    }
    return out;
  };
  const majority = arr => {
    const m = {}; let best = arr[0], bestN = 0;
    arr.forEach(v => { m[v] = (m[v] || 0) + 1; if (m[v] > bestN) { bestN = m[v]; best = v; } });
    return { value: best, n: bestN };
  };
  // pass 1 + 2: denoise and gap-fill
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = idx(x, y);
    const around = neighbours(x, y);
    const orthogonal = [src[idx(Math.max(0, x - 1), y)], src[idx(Math.min(w - 1, x + 1), y)], src[idx(x, Math.max(0, y - 1))], src[idx(x, Math.min(h - 1, y + 1))]];
    const same = around.filter(v => v === src[i]).length;
    const maj = majority(around);
    // isolated speck: no orthogonal match and surrounded by a clear majority
    if (same <= 1 && maj.n >= 5) next[i] = maj.value;
    // thin gap: pixel differs from all 4 orthogonal neighbours which agree
    else if (orthogonal.every(v => v === orthogonal[0]) && orthogonal[0] !== src[i]) next[i] = orthogonal[0];
  }
  pattern.grid = next;
  // pass 3: harmonize near-duplicate colors (merge perceptually close palette colors)
  const used = counts(pattern.grid, pattern.colors);
  for (let a = 0; a < pattern.colors.length; a++) {
    if (!used[a]) continue;
    for (let b = a + 1; b < pattern.colors.length; b++) {
      if (!used[b]) continue;
      const [ar, ag, ab] = hexRgb(pattern.colors[a].color);
      const [br, bg, bb] = hexRgb(pattern.colors[b].color);
      const dist = (ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2;
      if (dist < 700) {
        // fold the rarer color into the more common one
        const [keep, drop] = used[a] >= used[b] ? [a, b] : [b, a];
        pattern.grid = pattern.grid.map(v => v === drop ? keep : v);
        used[keep] += used[drop]; used[drop] = 0;
      }
    }
  }
  reconcileColors(pattern);
  const changed = JSON.stringify(pattern.grid) !== JSON.stringify(src);
  return changed;
}

/* Watermark that never overlaps: lay text on a rotated lattice whose spacing is
   guaranteed to exceed the rotated text bounding box for the chosen density. */
function drawWatermark(ctx, width, height, opt) {
  const text = (opt.text || 'Bead Loom').trim() || 'Bead Loom';
  const angle = -Math.PI / 7;
  const fontSize = Math.max(20, Math.round(width / 28));
  ctx.save();
  ctx.font = `bold ${fontSize}px Georgia, serif`;
  const textW = ctx.measureText(text).width;
  const textH = fontSize;
  // rotated bounding box footprint
  const footW = Math.abs(textW * Math.cos(angle)) + Math.abs(textH * Math.sin(angle));
  const footH = Math.abs(textW * Math.sin(angle)) + Math.abs(textH * Math.cos(angle));
  // density 1..5 -> gap multiplier; min spacing keeps boxes apart (no overlap)
  const d = clamp(opt.density || 3, 1, 5);
  const gapX = footW * (1.9 - d * 0.18) + 28;
  const gapY = footH * (2.2 - d * 0.16) + 28;
  ctx.globalAlpha = clamp(opt.opacity ?? 32, 5, 80) / 100;
  ctx.fillStyle = '#231f1a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const diag = Math.hypot(width, height);
  let row = 0;
  for (let y = -diag; y < diag * 1.5; y += gapY, row++) {
    const shift = (row % 2) * gapX / 2;
    for (let x = -diag + shift; x < diag * 1.5; x += gapX) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();
}

/* Shared: wire a range<->number pair that drives a size value, fully draggable. */
function bindSizeControls({ widthRange, widthNumber, heightRange, heightNumber, resolutionRange, resolutionNumber, widthOut, heightOut, resolutionOut, smartOut, getRatio, onChange }) {
  function syncSize(width, height) {
    width = clamp(width, 12, 96); height = clamp(height, 12, 96);
    if (widthRange) widthRange.value = width;
    if (widthNumber) widthNumber.value = width;
    if (heightRange) heightRange.value = height;
    if (heightNumber) heightNumber.value = height;
    if (widthOut) widthOut.textContent = width;
    if (heightOut) heightOut.textContent = height;
    if (resolutionRange) resolutionRange.value = width * height;
    if (resolutionNumber) resolutionNumber.value = width * height;
    if (resolutionOut) resolutionOut.textContent = width * height;
    if (smartOut) smartOut.textContent = `${width} × ${height}`;
    onChange?.(width, height);
    return { width, height };
  }
  [widthRange, widthNumber, heightRange, heightNumber].filter(Boolean).forEach(input =>
    input.addEventListener('input', () => {
      const w = input === widthRange || input === widthNumber ? input.value : (widthNumber?.value || widthRange?.value);
      const h = input === heightRange || input === heightNumber ? input.value : (heightNumber?.value || heightRange?.value);
      syncSize(w, h);
    }));
  [resolutionRange, resolutionNumber].filter(Boolean).forEach(input =>
    input.addEventListener('input', () => {
      const next = sizeFromResolution(input.value, getRatio?.() || 1);
      syncSize(next.width, next.height);
    }));
  return { syncSize, current: () => ({ width: clamp(widthNumber?.value || 48, 12, 96), height: clamp(heightNumber?.value || 48, 12, 96) }) };
}

/* Crop overlay: draws the source image into a preview canvas with a draggable
   rectangle. Returns {x,y,w,h} in source pixels via getCrop(). */
function makeCropper(canvas) {
  let img = null, box = null, drag = null;
  const view = { scale: 1, ox: 0, oy: 0 };
  function fit() {
    if (!img) return;
    const cw = canvas.width, ch = canvas.height;
    view.scale = Math.min(cw / img.width, ch / img.height);
    view.ox = (cw - img.width * view.scale) / 2;
    view.oy = (ch - img.height * view.scale) / 2;
  }
  function draw() {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(35,31,26,.06)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!img) return;
    ctx.drawImage(img, view.ox, view.oy, img.width * view.scale, img.height * view.scale);
    if (!box) return;
    const r = boxRect();
    ctx.save();
    ctx.fillStyle = 'rgba(20,16,12,.45)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.clearRect(r.x, r.y, r.w, r.h);
    ctx.drawImage(img, (r.x - view.ox) / view.scale, (r.y - view.oy) / view.scale, r.w / view.scale, r.h / view.scale, r.x, r.y, r.w, r.h);
    ctx.strokeStyle = '#dd7b48';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    corners(r).forEach(([hx, hy]) => {
      ctx.fillStyle = '#dd7b48'; ctx.fillRect(hx - 6, hy - 6, 12, 12);
      ctx.strokeStyle = '#fff8ef'; ctx.lineWidth = 1.5; ctx.strokeRect(hx - 6, hy - 6, 12, 12);
    });
    ctx.restore();
  }
  function boxRect() {
    return { x: view.ox + box.x * view.scale, y: view.oy + box.y * view.scale, w: box.w * view.scale, h: box.h * view.scale };
  }
  // four corners in canvas space, labelled nw/ne/sw/se
  function corners(r) { return [[r.x, r.y, 'nw'], [r.x + r.w, r.y, 'ne'], [r.x, r.y + r.h, 'sw'], [r.x + r.w, r.y + r.h, 'se']]; }
  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * canvas.width / rect.width, y: (e.clientY - rect.top) * canvas.height / rect.height };
  }
  function hitCorner(p, r) {
    const found = corners(r).find(([hx, hy]) => Math.abs(p.x - hx) < 16 && Math.abs(p.y - hy) < 16);
    return found ? found[2] : null;
  }
  canvas.addEventListener('pointerdown', e => {
    if (!img || !box) return;
    e.preventDefault();
    const p = pos(e); const r = boxRect();
    const handle = hitCorner(p, r);
    const inside = p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    drag = { mode: handle ? 'resize' : (inside ? 'move' : null), handle, sx: p.x, sy: p.y, ox: box.x, oy: box.y, ow: box.w, oh: box.h };
    if (!drag.mode) { drag = null; return; }
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    // update cursor hint even when not dragging
    if (img && box && !drag) {
      const p = pos(e); const r = boxRect();
      const h = hitCorner(p, r);
      const inside = p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
      canvas.style.cursor = h ? (h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize') : (inside ? 'move' : 'default');
    }
    if (!drag) return;
    const p = pos(e);
    const dx = (p.x - drag.sx) / view.scale, dy = (p.y - drag.sy) / view.scale;
    if (drag.mode === 'move') {
      box.x = clamp(drag.ox + dx, 0, img.width - box.w);
      box.y = clamp(drag.oy + dy, 0, img.height - box.h);
    } else {
      // resize from whichever corner is grabbed, keeping the opposite corner anchored
      let left = drag.ox, top = drag.oy, right = drag.ox + drag.ow, bottom = drag.oy + drag.oh;
      if (drag.handle.includes('w')) left = clamp(drag.ox + dx, 0, right - 8);
      if (drag.handle.includes('e')) right = clamp(drag.ox + drag.ow + dx, left + 8, img.width);
      if (drag.handle.includes('n')) top = clamp(drag.oy + dy, 0, bottom - 8);
      if (drag.handle.includes('s')) bottom = clamp(drag.oy + drag.oh + dy, top + 8, img.height);
      box.x = left; box.y = top; box.w = right - left; box.h = bottom - top;
    }
    draw();
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  return {
    set(image) { img = image; fit(); box = { x: 0, y: 0, w: img.width, h: img.height }; draw(); },
    reset() { if (img) { box = { x: 0, y: 0, w: img.width, h: img.height }; draw(); } },
    getCrop() { return box ? { ...box } : null; },
    redraw: draw
  };
}

function initConvert() {
  const canvas = document.getElementById('patternCanvas');
  const cropCanvas = document.getElementById('cropCanvas');
  const cropper = cropCanvas ? makeCropper(cropCanvas) : null;
  let readerMode = false; // false = 图片转换, true = 读取图案
  const sizer = bindSizeControls({
    widthRange: document.getElementById('pixelWidth'),
    widthNumber: document.getElementById('widthNumber'),
    heightRange: document.getElementById('pixelHeight'),
    heightNumber: document.getElementById('heightNumber'),
    resolutionRange: document.getElementById('resolutionRange'),
    resolutionNumber: document.getElementById('resolutionNumber'),
    widthOut: document.getElementById('widthOut'),
    heightOut: document.getElementById('heightOut'),
    resolutionOut: document.getElementById('resolutionOut'),
    smartOut: document.getElementById('smartSize'),
    getRatio: () => state.current.sourceRatio || 1
  });
  const stage = canvas.closest('.canvas-stage');
  let zoom = 100, fitWidth = 0;
  function redraw() {
    const codes = document.getElementById('showCodes').checked;
    sizeCanvasFor(canvas, state.current, { codes, base: 720, minCell: 18 });
    drawPattern(canvas, state.current, { grid: document.getElementById('showGrid').checked, codes });
    renderStats(document.getElementById('quickStats'), state.current);
    applyZoom(zoom);
  }
  // fit-to-stage base width, then zoom multiplies it; large patterns scroll inside stage
  function applyZoom(v) {
    zoom = clamp(v, 100, 600);
    const zr = document.getElementById('previewZoom');
    if (zr) zr.value = zoom;
    const zo = document.getElementById('previewZoomOut');
    if (zo) zo.textContent = `${zoom}%`;
    if (!stage) return;
    const avail = stage.clientWidth - 32;
    fitWidth = Math.min(avail, canvas.width);
    canvas.style.width = `${Math.round(fitWidth * zoom / 100)}px`;
    canvas.style.height = 'auto';
  }
  document.getElementById('previewZoom')?.addEventListener('input', e => applyZoom(e.target.value));
  document.getElementById('previewZoomInBtn')?.addEventListener('click', () => applyZoom(zoom + 25));
  document.getElementById('previewZoomOutBtn')?.addEventListener('click', () => applyZoom(zoom - 25));
  // drag to pan when zoomed beyond the stage
  if (stage) {
    let panning = false, ps = null;
    canvas.addEventListener('pointerdown', e => { panning = true; ps = { x: e.clientX, y: e.clientY }; canvas.style.cursor = 'grabbing'; });
    window.addEventListener('pointermove', e => {
      if (!panning) return;
      stage.scrollLeft -= e.clientX - ps.x; stage.scrollTop -= e.clientY - ps.y; ps = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointerup', () => { panning = false; canvas.style.cursor = 'grab'; });
    canvas.style.cursor = 'grab';
  }
  // mode toggle (checkbox styled as switch)
  const modeToggle = document.getElementById('readerToggle');
  function applyMode() {
    readerMode = modeToggle.checked;
    document.querySelector('[data-when="reader-only"]')?.classList.toggle('hidden', !readerMode);
    document.querySelector('[data-when="convert-only"]')?.classList.toggle('hidden', readerMode);
    document.getElementById('convertBtn').textContent = readerMode ? '识别像素图案' : '生成图案';
    document.getElementById('methodLabel').textContent = readerMode ? '采样方式' : '转换方法';
  }
  modeToggle?.addEventListener('change', applyMode);

  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-mode]').forEach(el => el.classList.toggle('active', el === button));
    document.querySelectorAll('[data-panel]').forEach(el => el.classList.toggle('hidden', el.dataset.panel !== button.dataset.mode));
  }));
  document.getElementById('imageInput').addEventListener('change', event => {
    const file = event.target.files[0];
    if (!file) return;
    const image = new Image();
    image.onload = () => {
      sourceImage = image;
      state.current.sourceRatio = image.width / image.height;
      cropper?.set(image);
      const next = readerMode ? readPixelPattern(image, palette(state.paletteName)) : smartSize(image.width, image.height);
      sizer.syncSize(next.width, next.height);
      toast(readerMode ? '像素图已载入，可裁剪后识别。' : '图片已载入，可裁剪后转换。');
    };
    image.src = URL.createObjectURL(file);
  });
  document.getElementById('resetCropBtn')?.addEventListener('click', () => cropper?.reset());
  document.getElementById('useSmartBtn')?.addEventListener('click', () => {
    const next = sourceImage ? smartSize(sourceImage.width, sourceImage.height) : { width: 48, height: 48 };
    sizer.syncSize(next.width, next.height);
  });
  document.getElementById('convertBtn').addEventListener('click', () => {
    state.paletteName = document.getElementById('paletteSelect').value;
    const colors = palette(state.paletteName);
    const method = document.getElementById('methodSelect').value;
    // apply quality tier + sampling mode for this conversion
    matchQuality = document.getElementById('qualitySelect')?.value || 'default';
    sampleMode = document.getElementById('sampleSelect')?.value || 'default';
    const crop = cropper?.getCrop();
    let width, height, grid;
    if (readerMode && sourceImage) {
      const read = readPixelPattern(sourceImage, colors);
      ({ width, height, grid } = read);
      sizer.syncSize(width, height);
    } else {
      ({ width, height } = sizer.current());
      const strongCast = document.getElementById('strongCast')?.checked;
      grid = sourceImage ? generateGridFromImage(sourceImage, width, height, colors, method, crop, strongCast) : makeSeedGrid(width, height, state.paletteName);
    }
    const name = readerMode ? '识别图案' : '当前图案';
    state.current = newPattern(name, width, height, grid, state.paletteName);
    state.current.sourceRatio = sourceImage ? sourceImage.width / sourceImage.height : 1;
    saveState(); redraw(); toast(readerMode ? '像素图案已识别。' : '图案已生成。');
  });
  document.getElementById('optimizeBtn').addEventListener('click', () => {
    const changed = smartOptimize(state.current);
    if (changed) pushHistory(state.current);
    updateUndoButtons(); saveState(); redraw();
    toast(changed ? '已优化：去杂色、补色块并协调配色。' : '图案已经很协调。');
  });
  document.getElementById('undoBtn')?.addEventListener('click', () => {
    if (undo(state.current)) { updateUndoButtons(); saveState(); redraw(); toast('已撤销上一步。'); }
  });
  document.getElementById('redoBtn')?.addEventListener('click', () => {
    if (redo(state.current)) { updateUndoButtons(); saveState(); redraw(); toast('已恢复。'); }
  });
  function updateUndoButtons() {
    const u = document.getElementById('undoBtn'), r = document.getElementById('redoBtn');
    if (u) u.disabled = !canUndo(state.current);
    if (r) r.disabled = !canRedo(state.current);
  }
  document.getElementById('savePatternBtn').addEventListener('click', () => {
    const p = newPattern(state.current.name === '当前图案' ? `图案 ${state.projects.length + 1}` : state.current.name, state.current.width, state.current.height, state.current.grid, state.paletteName);
    p.colors = state.current.colors.map(c => ({ ...c }));
    p.historyColors = state.current.historyColors.map(c => ({ ...c }));
    updateThumbnail(p);
    state.projects.unshift(p);
    saveState(); toast('已保存到图案库。');
  });
  ['showGrid', 'showCodes'].forEach(id => document.getElementById(id).addEventListener('change', redraw));
  // reflect the saved palette in the select if it's one of the offered options
  const pSel = document.getElementById('paletteSelect');
  if (pSel && [...pSel.options].some(o => o.value === state.paletteName)) pSel.value = state.paletteName;
  applyMode();
  sizer.syncSize(state.current.width, state.current.height);
  updateUndoButtons();
  redraw();
}

function initEditor() {
  const canvas = document.getElementById('patternCanvas');
  const stage = document.getElementById('stageScroller');
  const pattern = state.current;
  let tool = 'paint', dragging = false, last = null, strokeDirty = false;
  let zoom = 100;
  const selected = new Set();

  function renderPalette() {
    const used = counts(pattern.grid, pattern.colors);
    document.getElementById('editorPalette').innerHTML = pattern.colors.map((item, index) =>
      `<button class="pill swatch" data-color="${index}" style="border-color:${pattern.selectedColor === index ? '#231f1a' : 'transparent'}">
        <i style="width:14px;height:14px;border-radius:50%;background:${item.color}"></i>${item.code}<small>${used[index] || 0}</small></button>`).join('');
    // history colors (collapsible)
    const hc = document.getElementById('historyColors');
    if (hc) {
      hc.innerHTML = pattern.historyColors.length
        ? pattern.historyColors.map((item, i) => `<button class="pill swatch ghost-swatch" data-history="${i}"><i style="width:14px;height:14px;border-radius:50%;background:${item.color}"></i>${item.code}</button>`).join('')
        : '<p class="limit-note">暂无历史颜色。</p>';
      const wrap = document.getElementById('historyColorsWrap');
      if (wrap) wrap.querySelector('summary').textContent = `历史颜色 (${pattern.historyColors.length})`;
    }
    // replace-to options: existing colors + custom
    const sel = document.getElementById('replaceSelect');
    if (sel) sel.innerHTML = pattern.colors.map((item, index) => `<option value="${index}">${item.code} ${item.name}</option>`).join('') + '<option value="__custom">自定义颜色…</option>';
  }
  function redraw() {
    const codes = document.getElementById('showCodes')?.checked ?? true;
    const showGrid = document.getElementById('showGrid')?.checked ?? true;
    if (codes) sizeCanvasFor(canvas, pattern, { codes: true, base: 900, minCell: 18 });
    drawPattern(canvas, pattern, { grid: showGrid, codes, selection: selected });
    document.getElementById('selectionCount').textContent = selected.size;
    renderPalette();
    updateHistoryButtons();
    if (typeof applyZoom === 'function') applyZoom(zoom);
  }
  function commitStroke() {
    if (!strokeDirty) return;
    reconcileColors(pattern);
    // selection indices may shift after reconcile; clearest is to drop selection if colors changed
    pushHistory(pattern);
    strokeDirty = false;
    saveState();
    redraw();
  }
  function pixelFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (canvas.width / rect.width);
    const y = (event.clientY - rect.top) * (canvas.height / rect.height);
    const cell = Math.floor(canvas.width / Math.max(pattern.width, pattern.height));
    const offsetX = Math.floor((canvas.width - cell * pattern.width) / 2);
    const offsetY = Math.floor((canvas.height - cell * pattern.height) / 2);
    const px = Math.floor((x - offsetX) / cell), py = Math.floor((y - offsetY) / cell);
    if (px < 0 || py < 0 || px >= pattern.width || py >= pattern.height) return -1;
    return py * pattern.width + px;
  }
  document.querySelectorAll('.tool').forEach(button => button.addEventListener('click', () => {
    tool = button.dataset.tool;
    document.querySelectorAll('.tool').forEach(el => el.classList.toggle('active', el === button));
    if (tool !== 'select') { selected.clear(); }
    canvas.style.cursor = tool === 'pan' ? 'grab' : 'crosshair';
    redraw();
  }));
  document.getElementById('editorPalette').addEventListener('click', event => {
    const button = event.target.closest('[data-color]');
    if (!button) return;
    const colorIdx = Number(button.dataset.color);
    pattern.selectedColor = colorIdx;
    if (tool === 'select') {
      // in select mode: first click selects all of this color, click again deselects
      const indices = [];
      pattern.grid.forEach((v, i) => { if (v === colorIdx) indices.push(i); });
      const allSelected = indices.length > 0 && indices.every(i => selected.has(i));
      if (allSelected) { indices.forEach(i => selected.delete(i)); toast(`已取消 ${pattern.colors[colorIdx].code} 全选。`); }
      else { indices.forEach(i => selected.add(i)); toast(`已选中 ${indices.length} 个 ${pattern.colors[colorIdx].code} 像素。`); }
      document.getElementById('selectionCount').textContent = selected.size;
      redraw();
    } else {
      // paint (and other) modes: just pick the brush color
      renderPalette();
    }
  });
  document.getElementById('historyColors')?.addEventListener('click', event => {
    const button = event.target.closest('[data-history]');
    if (!button) return;
    // revive a history color as the active paint color
    const hex = pattern.historyColors[Number(button.dataset.history)].color;
    pattern.selectedColor = ensureColor(pattern, hex);
    renderPalette();
    toast('已取回历史颜色。');
  });
  // ---- brush & replace color helpers ----
  // render a list of swatches into a box; each carries a data-pick hex (or "__t" for transparent)
  function swatchHTML(list, withCustomHex) {
    let html = list.map(c => `<button class="pill swatch" data-pick="${c.color}"><i style="width:14px;height:14px;border-radius:50%;background:${c.color}"></i>${c.code}</button>`).join('');
    if (withCustomHex) html += `<button class="pill swatch ghost-swatch" data-pick="${withCustomHex}"><i style="width:14px;height:14px;border-radius:50%;background:${withCustomHex}"></i>自定义</button>`;
    return html;
  }
  // nearest matches for the brush picker (Lab-based for accuracy)
  function showBrushMatches() {
    const hex = document.getElementById('brushColor').value;
    const box = document.getElementById('brushMatches');
    box.classList.remove('hidden');
    box.innerHTML = swatchHTML(rankByCloseness(hex, palette(pattern.paletteName), 4), hex);
    document.getElementById('brushScheme')?.classList.add('hidden');
  }
  // full palette scheme with codes
  function showScheme(boxId) {
    const box = document.getElementById(boxId);
    const open = !box.classList.contains('hidden');
    box.classList.toggle('hidden', open);
    if (!open) box.innerHTML = swatchHTML(palette(pattern.paletteName).map((c, i) => ({ ...c, index: i })), null);
  }
  document.getElementById('matchBrushColorBtn')?.addEventListener('click', showBrushMatches);
  document.getElementById('brushColor')?.addEventListener('input', showBrushMatches);
  document.getElementById('brushSchemeBtn')?.addEventListener('click', () => showScheme('brushScheme'));
  document.getElementById('brushTransparentBtn')?.addEventListener('click', () => {
    pattern.selectedColor = ensureTransparent(pattern);
    pushHistory(pattern); saveState(); redraw();
    toast('画笔已设为透明色。');
  });
  // brush picks (from matches or scheme)
  function brushPick(event) {
    const button = event.target.closest('[data-pick]');
    if (!button) return;
    pattern.selectedColor = ensureColor(pattern, button.dataset.pick);
    pushHistory(pattern); saveState(); redraw();
    toast(`画笔颜色已设为 ${pattern.colors[pattern.selectedColor].code}。`);
  }
  document.getElementById('brushMatches')?.addEventListener('click', brushPick);
  document.getElementById('brushScheme')?.addEventListener('click', brushPick);

  // replace-to: match list off the custom color, scheme list, transparent
  let replaceTargetHex = null; // when set via swatch, overrides the <select>
  function showReplaceMatches() {
    const hex = document.getElementById('replaceCustomColor').value;
    const box = document.getElementById('replaceMatches');
    box.classList.remove('hidden');
    box.innerHTML = swatchHTML(rankByCloseness(hex, palette(pattern.paletteName), 4), hex);
  }
  document.getElementById('replaceCustomColor')?.addEventListener('input', showReplaceMatches);
  document.getElementById('replaceSchemeBtn')?.addEventListener('click', () => showScheme('replaceScheme'));
  document.getElementById('replaceTransparentBtn')?.addEventListener('click', () => {
    replaceTargetHex = '__transparent';
    toast('替换目标已设为透明色，点击「替换所选颜色」应用。');
  });
  function replacePick(event) {
    const button = event.target.closest('[data-pick]');
    if (!button) return;
    replaceTargetHex = button.dataset.pick;
    toast(`替换目标已选 ${button.textContent.trim()}，点击「替换所选颜色」应用。`);
  }
  document.getElementById('replaceMatches')?.addEventListener('click', replacePick);
  document.getElementById('replaceScheme')?.addEventListener('click', replacePick);
  canvas.addEventListener('pointerdown', event => { dragging = true; last = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId); handlePointer(event); });
  canvas.addEventListener('pointermove', event => {
    if (!dragging) return;
    if (tool === 'pan') { stage.scrollLeft -= event.clientX - last.x; stage.scrollTop -= event.clientY - last.y; last = { x: event.clientX, y: event.clientY }; return; }
    handlePointer(event);
  });
  canvas.addEventListener('pointerup', () => { dragging = false; commitStroke(); });
  function handlePointer(event) {
    const index = pixelFromEvent(event);
    if (index < 0) return;
    if (tool === 'paint') {
      if (pattern.grid[index] !== pattern.selectedColor) { pattern.grid[index] = pattern.selectedColor; strokeDirty = true; }
    }
    if (tool === 'select') { selected.has(index) ? selected.delete(index) : selected.add(index); }
    // NOTE: multi-select never changes color directly — use the right-side replace.
    drawPattern(canvas, pattern, { grid: document.getElementById('showGrid')?.checked ?? true, codes: document.getElementById('showCodes')?.checked ?? true, selection: selected });
    document.getElementById('selectionCount').textContent = selected.size;
  }
  // replace selected pixels with an existing palette color or any custom color
  const replaceSelect = document.getElementById('replaceSelect');
  const replaceCustom = document.getElementById('replaceCustomColor');
  replaceSelect?.addEventListener('change', () => {
    if (replaceCustom) replaceCustom.classList.toggle('hidden', replaceSelect.value !== '__custom');
    replaceTargetHex = null; // explicit dropdown choice overrides any swatch pick
  });
  function resolveReplaceTarget() {
    if (replaceTargetHex === '__transparent') return ensureTransparent(pattern);
    if (replaceTargetHex) return ensureColor(pattern, replaceTargetHex);
    if (replaceSelect.value === '__custom') return ensureColor(pattern, replaceCustom.value);
    return Number(replaceSelect.value);
  }
  document.getElementById('replaceBtn').addEventListener('click', () => {
    if (!selected.size) return toast('请先用多选工具选择像素。');
    const targetIndex = resolveReplaceTarget();
    selected.forEach(i => pattern.grid[i] = targetIndex);
    selected.clear();
    replaceTargetHex = null;
    reconcileColors(pattern);
    pushHistory(pattern); saveState(); redraw(); toast('已替换所选像素。');
  });
  // set background (the most common edge color) to transparent
  document.getElementById('bgTransparentBtn')?.addEventListener('click', () => {
    const bg = detectBackgroundColor(pattern);
    if (bg < 0) return toast('未能识别背景色。');
    const t = ensureTransparent(pattern);
    pattern.grid = pattern.grid.map(v => v === bg ? t : v);
    reconcileColors(pattern);
    pushHistory(pattern); saveState(); redraw(); toast('背景已设为透明。');
  });
  // zoom 60..1000, draggable, never blocked at 100. Scale in explicit pixels off a
  // stable base width (the stage's inner width) so overflow + scroll work reliably.
  const zoomRange = document.getElementById('zoomRange');
  let baseWidth = 0;
  function measureBase() {
    const cs = getComputedStyle(stage);
    baseWidth = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (baseWidth < 50) baseWidth = 600;
  }
  function applyZoom(v) {
    zoom = clamp(v, 60, 1000);
    zoomRange.value = zoom;
    if (!baseWidth) measureBase();
    canvas.style.width = `${Math.round(baseWidth * zoom / 100)}px`;
    canvas.style.height = 'auto';
    document.getElementById('zoomOut').textContent = `${zoom}%`;
  }
  zoomRange.addEventListener('input', e => applyZoom(e.target.value));
  document.getElementById('zoomInBtn')?.addEventListener('click', () => applyZoom(zoom + 20));
  document.getElementById('zoomOutBtn')?.addEventListener('click', () => applyZoom(zoom - 20));
  document.getElementById('fitBtn').addEventListener('click', () => { measureBase(); applyZoom(100); });
  window.addEventListener('resize', () => { measureBase(); applyZoom(zoom); });
  document.getElementById('fullscreenBtn').addEventListener('click', () => document.documentElement.requestFullscreen?.());
  // optimize / undo / redo
  document.getElementById('optimizeBtn')?.addEventListener('click', () => { if (smartOptimize(pattern)) pushHistory(pattern); saveState(); redraw(); toast('已优化配色。'); });
  document.getElementById('undoBtn').addEventListener('click', () => { if (undo(pattern)) { selected.clear(); saveState(); redraw(); toast('已撤销。'); } });
  document.getElementById('redoBtn').addEventListener('click', () => { if (redo(pattern)) { selected.clear(); saveState(); redraw(); toast('已恢复。'); } });
  function updateHistoryButtons() {
    document.getElementById('undoBtn').disabled = !canUndo(pattern);
    document.getElementById('redoBtn').disabled = !canRedo(pattern);
  }
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) { if (redo(pattern)) { selected.clear(); saveState(); redraw(); } }
      else if (undo(pattern)) { selected.clear(); saveState(); redraw(); }
    }
  });
  document.getElementById('paletteSelect').addEventListener('change', event => {
    // re-map current colors to the new palette's nearest equivalents
    state.paletteName = pattern.paletteName = event.target.value;
    pattern.colors = pattern.colors.map(c => { const [r, g, b] = hexRgb(c.color); const m = palette(pattern.paletteName)[nearestColor(r, g, b, pattern.paletteName)]; return { ...m }; });
    pushHistory(pattern); saveState(); redraw();
  });
  document.getElementById('savePatternBtn').addEventListener('click', () => {
    updateThumbnail(pattern);
    const existing = state.projects.find(p => p.id === pattern.id);
    if (existing) Object.assign(existing, structuredClone(pattern));
    saveState(); toast('修改已保存。');
  });
  // save the current edit as a NEW library entry
  document.getElementById('saveToLibraryBtn')?.addEventListener('click', () => {
    updateThumbnail(pattern);
    const copy = structuredClone(pattern);
    copy.id = crypto.randomUUID();
    if (!copy.name || copy.name === '当前图案') copy.name = `图案 ${state.projects.length + 1}`;
    state.projects.unshift(copy);
    saveState(); toast('已保存到图库。');
  });
  // codes / grid can be toggled any time, not just at conversion
  ['showCodes', 'showGrid'].forEach(id => document.getElementById(id)?.addEventListener('change', redraw));
  canvas.style.cursor = 'crosshair';
  measureBase();
  applyZoom(100);
  redraw();
}

function renderProjectGrid(container, projects, selectable = false, selectedIds = null) {
  container.innerHTML = projects.map(project => {
    if (!project.thumbnail) updateThumbnail(project);
    const used = counts(project.grid, project.colors).filter(Boolean).length;
    const isSel = selectable && selectedIds?.has(project.id);
    return `<article class="pattern-card ${isSel ? 'selected' : ''}" data-id="${project.id}">
      <img class="pattern-preview" src="${project.thumbnail}" alt="${project.name} 缩略图" data-open="${project.id}" />
      <div class="meta">
        <h3>${project.name}</h3><p>${project.width} × ${project.height} · ${project.grid.length.toLocaleString('zh-CN')} 颗 · ${used} 色</p>
        <div class="pill-row"><span class="pill">${paletteLabel(project.paletteName)}</span></div>
        ${selectable ? '' : `<div class="head-actions"><button class="button small" data-edit="${project.id}">编辑</button><button class="button small" data-rename="${project.id}">改名</button><button class="button small" data-delete="${project.id}">删除</button></div>`}
      </div>
    </article>`;
  }).join('');
}
function initLibrary() {
  const grid = document.getElementById('patternGrid');
  function render() { renderProjectGrid(grid, filteredProjects()); }
  function filteredProjects() {
    const q = document.getElementById('librarySearch').value.trim();
    const sort = document.getElementById('librarySort').value;
    return state.projects.filter(p => p.name.includes(q)).sort((a, b) => sort === 'beads' ? b.grid.length - a.grid.length : sort === 'colors' ? counts(b.grid, b.colors).filter(Boolean).length - counts(a.grid, a.colors).filter(Boolean).length : 0);
  }
  grid.addEventListener('click', event => {
    const del = event.target.closest('[data-delete]');
    if (del) { state.projects = state.projects.filter(p => p.id !== del.dataset.delete); saveState(); render(); return toast('图案已删除。'); }
    const rename = event.target.closest('[data-rename]');
    if (rename) {
      const project = state.projects.find(p => p.id === rename.dataset.rename);
      const name = prompt('重命名图案', project.name);
      if (name && name.trim()) { project.name = name.trim(); saveState(); render(); toast('已重命名。'); }
      return;
    }
    const edit = event.target.closest('[data-edit]');
    const open = event.target.closest('[data-open]');
    const id = edit?.dataset.edit || open?.dataset.open;
    if (id) { const project = state.projects.find(p => p.id === id); state.current = structuredClone(project); saveState(); location.href = 'editor.html'; }
  });
  document.getElementById('librarySearch').addEventListener('input', render);
  document.getElementById('librarySort').addEventListener('change', render);
  render();
}
function initInventory() {
  const reserveRange = document.getElementById('reserveRange');
  function rowsData() { return aggregateInventory(); }
  function render() {
    state.reserve = Number(reserveRange.value);
    document.getElementById('reserveOut').textContent = `${state.reserve}%`;
    const rows = rowsData();
    document.getElementById('inventoryBody').innerHTML = rows.map(row =>
      `<tr><td><span class="pill"><i style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${row.color}"></i>${row.code}</span></td><td>${row.name}</td><td>${row.count}</td><td>${Math.ceil(row.count * (1 + state.reserve / 100))}</td></tr>`).join('');
    const total = rows.reduce((a, b) => a + b.count, 0);
    document.getElementById('totalBeads').textContent = total.toLocaleString('zh-CN');
    document.getElementById('totalColors').textContent = rows.length;
    document.getElementById('reserveBeads').textContent = Math.ceil(total * (1 + state.reserve / 100)).toLocaleString('zh-CN');
    saveState();
  }
  reserveRange.value = state.reserve;
  reserveRange.addEventListener('input', render);
  document.getElementById('exportPngBtn')?.addEventListener('click', () => exportInventory('png'));
  document.getElementById('exportPdfBtn')?.addEventListener('click', () => exportInventory('pdf'));
  render();
}
/* Render the inventory table to a canvas with color swatches, then save as
   PNG, or open a print window for PDF. Date + Bead Loom watermark bottom-right. */
function exportInventory(format) {
  const rows = aggregateInventory();
  const reserve = state.reserve;
  const pad = 48, rowH = 46, headH = 130, footH = 70;
  const width = 900;
  const height = headH + rowH * (rows.length + 1) + footH;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fffaf1'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#231f1a';
  ctx.font = 'bold 34px Georgia, serif';
  ctx.fillText('Bead Loom 像素豆清单', pad, 56);
  ctx.font = '16px ui-sans-serif, system-ui';
  ctx.fillStyle = '#6f6558';
  ctx.fillText(`备货比例 ${reserve}% · 颜色 ${rows.length} 种`, pad, 86);
  // header row
  let y = headH;
  const cols = [pad, pad + 200, pad + 420, pad + 620];
  ctx.fillStyle = '#6f6558'; ctx.font = 'bold 15px ui-sans-serif, system-ui';
  ['编码', '颜色', '用量', '准备量'].forEach((h, i) => ctx.fillText(h, cols[i], y));
  ctx.strokeStyle = 'rgba(35,31,26,.2)'; ctx.beginPath(); ctx.moveTo(pad, y + 12); ctx.lineTo(width - pad, y + 12); ctx.stroke();
  y += 16;
  ctx.font = '17px ui-sans-serif, system-ui';
  rows.forEach(row => {
    y += rowH;
    // color block on left, code on right
    ctx.fillStyle = row.color; ctx.fillRect(cols[0], y - 22, 26, 26);
    ctx.strokeStyle = 'rgba(35,31,26,.25)'; ctx.strokeRect(cols[0], y - 22, 26, 26);
    ctx.fillStyle = '#231f1a'; ctx.fillText(row.code, cols[0] + 36, y);
    ctx.fillText(row.name, cols[1], y);
    ctx.fillText(String(row.count), cols[2], y);
    ctx.fillText(String(Math.ceil(row.count * (1 + reserve / 100))), cols[3], y);
    ctx.strokeStyle = 'rgba(35,31,26,.08)'; ctx.beginPath(); ctx.moveTo(pad, y + 14); ctx.lineTo(width - pad, y + 14); ctx.stroke();
  });
  // bottom-right print date + watermark
  const date = new Date().toLocaleDateString('zh-CN');
  ctx.textAlign = 'right';
  ctx.fillStyle = '#6f6558'; ctx.font = '15px ui-sans-serif, system-ui';
  ctx.fillText(`打印日期 ${date}`, width - pad, height - 38);
  ctx.fillStyle = 'rgba(35,31,26,.45)'; ctx.font = 'bold 22px Georgia, serif';
  ctx.fillText('Bead Loom', width - pad, height - 14);
  ctx.textAlign = 'left';
  if (format === 'png') {
    const link = document.createElement('a'); link.download = 'bead-inventory.png'; link.href = canvas.toDataURL('image/png'); link.click();
    toast('已导出 PNG 清单。');
  } else {
    const dataUrl = canvas.toDataURL('image/png');
    const win = window.open('', '_blank');
    win.document.write(`<html><head><title>Bead Loom 清单</title><style>@page{margin:12mm}body{margin:0}img{width:100%}</style></head><body><img src="${dataUrl}" onload="window.print()" /></body></html>`);
    win.document.close();
    toast('已打开打印 / 另存 PDF。');
  }
}

function exportOptions() {
  return {
    watermark: document.getElementById('includeWatermark')?.checked,
    stats: document.getElementById('includeStats')?.checked, // merged: stats + codes
    text: document.getElementById('watermarkText')?.value || 'Bead Loom',
    opacity: Number(document.getElementById('watermarkOpacity')?.value || 32),
    density: Number(document.getElementById('watermarkDensity')?.value || 3)
  };
}
/* Compose a project onto a canvas with optional watermark + stats footer. */
function composeExport(canvas, project, opt) {
  const statsH = opt.stats ? 360 : 0;
  canvas.width = 1200; canvas.height = 1200 + statsH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fffaf1'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  // pattern in top 1200 square, codes shown when stats on
  const tmp = document.createElement('canvas'); tmp.width = 1200; tmp.height = 1200;
  drawPattern(tmp, project, { grid: true, codes: opt.stats });
  ctx.drawImage(tmp, 0, 0);
  if (opt.watermark) drawWatermark(ctx, canvas.width, 1200, opt);
  if (opt.stats) {
    ctx.fillStyle = '#fff8eb'; ctx.fillRect(0, 1200, canvas.width, statsH);
    ctx.strokeStyle = 'rgba(35,31,26,.12)'; ctx.beginPath(); ctx.moveTo(0, 1200); ctx.lineTo(canvas.width, 1200); ctx.stroke();
    // exclude transparent beads from the color tally
    const rows = counts(project.grid, project.colors).map((count, i) => count && !project.colors[i].transparent ? { ...project.colors[i], count } : null).filter(Boolean).sort((a, b) => b.count - a.count);
    const beadTotal = rows.reduce((a, b) => a + b.count, 0);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#231f1a'; ctx.font = 'bold 32px Georgia, serif';
    ctx.fillText('统计信息', canvas.width / 2, 1250);
    // size · total beads · color count · print time
    const printed = new Date().toLocaleString('zh-CN', { hour12: false });
    ctx.font = '20px ui-sans-serif, system-ui'; ctx.fillStyle = '#6f6558';
    ctx.fillText(`尺寸 ${project.width}×${project.height}　·　${beadTotal.toLocaleString('zh-CN')} 颗　·　${rows.length} 色`, canvas.width / 2, 1286);
    ctx.fillText(`打印时间 ${printed}`, canvas.width / 2, 1314);
    ctx.textAlign = 'left';
    // centered grid of color chips, wrapping, never overlapping
    const perRow = 4, chipW = canvas.width / perRow, chipH = 44;
    ctx.font = '22px ui-sans-serif, system-ui';
    rows.forEach((row, i) => {
      const col = i % perRow, line = Math.floor(i / perRow);
      const cx = col * chipW + 40, cy = 1356 + line * chipH;
      if (cy > canvas.height - 16) return;
      ctx.fillStyle = row.color; ctx.fillRect(cx, cy - 18, 24, 24);
      ctx.strokeStyle = 'rgba(35,31,26,.25)'; ctx.strokeRect(cx, cy - 18, 24, 24);
      ctx.fillStyle = '#231f1a'; ctx.fillText(`${row.code} ×${row.count}`, cx + 32, cy);
    });
  }
  return canvas;
}
function initExport() {
  const grid = document.getElementById('exportGrid');
  const selectedIds = new Set(state.projects.map(p => p.id)); // default all selected
  function render() { renderProjectGrid(grid, state.projects, true, selectedIds); }
  function refreshPreviews() {
    // live watermark/stats preview on selected thumbnails
    const opt = exportOptions();
    grid.querySelectorAll('.pattern-card').forEach(card => {
      const project = state.projects.find(p => p.id === card.dataset.id);
      const img = card.querySelector('.pattern-preview');
      if (!project || !img) return;
      if (selectedIds.has(project.id)) {
        const c = document.createElement('canvas');
        composeExport(c, project, opt);
        img.src = c.toDataURL('image/png');
      } else if (project.thumbnail) {
        img.src = project.thumbnail;
      }
    });
  }
  function rerender() { render(); refreshPreviews(); }
  const opacity = document.getElementById('watermarkOpacity'), density = document.getElementById('watermarkDensity');
  opacity.addEventListener('input', () => { document.getElementById('opacityOut').textContent = `${opacity.value}%`; refreshPreviews(); });
  density.addEventListener('input', () => { document.getElementById('densityOut').textContent = ['很低', '低', '中', '高', '很高'][density.value - 1]; refreshPreviews(); });
  ['includeWatermark', 'includeStats', 'watermarkText'].forEach(id => document.getElementById(id)?.addEventListener('input', refreshPreviews));
  document.getElementById('selectAllExportBtn').addEventListener('click', () => { state.projects.forEach(p => selectedIds.add(p.id)); rerender(); });
  document.getElementById('deselectAllExportBtn')?.addEventListener('click', () => { selectedIds.clear(); rerender(); });
  document.getElementById('watermarkUpload').addEventListener('change', event => {
    const file = event.target.files[0]; if (!file) return;
    customWatermark = new Image(); customWatermark.onload = () => { toast('水印图片已载入。'); refreshPreviews(); }; customWatermark.src = URL.createObjectURL(file);
  });
  grid.addEventListener('click', event => {
    const card = event.target.closest('.pattern-card');
    if (!card) return;
    const project = state.projects.find(p => p.id === card.dataset.id);
    if (event.target.closest('[data-open]') && event.detail === 2) return; // ignore
    // single click toggles selection (ring); open dialog on the small image only via dblclick
    selectedIds.has(project.id) ? selectedIds.delete(project.id) : selectedIds.add(project.id);
    card.classList.toggle('selected', selectedIds.has(project.id));
    refreshPreviews();
  });
  grid.addEventListener('dblclick', event => {
    const card = event.target.closest('.pattern-card'); if (!card) return;
    const project = state.projects.find(p => p.id === card.dataset.id);
    const dlg = document.getElementById('detailDialog');
    composeExport(document.getElementById('detailCanvas'), project, exportOptions());
    dlg.showModal();
  });
  document.getElementById('closeDialogBtn').addEventListener('click', () => document.getElementById('detailDialog').close());
  document.getElementById('downloadBtn').addEventListener('click', () => {
    const selected = state.projects.filter(p => selectedIds.has(p.id));
    if (!selected.length) return toast('请选择图案。');
    const opt = exportOptions();
    selected.forEach((project, index) => {
      const canvas = document.createElement('canvas');
      composeExport(canvas, project, opt);
      const link = document.createElement('a'); link.download = `${project.name || 'pattern'}-${index + 1}.png`; link.href = canvas.toDataURL('image/png'); link.click();
    });
    toast('已导出选中图案。');
  });
  rerender();
}

/* Mobile: on small/portrait screens, collapse the side nav behind a toggle so the
   five sections don't eat vertical space, and let users show/hide it on demand. */
function initMobileNav() {
  const nav = document.querySelector('.side-nav');
  if (!nav) return;
  const isMobile = () => window.matchMedia('(max-width: 760px)').matches;
  // inject a floating toggle button once
  let toggle = document.getElementById('navToggle');
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.id = 'navToggle';
    toggle.className = 'nav-toggle';
    toggle.setAttribute('aria-label', '显示或隐藏导航');
    toggle.innerHTML = '<span></span><span></span><span></span>';
    document.body.appendChild(toggle);
  }
  function apply() {
    if (isMobile()) {
      document.body.classList.add('mobile');
      nav.classList.add('collapsible');
      toggle.style.display = 'grid';
    } else {
      document.body.classList.remove('mobile', 'nav-open');
      nav.classList.remove('collapsible');
      toggle.style.display = 'none';
    }
  }
  toggle.addEventListener('click', () => document.body.classList.toggle('nav-open'));
  // collapse the menu after picking a destination
  nav.querySelectorAll('nav a').forEach(a => a.addEventListener('click', () => document.body.classList.remove('nav-open')));
  window.addEventListener('resize', apply);
  apply();
}

initMobileNav();

if (page === 'convert') initConvert();
if (page === 'editor') initEditor();
if (page === 'library') initLibrary();
if (page === 'inventory') initInventory();
if (page === 'export') initExport();
