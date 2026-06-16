import { createCanvas, loadImage } from 'canvas';
import fs from 'fs';
import path from 'path';

const WIDTH  = 800;
const HEIGHT = 480;
const IMAGES = path.join(process.cwd(), 'assets/images');

// Waveshare Spectra 6 palette (black, white, red, yellow, blue, green)
const PALETTE = [
  [0,   0,   0  ],  // 0 black
  [255, 255, 255],  // 1 white
  [255, 0,   0  ],  // 2 red
  [255, 255, 0  ],  // 3 yellow
  [0,   0,   255],  // 4 blue
  [0,   128, 0  ],  // 5 green
];

function closestPaletteIndex(r, g, b) {
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < PALETTE.length; i++) {
    const [pr, pg, pb] = PALETTE[i];
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

function floydSteinberg(data, w, h) {
  // Snapshot which pixels are originally white so accumulated error from
  // neighbouring colours cannot corrupt them into non-white palette entries.
  const origWhite = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) {
    const j = k * 4;
    if (data[j] >= 250 && data[j + 1] >= 250 && data[j + 2] >= 250) origWhite[k] = 1;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;

      if (origWhite[y * w + x]) {
        // Force to white and emit no error — white areas stay clean
        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
        continue;
      }

      const or_ = data[i], og = data[i + 1], ob = data[i + 2];
      const pi = closestPaletteIndex(or_, og, ob);
      const [nr, ng, nb] = PALETTE[pi];
      data[i] = nr; data[i + 1] = ng; data[i + 2] = nb;
      const er = or_ - nr, eg = og - ng, eb = ob - nb;
      function addErr(dx, dy, f) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny >= h) return;
        const j = (ny * w + nx) * 4;
        data[j]     = Math.max(0, Math.min(255, data[j]     + er * f));
        data[j + 1] = Math.max(0, Math.min(255, data[j + 1] + eg * f));
        data[j + 2] = Math.max(0, Math.min(255, data[j + 2] + eb * f));
      }
      addErr( 1, 0,  7 / 16);
      addErr(-1, 1,  3 / 16);
      addErr( 0, 1,  5 / 16);
      addErr( 1, 1,  1 / 16);
    }
  }
}

function timeOfDay(hour) {
  if (hour >= 5  && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening';
}

const THEMES = {
  morning:   { accent: PALETTE[5] },
  afternoon: { accent: PALETTE[4] },
  evening:   { accent: PALETTE[2] },
};

function rgbStr([r, g, b]) { return `rgb(${r},${g},${b})`; }

// Draw an image scaled to fit within a bounding box, centred
function fitImage(ctx, img, x, y, maxW, maxH) {
  const scale = Math.min(maxW / img.width, maxH / img.height);
  const dw = img.width  * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (maxW - dw) / 2, y + (maxH - dh) / 2, dw, dh);
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Scan pixel columns right-to-left (p5-style pixels[] loop) to find the
// rightmost column that contains at least one non-white pixel.
// Returns the content width in the image's native pixel space.
function measureContentWidth(img) {
  const off = createCanvas(img.width, img.height);
  const offCtx = off.getContext('2d');
  offCtx.drawImage(img, 0, 0);
  const { data } = offCtx.getImageData(0, 0, img.width, img.height);
  const W = img.width, H = img.height;

  for (let x = W - 1; x >= 0; x--) {
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4;
      if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) {
        return x + 1; // rightmost non-white column found
      }
    }
  }
  return W; // fully opaque / no whitespace detected
}

// ── Trash ─────────────────────────────────────────────────────────────────────

const TRASH_META = {
  biomuell:   { label: 'Biomüll',    color: PALETTE[5], filename: 'biomuell'    },
  wertstoffe: { label: 'Wertstoffe', color: PALETTE[3], filename: 'wertstoffe'  },
  restmuell:  { label: 'Restmüll',   color: PALETTE[0], filename: 'restmuell'   },
  papier:     { label: 'Papier',     color: PALETTE[4], filename: 'papiermuell' },
};

