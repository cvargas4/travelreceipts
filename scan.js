/* Trip Receipts — lightweight receipt scanner.
   Finds the receipt in a photo, lets you drag its corners, flattens the perspective,
   and evens out shadows. Plain JavaScript and <canvas>; no external libraries.

   Usage: const r = await ReceiptScanner.open(fileOrBlob, { name, allowOriginal });
     r === null                 → cancelled
     r.original === true        → keep the photo unchanged
     r.blob (image/jpeg)        → the scanned image */
'use strict';

(() => {
  const MAX_WORK = 3000;   // longest side of the working copy of the photo
  const MAX_OUT = 2200;    // longest side of the finished scan
  const DETECT = 360;      // longest side used for edge detection
  const FILTER_KEY = 'tripReceipts.scanFilter';
  const FILTERS = [['clean', 'Clean'], ['gray', 'Grayscale'], ['none', 'Original']];

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
  const isTouch = () => matchMedia('(pointer: coarse)').matches;
  const isAndroid = () => /Android/i.test(navigator.userAgent);
  // iPhone: the share sheet has "Save Image". Android's share sheet usually doesn't, so download instead.
  function saveMode(file) {
    if (isAndroid()) return { label: 'Save image', share: false };
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    return { label: isTouch() && canShare ? 'Save to Photos' : 'Download', share: canShare && isTouch() };
  }
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  const ICON = {
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>',
  };

  /* ---------------- canvas helpers ---------------- */

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  const ctx2d = (c) => c.getContext('2d', { willReadFrequently: true });

  function drawFit(src, maxDim) {
    const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
    const s = Math.min(1, maxDim / Math.max(sw, sh));
    const c = makeCanvas(sw * s, sh * s);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  function loadImage(blob) {
    const url = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This photo can't be opened in the scanner.")); };
      img.src = url;
    });
  }

  function toBlob(canvas, quality = 0.88) {
    return new Promise((resolve, reject) => canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Saving the scan failed.'))), 'image/jpeg', quality));
  }

  function rotateCanvas(src, turns) {
    turns = ((turns % 4) + 4) % 4;
    if (!turns) return src;
    const swap = turns % 2 === 1;
    const c = makeCanvas(swap ? src.height : src.width, swap ? src.width : src.height);
    const x = c.getContext('2d');
    x.translate(c.width / 2, c.height / 2);
    x.rotate(turns * Math.PI / 2);
    x.drawImage(src, -src.width / 2, -src.height / 2);
    return c;
  }

  /* ---------------- geometry ---------------- */

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const triArea = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  function polyArea(p) {
    let s = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) / 2;
  }

  // Order four points as top-left, top-right, bottom-right, bottom-left
  function orderQuad(pts) {
    const cx = pts.reduce((s, p) => s + p[0], 0) / 4;
    const cy = pts.reduce((s, p) => s + p[1], 0) / 4;
    const sorted = pts.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    let start = 0;
    sorted.forEach((p, i) => { if (p[0] + p[1] < sorted[start][0] + sorted[start][1]) start = i; });
    return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]);
  }

  function convexHull(points) {
    const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  // Shrink a convex polygon to 4 corners by repeatedly dropping the least important vertex
  function reduceToQuad(hull) {
    const p = hull.slice();
    while (p.length > 4) {
      let best = 0, bestA = Infinity;
      for (let i = 0; i < p.length; i++) {
        const a = triArea(p[(i - 1 + p.length) % p.length], p[i], p[(i + 1) % p.length]);
        if (a < bestA) { bestA = a; best = i; }
      }
      p.splice(best, 1);
    }
    return p.length === 4 ? p : null;
  }

  /* ---------------- edge detection ---------------- */

  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
    for (let y = 0; y < h; y++) {
      let acc = 0; const row = y * w;
      for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / (2 * r + 1);
        acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / (2 * r + 1);
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }

  function otsu(values) {
    let lo = Infinity, hi = -Infinity;
    for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi - lo < 1) return null;
    const hist = new Float64Array(256);
    const k = 255 / (hi - lo);
    for (const v of values) hist[Math.round((v - lo) * k)]++;
    const total = values.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let wB = 0, sumB = 0, best = 0, bestVar = -1;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > bestVar) { bestVar = between; best = t; }
    }
    return lo + best / k;
  }

  function morph(mask, w, h, erode) {
    const out = new Uint8Array(mask.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = erode ? 1 : 0;
        for (let dy = -1; dy <= 1 && (erode ? v : !v); dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const m = mask[yy * w + Math.min(w - 1, Math.max(0, x + dx))];
            if (erode && !m) { v = 0; break; }
            if (!erode && m) { v = 1; break; }
          }
        }
        out[y * w + x] = v;
      }
    }
    return out;
  }

  // Turn one candidate region into four corners plus a few measurements used to rank candidates
  function regionQuad(inRegion, W, H) {
    const pts = [];
    let filled = 0, touch = 0, cx = 0, cy = 0, rows = 0;
    for (let y = 0; y < H; y++) {
      let l = -1, r = -1;
      for (let x = 0; x < W; x++) if (inRegion(y * W + x)) { if (l < 0) l = x; r = x; }
      if (l < 0) continue;
      pts.push([l, y], [r + 1, y], [l, y + 1], [r + 1, y + 1]);
      filled += r - l + 1;
      cx += (l + r + 1) / 2; cy += y + 0.5; rows++;
      if (l === 0) touch++;
      if (r === W - 1) touch++;
      if (y === 0 || y === H - 1) touch += (r - l + 1) / W * (W / H);
    }
    if (!rows) return null;
    const hull = reduceToQuad(convexHull(pts));
    if (!hull) return null;
    const quad = orderQuad(hull);
    const qa = polyArea(quad);
    const n = W * H;
    if (qa < 0.05 * n || qa > 0.97 * n) return null;
    const rect = Math.min(1, filled / qa);                 // 1 = a clean four-sided shape
    const edge = Math.min(1, touch / (2 * H));            // share of the outline lying on the photo border
    const off = Math.hypot(cx / rows - W / 2, cy / rows - H / 2) / Math.hypot(W / 2, H / 2);
    const score = Math.pow(rect, 4) * (1 - 0.75 * edge) * (1 - 0.5 * off) * Math.sqrt(qa / n);
    return { quad, rect, score };
  }

  function components(mask, W, H) {
    const n = W * H, labels = new Int32Array(n), stack = new Int32Array(n), regions = [];
    let next = 0;
    for (let i = 0; i < n; i++) {
      if (!mask[i] || labels[i]) continue;
      next++;
      let top = 0, area = 0;
      stack[top++] = i; labels[i] = next;
      while (top) {
        const j = stack[--top];
        const x = j % W;
        area++;
        if (x > 0 && mask[j - 1] && !labels[j - 1]) { labels[j - 1] = next; stack[top++] = j - 1; }
        if (x < W - 1 && mask[j + 1] && !labels[j + 1]) { labels[j + 1] = next; stack[top++] = j + 1; }
        if (j >= W && mask[j - W] && !labels[j - W]) { labels[j - W] = next; stack[top++] = j - W; }
        if (j < n - W && mask[j + W] && !labels[j + W]) { labels[j + W] = next; stack[top++] = j + W; }
      }
      regions.push({ id: next, area });
    }
    return { labels, regions };
  }

  // Finds the receipt and returns its corners in `work` pixels, or null.
  // Two ways of finding candidate regions, then the most paper-like one wins:
  //  1. pale, low-colour pixels (works on dark or colourful tables)
  //  2. growing outward from the middle of the photo until hitting a sharp edge
  //     (passes through soft shadows; works on pale counters)
  function detectQuad(work) {
    const small = drawFit(work, DETECT);
    const W = small.width, H = small.height, n = W * H;
    const d = ctx2d(small).getImageData(0, 0, W, H).data;
    const raw = new Float32Array(n), lum = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = d[p], g = d[p + 1], b = d[p + 2];
      lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      raw[i] = lum[i] - 0.6 * (Math.max(r, g, b) - Math.min(r, g, b));
    }
    const score = boxBlur(raw, W, H, 2);
    const cands = [];
    const addFromMask = (mask) => {
      mask = morph(morph(mask, W, H, true), W, H, false);
      const { labels, regions } = components(mask, W, H);
      regions.filter((r) => r.area >= 0.03 * n).sort((a, b) => b.area - a.area).slice(0, 3)
        .forEach((r) => { const c = regionQuad((i) => labels[i] === r.id, W, H); if (c) cands.push(c); });
    };

    // 1. brightness thresholds: overall, and again within the brighter half
    const t1 = otsu(score);
    if (t1 != null) {
      addFromMask(Uint8Array.from(score, (v) => (v > t1 ? 1 : 0)));
      const bright = score.filter((v) => v > t1);
      const t2 = bright.length > 0.1 * n ? otsu(bright) : null;
      if (t2 != null) addFromMask(Uint8Array.from(score, (v) => (v > t2 ? 1 : 0)));
    }

    // 2. grow from the middle, stopping at sharp edges
    const L = boxBlur(lum, W, H, 1);
    const grad = new Float32Array(n);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        grad[i] = (Math.abs(L[i + 1] - L[i - 1]) + Math.abs(L[i + W] - L[i - W])) / 2;
      }
    }
    let seed = -1, best = -Infinity;
    for (let y = Math.round(H * 0.4); y < H * 0.6; y++) {
      for (let x = Math.round(W * 0.4); x < W * 0.6; x++) {
        const i = y * W + x;
        const v = score[i] - 4 * grad[i];
        if (v > best) { best = v; seed = i; }
      }
    }
    if (seed >= 0) {
      for (const T of [6, 10, 16]) {
        const grown = new Uint8Array(n), stack = new Int32Array(n);
        let top = 0;
        stack[top++] = seed; grown[seed] = 1;
        while (top) {
          const j = stack[--top];
          const x = j % W;
          const tryAdd = (k) => { if (!grown[k] && grad[k] < T) { grown[k] = 1; stack[top++] = k; } };
          if (x > 0) tryAdd(j - 1);
          if (x < W - 1) tryAdd(j + 1);
          if (j >= W) tryAdd(j - W);
          if (j < n - W) tryAdd(j + W);
        }
        const c = regionQuad((i) => grown[i] === 1, W, H);
        if (c) cands.push(c);
      }
    }

    const pick = cands.filter((c) => c.rect > 0.8).sort((a, b) => b.score - a.score)[0];
    if (!pick) return null;
    const ordered = pick.quad;
    // pull each corner ~1 detection pixel inward so a sliver of table doesn't show at the edges
    const mx = ordered.reduce((a, p) => a + p[0], 0) / 4, my = ordered.reduce((a, p) => a + p[1], 0) / 4;
    const sx = work.width / W, sy = work.height / H;
    return ordered.map(([x, y]) => {
      const len = Math.hypot(mx - x, my - y) || 1;
      return [
        Math.min(work.width, Math.max(0, (x + (mx - x) / len * 1.2) * sx)),
        Math.min(work.height, Math.max(0, (y + (my - y) / len * 1.2) * sy)),
      ];
    });
  }

  /* ---------------- perspective flattening ---------------- */

  function solve8(A, b) {
    const n = 8;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) return null;
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }

  // Maps output-rectangle points to points in the photo
  function homography(photoPts, rectPts) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [u, v] = rectPts[i], [x, y] = photoPts[i];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
    }
    return solve8(A, b);
  }

  function outputSize(q) {
    let w = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
    let h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
    const s = Math.min(1, MAX_OUT / Math.max(w, h));
    return [Math.max(16, Math.round(w * s)), Math.max(16, Math.round(h * s))];
  }

  function warp(srcData, sw, sh, q) {
    const [W, H] = outputSize(q);
    const h = homography(q, [[0, 0], [W, 0], [W, H], [0, H]]);
    if (!h) throw new Error('Those corners are too close together.');
    const out = new ImageData(W, H);
    const od = out.data, sd = srcData;
    const maxX = sw - 1.001, maxY = sh - 1.001, row = sw * 4;
    for (let v = 0; v < H; v++) {
      const vv = v + 0.5;
      const ax = h[1] * vv + h[2], ay = h[4] * vv + h[5], az = h[7] * vv + 1;
      for (let u = 0; u < W; u++) {
        const uu = u + 0.5;
        const z = h[6] * uu + az;
        let x = (h[0] * uu + ax) / z - 0.5;
        let y = (h[3] * uu + ay) / z - 0.5;
        x = x < 0 ? 0 : x > maxX ? maxX : x;
        y = y < 0 ? 0 : y > maxY ? maxY : y;
        const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
        const i00 = y0 * row + x0 * 4, i01 = i00 + row;
        const o = (v * W + u) * 4;
        for (let c = 0; c < 3; c++) {
          const top = sd[i00 + c] + (sd[i00 + 4 + c] - sd[i00 + c]) * fx;
          const bot = sd[i01 + c] + (sd[i01 + 4 + c] - sd[i01 + c]) * fx;
          od[o + c] = top + (bot - top) * fy;
        }
        od[o + 3] = 255;
      }
    }
    const c = makeCanvas(W, H);
    c.getContext('2d').putImageData(out, 0, 0);
    return c;
  }

  /* ---------------- shadow clean-up ---------------- */

  // Estimates how bright the paper is at each spot (ignoring the printing), then divides it out.
  // That turns shadows and uneven light into plain white paper and darkens faint print.
  function enhance(src, mode) {
    if (mode === 'none') return src;
    const W = src.width, H = src.height, n = W * H;
    const img = ctx2d(src).getImageData(0, 0, W, H);
    const d = img.data;
    const L = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) L[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];

    // paper brightness on a coarse grid: block averages, then a max filter to skip over text, then smooth
    const f = Math.max(4, Math.round(Math.max(W, H) / 280));
    const bw = Math.ceil(W / f), bh = Math.ceil(H / f);
    let bg = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        let s = 0, c = 0;
        for (let y = by * f; y < Math.min(H, by * f + f); y++) {
          for (let x = bx * f; x < Math.min(W, bx * f + f); x++) { s += L[y * W + x]; c++; }
        }
        bg[by * bw + bx] = s / c;
      }
    }
    const R = 2;
    for (let pass = 0; pass < 2; pass++) {
      const tmp = new Float32Array(bg.length);
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          let m = 0;
          for (let k = -R; k <= R; k++) {
            const v = pass === 0 ? bg[y * bw + Math.min(bw - 1, Math.max(0, x + k))] : bg[Math.min(bh - 1, Math.max(0, y + k)) * bw + x];
            if (v > m) m = v;
          }
          tmp[y * bw + x] = m;
        }
      }
      bg = tmp;
    }
    bg = boxBlur(bg, bw, bh, 2);

    const lo = mode === 'gray' ? 0.18 : 0.12, hi = 0.86, gamma = mode === 'gray' ? 1.6 : 1.35;
    const curve = (v) => {
      const t = (v - lo) / (hi - lo);
      return t <= 0 ? 0 : t >= 1 ? 255 : 255 * Math.pow(t, gamma);
    };
    for (let y = 0; y < H; y++) {
      const gy = Math.min(bh - 1.001, Math.max(0, (y + 0.5) / f - 0.5));
      const y0 = gy | 0, fy = gy - y0;
      for (let x = 0; x < W; x++) {
        const gx = Math.min(bw - 1.001, Math.max(0, (x + 0.5) / f - 0.5));
        const x0 = gx | 0, fx = gx - x0;
        const a = bg[y0 * bw + x0], b = bg[y0 * bw + x0 + 1];
        const c = bg[(y0 + 1) * bw + x0], e = bg[(y0 + 1) * bw + x0 + 1];
        const paper = Math.max(24, (a + (b - a) * fx) * (1 - fy) + (c + (e - c) * fx) * fy);
        const i = y * W + x, p = i * 4;
        if (mode === 'gray') {
          const v = curve(L[i] / paper);
          d[p] = d[p + 1] = d[p + 2] = v;
        } else {
          d[p] = curve(d[p] / paper);
          d[p + 1] = curve(d[p + 1] / paper);
          d[p + 2] = curve(d[p + 2] / paper);
        }
      }
    }
    const out = makeCanvas(W, H);
    out.getContext('2d').putImageData(img, 0, 0);
    return out;
  }

  /* ---------------- user interface ---------------- */

  let dlg = null;
  function ensureDialog() {
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.className = 'scanner';
      dlg.setAttribute('aria-label', 'Scan receipt');
      document.body.appendChild(dlg);
    }
    return dlg;
  }

  // Returns a short status message, or '' when the share sheet handles it
  function saveCopy(file) {
    if (saveMode(file).share) {
      navigator.share({ files: [file] }).catch(() => { /* cancelled */ });
      return '';
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return isAndroid() ? 'Saved to your Downloads folder. It also appears in your gallery app.' : 'Downloaded.';
  }

  async function open(blob, opts = {}) {
    const allowOriginal = opts.allowOriginal !== false;
    const baseName = (opts.name || 'Receipt').replace(/\.[^.]+$/, '') || 'Receipt';
    const d = ensureDialog();
    d.innerHTML = '<div class="sc-busy">Opening photo…</div>';
    if (!d.open) d.showModal();

    let work, srcData;
    try {
      const img = await loadImage(blob);
      await nextFrame();
      work = drawFit(img, MAX_WORK);
    } catch (err) {
      d.close();
      throw err;
    }

    const detected = detectQuad(work);
    const full = () => [[0, 0], [work.width, 0], [work.width, work.height], [0, work.height]];
    const st = {
      quad: detected || full(),
      found: !!detected,
      filter: FILTERS.some(([k]) => k === lsGet(FILTER_KEY)) ? lsGet(FILTER_KEY) : 'clean',
      turns: 0,
      warped: null, warpKey: '', enhanced: new Map(), file: null,
    };

    return new Promise((resolve) => {
      const cleanups = [];   // for the whole session
      let stepCleanups = []; // for the current step only
      const on = (el, ev, fn, o) => { el.addEventListener(ev, fn, o); stepCleanups.push(() => el.removeEventListener(ev, fn, o)); };
      const endStep = () => { stepCleanups.forEach((fn) => fn()); stepCleanups = []; };
      let done = false;
      function finish(result) {
        if (done) return;
        done = true;
        endStep();
        cleanups.forEach((fn) => fn());
        if (d.open) d.close();
        d.innerHTML = '';
        resolve(result);
      }
      const onCancel = (e) => { e.preventDefault(); finish(null); };
      d.addEventListener('cancel', onCancel);
      cleanups.push(() => d.removeEventListener('cancel', onCancel));

      /* ----- step 1: corners ----- */
      function showCrop() {
        endStep();
        st.file = null;
        d.innerHTML = `
          <div class="sc-head">
            <button type="button" class="sc-text" data-a="cancel">Cancel</button>
            <h2>Crop</h2>
            <button type="button" class="sc-text strong" data-a="next">Next</button>
          </div>
          <div class="sc-stage">
            <canvas class="sc-photo"></canvas>
            <canvas class="sc-overlay" aria-label="Receipt corners. Drag to adjust."></canvas>
            <canvas class="sc-loupe" hidden></canvas>
          </div>
          <p class="sc-hint">${st.found ? 'Drag the corners to the edges of the receipt.' : "Couldn't find the receipt's edges. Drag the corners into place."}</p>
          <div class="sc-tools">
            <button type="button" class="sc-btn" data-a="detect">Find edges</button>
            <button type="button" class="sc-btn" data-a="full">Whole photo</button>
            ${allowOriginal ? '<button type="button" class="sc-btn" data-a="original">Use photo as is</button>' : ''}
          </div>`;
        const stage = d.querySelector('.sc-stage');
        const photo = d.querySelector('.sc-photo');
        const ov = d.querySelector('.sc-overlay');
        const loupe = d.querySelector('.sc-loupe');
        const hint = d.querySelector('.sc-hint');
        const L = 112, PAD = 26;
        let scale = 1, ox = 0, oy = 0, dw = 0, dh = 0, sw = 0, shh = 0, dpr = 1;
        let active = -1, grab = [0, 0], raf = 0;

        function layout() {
          const r = stage.getBoundingClientRect();
          sw = r.width; shh = r.height;
          dpr = Math.min(3, window.devicePixelRatio || 1);
          scale = Math.min((sw - 2 * PAD) / work.width, (shh - 2 * PAD) / work.height);
          dw = work.width * scale; dh = work.height * scale;
          ox = (sw - dw) / 2; oy = (shh - dh) / 2;
          Object.assign(photo.style, { left: `${ox}px`, top: `${oy}px`, width: `${dw}px`, height: `${dh}px` });
          photo.width = Math.round(dw * dpr); photo.height = Math.round(dh * dpr);
          const pc = photo.getContext('2d');
          pc.imageSmoothingQuality = 'high';
          pc.drawImage(work, 0, 0, photo.width, photo.height);
          ov.width = Math.round(sw * dpr); ov.height = Math.round(shh * dpr);
          loupe.width = loupe.height = Math.round(L * dpr);
          draw();
        }
        const screenPts = () => st.quad.map(([x, y]) => [ox + x * scale, oy + y * scale]);

        function draw() {
          const c = ov.getContext('2d');
          c.setTransform(dpr, 0, 0, dpr, 0, 0);
          c.clearRect(0, 0, sw, shh);
          const p = screenPts();
          c.beginPath();
          c.rect(ox, oy, dw, dh);
          c.moveTo(p[0][0], p[0][1]);
          for (let i = 1; i < 4; i++) c.lineTo(p[i][0], p[i][1]);
          c.closePath();
          c.fillStyle = 'rgba(6, 10, 12, 0.55)';
          c.fill('evenodd');
          c.beginPath();
          c.moveTo(p[0][0], p[0][1]);
          for (let i = 1; i < 4; i++) c.lineTo(p[i][0], p[i][1]);
          c.closePath();
          c.lineWidth = 2;
          c.strokeStyle = '#5BC7A6';
          c.stroke();
          p.forEach(([x, y], i) => {
            c.beginPath();
            c.arc(x, y, i === active ? 15 : 11, 0, Math.PI * 2);
            c.fillStyle = i === active ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.95)';
            c.fill();
            c.lineWidth = 3;
            c.strokeStyle = '#12705A';
            c.stroke();
          });
        }

        function drawLoupe() {
          const [sx, sy] = screenPts()[active];
          let ly = sy - 96 - L / 2;
          if (ly < 4) ly = sy + 60;
          const lx = Math.min(sw - L - 4, Math.max(4, sx - L / 2));
          Object.assign(loupe.style, { left: `${lx}px`, top: `${ly}px` });
          loupe.hidden = false;
          const c = loupe.getContext('2d');
          const S = loupe.width;
          c.setTransform(1, 0, 0, 1, 0, 0);
          c.fillStyle = '#000';
          c.fillRect(0, 0, S, S);
          // source square around the corner, 3x the on-screen size, clipped to the photo
          const half = L / (2 * 3 * scale);
          const [ix, iy] = st.quad[active];
          let x0 = ix - half, y0 = iy - half, x1 = ix + half, y1 = iy + half;
          const k = S / (2 * half);
          const cx0 = Math.max(0, x0), cy0 = Math.max(0, y0), cx1 = Math.min(work.width, x1), cy1 = Math.min(work.height, y1);
          if (cx1 > cx0 && cy1 > cy0) {
            c.drawImage(work, cx0, cy0, cx1 - cx0, cy1 - cy0, (cx0 - x0) * k, (cy0 - y0) * k, (cx1 - cx0) * k, (cy1 - cy0) * k);
          }
          c.lineWidth = 2 * dpr;
          for (const [col, w] of [['rgba(0,0,0,0.6)', 4], ['#fff', 2]]) {
            c.strokeStyle = col; c.lineWidth = w * dpr;
            c.beginPath();
            c.moveTo(S / 2, S * 0.3); c.lineTo(S / 2, S * 0.7);
            c.moveTo(S * 0.3, S / 2); c.lineTo(S * 0.7, S / 2);
            c.stroke();
          }
        }

        function pointerPos(e) {
          const r = ov.getBoundingClientRect();
          return [e.clientX - r.left, e.clientY - r.top];
        }
        on(ov, 'pointerdown', (e) => {
          const [px, py] = pointerPos(e);
          let best = -1, bd = Infinity;
          screenPts().forEach(([x, y], i) => { const dd = Math.hypot(x - px, y - py); if (dd < bd) { bd = dd; best = i; } });
          if (bd > (e.pointerType === 'mouse' ? 30 : 60)) return;
          e.preventDefault();
          active = best;
          const s = screenPts()[best];
          grab = [s[0] - px, s[1] - py];
          ov.setPointerCapture(e.pointerId);
          draw(); drawLoupe();
        });
        on(ov, 'pointermove', (e) => {
          if (active < 0) return;
          e.preventDefault();
          const [px, py] = pointerPos(e);
          const x = (px + grab[0] - ox) / scale, y = (py + grab[1] - oy) / scale;
          st.quad[active] = [Math.min(work.width, Math.max(0, x)), Math.min(work.height, Math.max(0, y))];
          if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (active >= 0) { draw(); drawLoupe(); } });
        });
        const release = () => { if (active < 0) return; active = -1; loupe.hidden = true; draw(); };
        on(ov, 'pointerup', release);
        on(ov, 'pointercancel', release);
        on(window, 'resize', layout);

        d.querySelector('.sc-tools').addEventListener('click', (e) => {
          const a = e.target.closest('[data-a]')?.dataset.a;
          if (a === 'detect') {
            const q = detectQuad(work);
            if (q) { st.quad = q; hint.textContent = 'Drag the corners to the edges of the receipt.'; } else hint.textContent = "Couldn't find the receipt's edges. Drag the corners into place.";
            draw();
          } else if (a === 'full') {
            st.quad = full(); draw();
          } else if (a === 'original') {
            finish({ original: true });
          }
        });
        d.querySelector('.sc-head').addEventListener('click', (e) => {
          const a = e.target.closest('[data-a]')?.dataset.a;
          if (a === 'cancel') finish(null);
          if (a === 'next') {
            const q = orderQuad(st.quad);
            if (polyArea(q) < 0.005 * work.width * work.height) {
              hint.textContent = 'Drag the corners apart so they surround the receipt.';
              return;
            }
            st.quad = q;
            showPreview();
          }
        });
        requestAnimationFrame(layout);
      }

      /* ----- step 2: preview ----- */
      async function render() {
        const busy = d.querySelector('.sc-busy');
        const useBtn = d.querySelector('[data-a="use"]');
        const saveBtn = d.querySelector('[data-a="save"]');
        busy.hidden = false;
        useBtn.disabled = true;
        if (saveBtn) saveBtn.disabled = true;
        st.file = null;
        await nextFrame();
        try {
          const key = JSON.stringify(st.quad);
          if (!st.warped || st.warpKey !== key) {
            if (!srcData) srcData = ctx2d(work).getImageData(0, 0, work.width, work.height).data;
            st.warped = warp(srcData, work.width, work.height, st.quad);
            st.warpKey = key;
            st.enhanced.clear();
          }
          if (!st.enhanced.has(st.filter)) st.enhanced.set(st.filter, enhance(st.warped, st.filter));
          const out = rotateCanvas(st.enhanced.get(st.filter), st.turns);
          const view = d.querySelector('.sc-result');
          if (!view) return;
          view.width = out.width; view.height = out.height;
          view.getContext('2d').drawImage(out, 0, 0);
          const blob = await toBlob(out);
          if (!d.open) return;
          st.file = new File([blob], `${baseName} scan.jpg`, { type: 'image/jpeg' });
          useBtn.disabled = false;
          if (saveBtn) saveBtn.disabled = false;
        } catch (err) {
          d.querySelector('.sc-hint').textContent = err.message;
        } finally {
          busy.hidden = true;
        }
      }

      function showPreview() {
        endStep();
        const mode = saveMode(new File([''], 'x.jpg', { type: 'image/jpeg' }));
        d.innerHTML = `
          <div class="sc-head">
            <button type="button" class="sc-text" data-a="back">Back</button>
            <h2>Preview</h2>
            <button type="button" class="sc-text strong" data-a="use" disabled>Use scan</button>
          </div>
          <div class="sc-stage sc-stage-preview">
            <canvas class="sc-result" aria-label="Scanned receipt"></canvas>
            <div class="sc-busy">Processing…</div>
          </div>
          <p class="sc-hint"></p>
          <div class="sc-tools">
            <div class="sc-seg" role="group" aria-label="Filter">
              ${FILTERS.map(([k, label]) => `<button type="button" class="sc-btn" data-f="${k}" aria-pressed="${k === st.filter}">${label}</button>`).join('')}
            </div>
            <button type="button" class="sc-btn sc-icon" data-a="rotl" aria-label="Rotate left">${ICON.left}</button>
            <button type="button" class="sc-btn sc-icon" data-a="rotr" aria-label="Rotate right">${ICON.right}</button>
            <button type="button" class="sc-btn" data-a="save" disabled>${mode.label}</button>
          </div>`;
        on(d, 'click', onPreviewClick);
        render();
      }

      function onPreviewClick(e) {
        const fBtn = e.target.closest('[data-f]');
        if (fBtn) {
          st.filter = fBtn.dataset.f;
          lsSet(FILTER_KEY, st.filter);
          d.querySelectorAll('[data-f]').forEach((b) => b.setAttribute('aria-pressed', String(b === fBtn)));
          render();
          return;
        }
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (!a) return;
        if (a === 'back') showCrop();
        if (a === 'rotl') { st.turns--; render(); }
        if (a === 'rotr') { st.turns++; render(); }
        if (a === 'save' && st.file) {
          const msg = saveCopy(st.file);
          if (msg) d.querySelector('.sc-hint').textContent = msg;
        }
        if (a === 'use' && st.file) finish({ blob: st.file });
      }

      showCrop();
    });
  }

  window.ReceiptScanner = { open, _detectQuad: detectQuad, _enhance: enhance };
})();
