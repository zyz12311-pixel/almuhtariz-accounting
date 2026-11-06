/* مولّد QR صغير بلا اعتماديات: وضع Byte، مستوى تصحيح L، الإصدارات 1-20 (حتى ~850 بايت). يعرّف qrSvg وqrMatrix. */
(function (g) {
  const EC = [0, [7, [[1, 19]]], [10, [[1, 34]]], [15, [[1, 55]]], [20, [[1, 80]]], [26, [[1, 108]]], [18, [[2, 68]]], [20, [[2, 78]]], [24, [[2, 97]]], [30, [[2, 116]]],
    [18, [[2, 68], [2, 69]]], [20, [[4, 81]]], [24, [[2, 92], [2, 93]]], [26, [[4, 107]]], [30, [[3, 115], [1, 116]]], [22, [[5, 87], [1, 88]]], [24, [[5, 98], [1, 99]]],
    [28, [[1, 107], [5, 108]]], [30, [[5, 120], [1, 121]]], [28, [[3, 113], [4, 114]]], [28, [[3, 107], [5, 108]]]];
  const AP = [0, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62],
    [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90]];
  const EXP = new Array(512), LOG = new Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 285; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
  function rs(data, n) {
    let gp = [1];
    for (let i = 0; i < n; i++) { const ng = new Array(gp.length + 1).fill(0); for (let j = 0; j < gp.length; j++) { ng[j] ^= gp[j]; ng[j + 1] ^= mul(gp[j], EXP[i]); } gp = ng; }
    const r = new Array(n).fill(0);
    for (const d of data) { const f = d ^ r[0]; r.shift(); r.push(0); if (f) for (let j = 0; j < n; j++) r[j] ^= mul(gp[j + 1], f); }
    return r;
  }
  const dataCw = v => EC[v][1].reduce((s, [n, d]) => s + n * d, 0);
  const MASK = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0];

  function qrMatrix(text) {
    const bytes = [...new TextEncoder().encode(text)];
    let v = 1; while (v <= 20 && dataCw(v) * 8 < 4 + (v < 10 ? 8 : 16) + 8 * bytes.length) v++;
    if (v > 20) throw new Error('النص أطول من سعة المولّد');
    const bits = []; const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
    const cap = dataCw(v) * 8; put(0, Math.min(4, cap - bits.length)); while (bits.length % 8) bits.push(0);
    const cw = []; for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let p = 0; cw.length < dataCw(v); p++) cw.push(p % 2 ? 0x11 : 0xEC);
    const [ecn, groups] = EC[v], blocks = []; let o = 0;
    for (const [n, d] of groups) for (let i = 0; i < n; i++) { const dd = cw.slice(o, o + d); o += d; blocks.push({ d: dd, e: rs(dd, ecn) }); }
    const out = [], maxd = Math.max(...blocks.map(b => b.d.length));
    for (let i = 0; i < maxd; i++) blocks.forEach(b => { if (i < b.d.length) out.push(b.d[i]); });
    for (let i = 0; i < ecn; i++) blocks.forEach(b => out.push(b.e[i]));
    const stream = []; out.forEach(b => { for (let i = 7; i >= 0; i--) stream.push((b >> i) & 1); });
    for (let i = v === 1 ? 0 : v <= 6 ? 7 : v <= 13 ? 0 : 3; i > 0; i--) stream.push(0);

    const N = 17 + 4 * v, base = Array.from({ length: N }, () => new Array(N).fill(null)), fn = Array.from({ length: N }, () => new Array(N).fill(false));
    const set = (r, c, val) => { if (r >= 0 && c >= 0 && r < N && c < N) { base[r][c] = val; fn[r][c] = true; } };
    for (const [pr, pc] of [[0, 0], [0, N - 7], [N - 7, 0]])
      for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++)
        set(pr + r, pc + c, (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6)) || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
    for (let i = 8; i < N - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const ap = AP[v];
    for (const r of ap) for (const c of ap) {
      if ((r === 6 && c === 6) || (r === 6 && c === ap[ap.length - 1]) || (r === ap[ap.length - 1] && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
    for (let i = 0; i < 15; i++) { // حجز مناطق الصيغة
      set(i < 6 ? i : i < 8 ? i + 1 : N - 15 + i, 8, false); set(8, i < 8 ? N - i - 1 : i < 9 ? 15 - i : 15 - i - 1, false);
    }
    set(N - 8, 8, true);
    if (v >= 7) { let r = v << 12; for (let i = 17; i >= 12; i--) if ((r >> i) & 1) r ^= 0x1F25 << (i - 12); const vb = (v << 12) | r;
      for (let i = 0; i < 18; i++) { const m = ((vb >> i) & 1) === 1; set(Math.floor(i / 3), (i % 3) + N - 11, m); set((i % 3) + N - 11, Math.floor(i / 3), m); } }

    const build = mask => {
      const m = base.map(r => r.slice()); let k = 0, up = true;
      for (let c = N - 1; c > 0; c -= 2) { if (c === 6) c--;
        for (let i = 0; i < N; i++) { const r = up ? N - 1 - i : i;
          for (const cc of [c, c - 1]) if (!fn[r][cc]) { const bit = k < stream.length ? stream[k++] : 0; m[r][cc] = (bit === 1) !== MASK[mask](r, cc); } }
        up = !up; }
      let d = (1 << 3) | mask, r = d << 10; for (let i = 14; i >= 10; i--) if ((r >> i) & 1) r ^= 0x537 << (i - 10);
      const fb = ((d << 10) | r) ^ 0x5412;
      for (let i = 0; i < 15; i++) { const b = ((fb >> i) & 1) === 1;
        m[i < 6 ? i : i < 8 ? i + 1 : N - 15 + i][8] = b; m[8][i < 8 ? N - i - 1 : i < 9 ? 15 - i : 15 - i - 1] = b; }
      m[N - 8][8] = true; return m;
    };
    const penalty = m => { let p = 0;
      for (let t = 0; t < 2; t++) for (let i = 0; i < N; i++) { let run = 1; for (let j = 1; j < N; j++) { const a = t ? m[j][i] : m[i][j], b = t ? m[j - 1][i] : m[i][j - 1]; if (a === b) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
      for (let r = 0; r < N - 1; r++) for (let c = 0; c < N - 1; c++) if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) p += 3;
      const dark = m.flat().filter(Boolean).length; p += Math.floor(Math.abs((dark * 100) / (N * N) - 50) / 5) * 10; return p; };
    let best = null, bp = 1e9; for (let k = 0; k < 8; k++) { const m = build(k), p = penalty(m); if (p < bp) { bp = p; best = m; } }
    return best;
  }
  function qrSvg(text, px) {
    const m = qrMatrix(text), N = m.length, q = 4; let d = '';
    m.forEach((row, r) => { for (let c = 0; c < N; c++) if (row[c]) { let e = c; while (e < N && row[e]) e++; d += `M${c + q} ${r + q}h${e - c}v1h${-(e - c)}z`; c = e; } });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N + 2 * q} ${N + 2 * q}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  g.qrMatrix = qrMatrix; g.qrSvg = qrSvg;
})(typeof window !== 'undefined' ? window : globalThis);