function parseTrash() {
  const csv = fs.readFileSync(
    path.join(process.cwd(), 'assets/data/trash.csv'), 'utf8'
  );
  const entries = csv.trim().split('\n').slice(1).map(line => {
    const [type, date] = line.split(',');
    return { type: type.trim(), date: date.trim() };
  });

  const berlinDate = (offsetMs = 0) =>
    new Date(Date.now() + offsetMs)
      .toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });

  const todayStr    = berlinDate();
  const tomorrowStr = berlinDate(24 * 60 * 60 * 1000);

  return {
    today:    entries.find(e => e.date === todayStr)?.type    ?? null,
    tomorrow: entries.find(e => e.date === tomorrowStr)?.type ?? null,
    stale:    !entries.some(e => e.date > todayStr),
  };
}

// ── Image selection ───────────────────────────────────────────────────────────

function selectImages(tod, weather, trash) {
  let headlineFile = null;

  // Headline rule
  if (tod === 'morning' && trash.today) {
    const meta = TRASH_META[trash.today];
    if (meta) headlineFile = path.join(IMAGES, `${meta.filename}-today.png`);
  } else if ((tod === 'afternoon' || tod === 'evening') && trash.tomorrow) {
    const meta = TRASH_META[trash.tomorrow];
    if (meta) headlineFile = path.join(IMAGES, `${meta.filename}-tomorrow.png`);
  }

  // Illustration rule
  let illustrationFile;
  if (headlineFile) {
    illustrationFile = path.join(IMAGES, pick(['normal-01.png', 'normal-02.png', 'normal-03.png']));
  } else if (weather.temp !== null && weather.temp < 5) {
    illustrationFile = path.join(IMAGES, 'standby-cold-01.png');
  } else if (weather.temp !== null && weather.temp > 29) {
    illustrationFile = path.join(IMAGES, pick(['standby-warm-01.png', 'standby-warm-02.png']));
  } else if (weather.precipitation !== null && weather.precipitation > 2) {
    illustrationFile = path.join(IMAGES, 'standby-rain-01.png');
  } else {
    illustrationFile = path.join(IMAGES, pick([
      'standby-normal-01.png', 'standby-normal-02.png', 'standby-normal-03.png',
      'standby-normal-04.png', 'standby-normal-05.png', 'standby-normal-06.png',
      'standby-normal-07.png', 'standby-normal-08.png', 'standby-normal-09.png',
    ]));
  }

  return { headlineFile, illustrationFile };
}

// ── Weather ───────────────────────────────────────────────────────────────────

