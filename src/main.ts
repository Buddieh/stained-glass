import './style.css';
import { DEFAULT_PARAMS, type DesignResult, type Params } from './pipeline/types';
import { Viewer } from './viewer';
import { build3mf } from './export/threemf';
import { stlZip } from './export/stl';
import { buildSvg } from './export/svg';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const BED_MM = 256; // Bambu Lab P1S / X1 / A1 build plate
const MAX_PX = 1800; // per side, keeps processing time reasonable
const PETG_DENSITY = 1.27; // g/cm³

type Crop = { x: number; y: number; w: number; h: number };
let source: HTMLCanvasElement | null = null; // full-resolution source pixels
let crop: Crop | null = null;
let params: Params = { ...DEFAULT_PARAMS };
let result: DesignResult | null = null;
let baseName = 'stained-glass';

const viewer = new Viewer($('viewer'));
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let jobId = 0;

// ---------- controls ----------

const sliders: [string, keyof Params, (v: number) => string][] = [
  ['colors', 'colors', (v) => String(v)],
  ['minPiece', 'minPieceMm2', (v) => `${v}`],
  ['smooth', 'smoothingMm', (v) => v.toFixed(2)],
  ['cameW', 'cameWidth', (v) => v.toFixed(1)],
  ['cameH', 'cameHeight', (v) => v.toFixed(1)],
  ['paneT', 'paneThickness', (v) => `${v.toFixed(1)} (${Math.round(v / 0.2)} layers @0.2)`],
  ['border', 'borderMm', (v) => v.toFixed(1)],
];
for (const [id, key, fmt] of sliders) {
  const input = $<HTMLInputElement>(id);
  const out = $<HTMLOutputElement>(id + 'Out');
  input.value = String(params[key]);
  out.textContent = fmt(Number(input.value));
  input.addEventListener('input', () => {
    (params as unknown as Record<string, number>)[key] = Number(input.value);
    out.textContent = fmt(Number(input.value));
    schedule();
  });
}
const detail = $<HTMLSelectElement>('detail');
detail.value = String(params.mmPerPx);
detail.addEventListener('change', () => { params.mmPerPx = Number(detail.value); schedule(); });
const mirror = $<HTMLInputElement>('mirror');
mirror.checked = params.mirror;
mirror.addEventListener('change', () => { params.mirror = mirror.checked; schedule(); });

const widthIn = $<HTMLInputElement>('widthMm');
const heightIn = $<HTMLInputElement>('heightMm');
widthIn.value = String(params.widthMm);
heightIn.value = String(params.heightMm);
const aspect = () => (crop ? crop.h / crop.w : 1);
widthIn.addEventListener('change', () => {
  params.widthMm = clamp(Number(widthIn.value) || 150, 20, 1000);
  params.heightMm = round1(params.widthMm * aspect());
  syncSize();
  schedule();
});
heightIn.addEventListener('change', () => {
  params.heightMm = clamp(Number(heightIn.value) || 150, 20, 1000);
  params.widthMm = round1(params.heightMm / aspect());
  syncSize();
  schedule();
});
function syncSize() {
  widthIn.value = String(params.widthMm);
  heightIn.value = String(params.heightMm);
  const hint = $('sizeHint');
  if (params.widthMm > BED_MM || params.heightMm > BED_MM) {
    hint.textContent = `Larger than a 256 × 256 mm bed. Fine for the preview, but it won't fit a P1S in one piece.`;
    hint.classList.add('warn');
  } else {
    hint.textContent = 'Drag on the image to crop. The aspect ratio follows the crop.';
    hint.classList.remove('warn');
  }
}
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

// ---------- image loading ----------

const fileInput = $<HTMLInputElement>('file');
const drop = $('drop');
fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) loadFile(fileInput.files[0]); });
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = e.dataTransfer?.files?.[0];
  if (f) loadFile(f);
});
$('sample').addEventListener('click', () => { baseName = 'sample-sunrise'; setSource(sampleImage()); });

async function loadFile(file: File) {
  try {
    const bmp = await createImageBitmap(file);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    baseName = file.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').slice(0, 40) || 'stained-glass';
    $('dropText').textContent = file.name;
    setSource(c);
  } catch {
    setStatus('Could not read that image. Try a PNG or JPG.');
  }
}

function setSource(c: HTMLCanvasElement) {
  source = c;
  crop = { x: 0, y: 0, w: c.width, h: c.height };
  params.heightMm = round1(params.widthMm * aspect());
  syncSize();
  $('srcEmpty').hidden = true;
  drawSource();
  run();
}

$('resetCrop').addEventListener('click', () => {
  if (!source) return;
  crop = { x: 0, y: 0, w: source.width, h: source.height };
  params.heightMm = round1(params.widthMm * aspect());
  syncSize();
  drawSource();
  run();
});

// ---------- crop canvas ----------

