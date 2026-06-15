# home-eink

A GitHub Actions pipeline that renders a daily image for a **Waveshare Spectra 6** e-ink display (800 × 480 px, 6-colour palette) and commits it back to the repository so a connected device can pull and display it.

---

## Hardware target

| Property | Value |
|---|---|
| Display | Waveshare Spectra 6 |
| Resolution | 800 × 480 px |
| Palette | Black, White, Red, Yellow, Blue, Green |
| Colour depth | 6 colours (no greyscale, no gradients) |

Because the display only understands 6 discrete colours, every rendered image must be **quantised** to that palette before it can be sent to the device.

---

## How it works

### 1. Schedule

GitHub Actions runs the workflow three times a day at fixed UTC times (equivalent to 05:00, 12:00, and 17:00 CET / UTC+1):

```
05:00 CET  →  morning render
12:00 CET  →  midday render
17:00 CET  →  afternoon render
```

The workflow can also be triggered manually via `workflow_dispatch`.

### 2. Data sources

**Weather** — [Open-Meteo](https://open-meteo.com/) (free, no API key required)  
Location: Berlin, Germany (52.438°N 13.385°E)  
Fields fetched: current temperature, hourly precipitation probability, hourly precipitation (mm).

**Rubbish collection** — `assets/data/trash.csv`  
A plain CSV file with two columns (`type`, `date`) listing upcoming collection days.  
Supported types and their palette colours:

| CSV value | Label | Colour |
|---|---|---|
| `biomuell` | Biomüll | Green |
| `wertstoffe` | Wertstoffe | Yellow |
| `restmuell` | Restmüll | Black |
| `papier` | Papier | Blue |

### 3. Image selection

Two images are composed for each render: a **headline** and an **illustration**.

**Headline** (left side, text/label graphic):

| Condition | Image |
|---|---|
| Morning render and rubbish collected today | `{type}-today.png` |
| Midday/afternoon render and rubbish collected tomorrow | `{type}-tomorrow.png` |
| Neither applies | *(no headline)* |

**Illustration** (right side, decorative):

| Condition | Image |
|---|---|
| Headline is shown (trash reminder) | Random `normal-01` – `normal-03` |
| Temperature < 5 °C | `standby-cold-01` |
| Temperature > 29 °C | Random `standby-warm-01` – `standby-warm-02` |
| Precipitation > 2 mm | `standby-rain-01` |
| Otherwise | Random `standby-normal-01` – `standby-normal-09` |

All source images live in `assets/images/`.

### 4. Layout

- When a **headline is present**: headline on the left, illustration on the right.  
  The headline is cropped to its actual content width (right-side whitespace trimmed via pixel scanning) and scaled to fill the display height. Both images are capped at **50 % of the display width** (400 px) to keep them balanced.
- When **no headline**: the illustration is centred across the full 800 × 480 area.

### 5. Palette quantisation — Floyd-Steinberg dithering

After the scene is drawn with the Canvas 2D API, the raw RGBA pixel data is quantised to the 6-colour Spectra palette using the **Floyd-Steinberg** error-diffusion algorithm:

1. For each pixel, find the closest palette entry (nearest-neighbour in RGB space).
2. Compute the quantisation error (difference between original and chosen colour).
3. Distribute that error to the four neighbouring pixels using the classic 7 / 3 / 5 / 1 weights.

**White-area protection**: pixels that are pure white (all channels ≥ 250) in the rendered scene are snapshotted before dithering begins. During the dither pass they are forced back to white and emit no error, preventing colour bleed from adjacent dithered regions into large white areas.

### 6. Stale data warning

If `assets/data/trash.csv` contains no entries with a date after today, a red **"Update trash data!"** badge is drawn in the lower-right corner of the display. This serves as a visible reminder to extend the schedule before the data runs out.

### 7. Output

The finished image is written to `output/display.png` and committed back to the repository by the workflow bot (`github-actions[bot]`). Commits that produce no pixel change are skipped. The commit message includes `[skip ci]` to prevent re-triggering the workflow.

---

## Repository layout

```
assets/
  data/
    trash.csv          # rubbish collection schedule
  images/
    *-today.png        # trash-reminder headline images
    *-tomorrow.png
    normal-*.png       # illustration variants (trash-reminder days)
    standby-*.png      # illustration variants (weather / default)
output/
  display.png          # latest rendered image (generated, not committed)
render.js              # rendering script (Node.js ESM)
package.json
.github/
  workflows/
    render.yml         # GitHub Actions workflow
```

---

## Running locally

Requires **Node.js 20+** and system libraries for [node-canvas](https://github.com/Automattic/node-canvas).

On Ubuntu / Debian (as used in CI):
```bash
sudo apt-get install libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

On macOS the libraries are typically available via Xcode Command Line Tools. If the native build fails, ensure your Xcode SDK is up to date.

```bash
npm ci
node render.js
# output/display.png is written to disk
```

---

## Extending

**Adding a new rubbish type** — add a row to `assets/data/trash.csv` and an entry to `TRASH_META` in `render.js` with the display label, palette colour, and image filename prefix. Place matching `{prefix}-today.png` and `{prefix}-tomorrow.png` files in `assets/images/`.

**Changing the schedule** — edit the `cron` entries in `.github/workflows/render.yml`. All times are UTC; Germany is UTC+1 (CET) / UTC+2 (CEST).

**Changing the location** — update the `latitude` and `longitude` query parameters in `fetchWeather()` inside `render.js`.