async function fetchWeather() {
  try {
    const res = await fetch(
      'https://api.open-meteo.com/v1/forecast' +
      '?latitude=52.43837017657717&longitude=13.3850634242627' +
      '&current=temperature_2m' +
      '&hourly=precipitation_probability,precipitation' +
      '&timezone=Europe%2FBerlin' +
      '&forecast_days=1'
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const temp = Math.round(data.current.temperature_2m);
    const idx  = data.hourly.time.findIndex(t =>
      t.slice(0, 13) === data.current.time.slice(0, 13)
    );
    const rain          = idx >= 0 ? data.hourly.precipitation_probability[idx] : null;
    const precipitation = idx >= 0 ? data.hourly.precipitation[idx]             : null;
    return { temp, rain, precipitation };
  } catch (e) {
    console.error('Weather fetch failed:', e.message);
    return { temp: null, rain: null, precipitation: null };
  }
}

// ── Drawing ───────────────────────────────────────────────────────────────────

function drawScene(ctx, now, headlineImg, illustrationImg, trashStale) {
  const deHour = Number(
    now.toLocaleString('en-US', { timeZone: 'Europe/Berlin', hour: 'numeric', hour12: false })
  ) % 24;
  const tod   = timeOfDay(deHour);
  const theme = THEMES[tod];

  // Background
  ctx.fillStyle = rgbStr(PALETTE[1]);
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // ── Image area ───────────────────────────────────────────────────────────────
  const IMG_TOP = 0;
  const IMG_H   = HEIGHT - 32;   // leave room for footer

  if (headlineImg) {
    // Measure how far content (non-white pixels) extends on the x-axis
    const contentPx = measureContentWidth(headlineImg);
    console.log(`  headline content width: ${contentPx} / ${headlineImg.width} px`);

    // Scale headline so its height fills the image area, trim right whitespace.
    // Neither image may exceed 50% of the scene width.
    const MAX_W         = Math.floor(WIDTH / 2);
    const GAP           = 16;
    const headlineScale = IMG_H / headlineImg.height;
    const headlineW     = Math.min(Math.round(contentPx * headlineScale), MAX_W);
    const illustrationW = Math.min(WIDTH - headlineW - GAP, MAX_W);

    // Headline left-aligned, cropped to content, aspect-ratio preserved
    const hScale = Math.min(headlineW / contentPx, IMG_H / headlineImg.height);
    const hDw    = Math.round(contentPx        * hScale);
    const hDh    = Math.round(headlineImg.height * hScale);
    ctx.drawImage(
      headlineImg,
      0, 0, contentPx, headlineImg.height,                            // source: crop to content
      0, IMG_TOP + Math.round((IMG_H - hDh) / 2), hDw, hDh,         // dest:   left edge, centred vertically
    );

    // Illustration right-aligned (any unused space falls between the two)
    fitImage(ctx, illustrationImg, WIDTH - illustrationW, IMG_TOP, illustrationW, IMG_H);
  } else {
    // No headline — illustration fills the full area
    fitImage(ctx, illustrationImg, 0, IMG_TOP, WIDTH, IMG_H);
  }

  // ── Footer ────────────────────────────────────────────────────────────────────
  const FOOTER_Y = HEIGHT - 24;
  const ts = now.toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' });
  ctx.fillStyle = rgbStr(PALETTE[0]);
  ctx.font = '12px monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(ts, 8, FOOTER_Y + 12);

  if (trashStale) {
    const WARNING = 'Update trash data!';
    ctx.font = 'bold 14px sans-serif';
    const tw  = ctx.measureText(WARNING).width;
    const PAD = 8;
    const bx  = WIDTH - tw - PAD * 2 - 8;
    const by  = FOOTER_Y - 1;
    const bh  = 26;
    ctx.fillStyle = rgbStr(PALETTE[2]);       // red box
    ctx.fillRect(bx, by, tw + PAD * 2, bh);
    ctx.fillStyle = rgbStr(PALETTE[1]);       // white text
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(WARNING, bx + PAD, by + bh / 2);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const canvas = createCanvas(WIDTH, HEIGHT);
const ctx    = canvas.getContext('2d');
const now    = new Date();

const deHour = Number(
  now.toLocaleString('en-US', { timeZone: 'Europe/Berlin', hour: 'numeric', hour12: false })
) % 24;
const tod = timeOfDay(deHour);

const [weather, trash] = await Promise.all([fetchWeather(), Promise.resolve(parseTrash())]);
console.log('Weather:', weather);
console.log('Trash:  ', trash);

const { headlineFile, illustrationFile } = selectImages(tod, weather, trash);
console.log('Headline:    ', headlineFile    ? path.basename(headlineFile)    : '(none)');
console.log('Illustration:', path.basename(illustrationFile));

const [headlineImg, illustrationImg] = await Promise.all([
  headlineFile ? loadImage(headlineFile) : Promise.resolve(null),
  loadImage(illustrationFile),
]);

drawScene(ctx, now, headlineImg, illustrationImg, trash.stale);

const imgData = ctx.getImageData(0, 0, WIDTH, HEIGHT);
floydSteinberg(imgData.data, WIDTH, HEIGHT);
ctx.putImageData(imgData, 0, 0);

const outDir  = path.join(process.cwd(), 'output');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const outPath = path.join(outDir, 'display.png');
const buf     = canvas.toBuffer('image/png');
fs.writeFileSync(outPath, buf);
console.log(`Saved ${buf.length} bytes → ${outPath}`);