const srcCanvas = $<HTMLCanvasElement>('srcCanvas');
let scale = 1; // display px per source px
function drawSource(dragRect?: Crop) {
  if (!source) return;
  const wrap = srcCanvas.parentElement!;
  const maxW = wrap.clientWidth - 8, maxH = wrap.clientHeight - 8;
  scale = Math.min(maxW / source.width, maxH / source.height);
  srcCanvas.width = Math.round(source.width * scale);
  srcCanvas.height = Math.round(source.height * scale);
  const g = srcCanvas.getContext('2d')!;
  g.drawImage(source, 0, 0, srcCanvas.width, srcCanvas.height);
  const r = dragRect ?? crop;
  if (!r) return;
  g.fillStyle = 'rgba(0,0,0,0.5)';
  const x = r.x * scale, y = r.y * scale, w = r.w * scale, h = r.h * scale;
  g.fillRect(0, 0, srcCanvas.width, y);
  g.fillRect(0, y + h, srcCanvas.width, srcCanvas.height - y - h);
  g.fillRect(0, y, x, h);
  g.fillRect(x + w, y, srcCanvas.width - x - w, h);
  g.strokeStyle = '#fff';
  g.lineWidth = 1.5;
  g.setLineDash([5, 4]);
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}
let dragStart: { x: number; y: number } | null = null;
let dragRect: Crop | null = null;
const toSrc = (e: PointerEvent) => {
  const b = srcCanvas.getBoundingClientRect();
  return {
    x: clamp(((e.clientX - b.left) / b.width) * srcCanvas.width / scale, 0, source!.width),
    y: clamp(((e.clientY - b.top) / b.height) * srcCanvas.height / scale, 0, source!.height),
  };
};
srcCanvas.addEventListener('pointerdown', (e) => {
  if (!source) return;
  srcCanvas.setPointerCapture(e.pointerId);
  dragStart = toSrc(e);
});
srcCanvas.addEventListener('pointermove', (e) => {
  if (!dragStart || !source) return;
  const p = toSrc(e);
  dragRect = { x: Math.min(p.x, dragStart.x), y: Math.min(p.y, dragStart.y), w: Math.abs(p.x - dragStart.x), h: Math.abs(p.y - dragStart.y) };
  drawSource(dragRect);
});
srcCanvas.addEventListener('pointerup', () => {
  if (dragRect && dragRect.w * scale > 12 && dragRect.h * scale > 12) {
    crop = { x: Math.round(dragRect.x), y: Math.round(dragRect.y), w: Math.round(dragRect.w), h: Math.round(dragRect.h) };
    params.heightMm = round1(params.widthMm * aspect());
    syncSize();
    run();
  }
  dragStart = null;
  dragRect = null;
  drawSource();
});
new ResizeObserver(() => { drawSource(); drawDesign(); }).observe(srcCanvas.parentElement!);

// ---------- processing ----------

let timer = 0;
function schedule() {
  clearTimeout(timer);
  timer = window.setTimeout(run, 450);
}

function run() {
  if (!source || !crop) return;
  let res = params.mmPerPx;
  // keep the working image within MAX_PX per side
  res = Math.max(res, params.widthMm / MAX_PX, params.heightMm / MAX_PX);
  const w = Math.max(8, Math.round(params.widthMm / res));
  const h = Math.max(8, Math.round(params.heightMm / res));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h);
  const id = ++jobId;
  setStatus('Working…');
  worker.postMessage(
    { id, image: { width: w, height: h, data: data.data }, params: { ...params, mmPerPx: res } },
    [data.data.buffer],
  );
}

worker.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.id !== jobId) return; // a newer job is running
  if (msg.type === 'stage') setStatus(msg.stage + '…');
  else if (msg.type === 'error') setStatus('Something went wrong: ' + msg.message);
  else if (msg.type === 'done') showResult(msg.result as DesignResult);
};

function setStatus(s: string) { $('status').textContent = s; }

function showResult(r: DesignResult) {
  result = r;
  viewer.show(r, params.mirror);
  drawDesign();
  const glass = r.parts.filter((p) => p.kind === 'pane');
  const totalG = r.parts.reduce((s, p) => s + p.volumeMm3, 0) / 1000 * PETG_DENSITY;
  $('stats').textContent = `${r.pieceCount} pieces · ${glass.length} colors · ${r.widthMm.toFixed(0)} × ${r.heightMm.toFixed(0)} mm · ≈${totalG.toFixed(0)} g`;
  $('designEmpty').hidden = true;
  setStatus(`Ready in ${Object.values(r.timings).reduce((a, b) => a + b, 0)} ms. Drag to orbit, scroll to zoom.`);

  const list = $('partList');
  list.innerHTML = '';
  for (const p of r.parts) {
    const li = document.createElement('li');
    const grams = (p.volumeMm3 / 1000) * PETG_DENSITY;
    li.innerHTML = `<label><input type="checkbox" checked /> <span class="sw" style="background:${p.color}"></span>${p.kind === 'came' ? 'Lead lines' : p.color} <span class="muted">${grams.toFixed(1)} g</span></label>`;
    li.querySelector('input')!.addEventListener('change', (e) => viewer.setVisible(p.name, (e.target as HTMLInputElement).checked));
    list.appendChild(li);
  }
  for (const id of ['dl3mf', 'dlStl', 'dlSvg']) ($(id) as HTMLButtonElement).disabled = false;
}

function drawDesign() {
  if (!result) return;
  const canvas = $<HTMLCanvasElement>('designCanvas');
  const wrap = canvas.parentElement!;
  const s = Math.min((wrap.clientWidth - 8) / result.widthMm, (wrap.clientHeight - 8) / result.heightMm);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(result.widthMm * s * dpr);
  canvas.height = Math.round(result.heightMm * s * dpr);
  canvas.style.width = `${Math.round(result.widthMm * s)}px`;
  canvas.style.height = `${Math.round(result.heightMm * s)}px`;
  const g = canvas.getContext('2d')!;
  const k = s * dpr;
  const H = result.heightMm;
  const ordered = [...result.parts].sort((a, b) => (a.kind === 'came' ? 1 : 0) - (b.kind === 'came' ? 1 : 0));
  for (const p of ordered) {
    const path = new Path2D();
    for (const poly of p.polygons) {
      poly.forEach(([x, y], i) => (i ? path.lineTo(x * k, (H - y) * k) : path.moveTo(x * k, (H - y) * k)));
      path.closePath();
    }
    g.fillStyle = p.kind === 'came' ? '#1b1b1d' : p.color;
    g.fill(path, 'nonzero');
  }
}

// ---------- viewer toolbar ----------

const modeBtns = { backlit: $('modeBacklit'), room: $('modeRoom') };
for (const [mode, btn] of Object.entries(modeBtns)) {
  btn.addEventListener('click', () => {
    viewer.setMode(mode as 'backlit' | 'room');
    for (const b of Object.values(modeBtns)) b.classList.toggle('on', b === btn);
  });
}
$('flip').addEventListener('click', () => viewer.flipSide());
$('resetView').addEventListener('click', () => viewer.resetView());

// ---------- downloads ----------

function download(data: Uint8Array | string, name: string, type: string) {
  const blob = new Blob([data as BlobPart], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const sizeTag = () => (result ? `${Math.round(result.widthMm)}x${Math.round(result.heightMm)}mm` : '');
$('dl3mf').addEventListener('click', () => {
  if (result) download(build3mf(result.parts, baseName), `${baseName}-${sizeTag()}.3mf`, 'model/3mf');
});
$('dlStl').addEventListener('click', () => {
  if (result) download(stlZip(result.parts, printNotes()), `${baseName}-${sizeTag()}-stl.zip`, 'application/zip');
});
$('dlSvg').addEventListener('click', () => {
  if (result) download(buildSvg(result.parts, result.widthMm, result.heightMm), `${baseName}-${sizeTag()}.svg`, 'image/svg+xml');
});

function printNotes(): string {
  const layers = Math.round(params.paneThickness / 0.2);
  return [
    'Stained Glass Generator - print notes',
    '',
    `Panel ${sizeTag()}, glass ${params.paneThickness} mm, lead lines ${params.cameWidth} mm wide x ${params.cameHeight} mm high.`,
    '',
    'All STLs share one origin. In Bambu Studio / OrcaSlicer / PrusaSlicer, load them together and',
    'answer "yes" to loading as a single object with multiple parts, then assign one filament per part.',
    '',
    'Suggested settings (translucent PETG, 0.4 mm nozzle):',
    `- Layer height 0.2 mm (glass = ${layers} layers). Do not use a thicker first layer than 0.2 mm.`,
    '- Print face down: the bed side is the front. Smooth plate = glossy, textured plate = frosted.',
    '- Top/bottom surface pattern: monotonic or concentric; 100% solid for the glass.',
    '- No single-filament printer can do several glass colors in one print: use an AMS, or print',
    '  one glass color plus black lead lines with a filament change at the top of the glass layers.',
  ].join('\n');
}

// ---------- sample ----------

function sampleImage(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 900; c.height = 1200;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, 700);
  sky.addColorStop(0, '#1d3f8f'); sky.addColorStop(1, '#5c8fd6');
  g.fillStyle = sky; g.fillRect(0, 0, 900, 1200);
  // sun with rays
  g.save(); g.translate(450, 560);
  for (let i = 0; i < 16; i++) {
    g.rotate(Math.PI / 8);
    g.fillStyle = i % 2 ? '#f2b630' : '#f08a24';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(-90, -520); g.lineTo(90, -520); g.closePath(); g.fill();
  }
  g.fillStyle = '#ffd34d'; g.beginPath(); g.arc(0, 0, 170, 0, Math.PI * 2); g.fill();
  g.restore();
  // hills
  const hill = (y: number, amp: number, color: string, ph: number) => {
    g.fillStyle = color; g.beginPath(); g.moveTo(0, 1200);
    for (let x = 0; x <= 900; x += 10) g.lineTo(x, y + Math.sin(x / 140 + ph) * amp);
    g.lineTo(900, 1200); g.closePath(); g.fill();
  };
  hill(700, 60, '#2f8a43', 0.5);
  hill(820, 70, '#1f6b36', 2.2);
  hill(960, 50, '#7a3a8c', 4.0);
  hill(1080, 40, '#b8322c', 1.2);
  return c;
}
