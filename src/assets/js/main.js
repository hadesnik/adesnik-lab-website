// Mobile navigation toggle.
(function () {
  const toggle = document.querySelector("[data-nav-toggle]");
  const nav = document.getElementById("primary-nav");
  if (!toggle || !nav) return;

  toggle.addEventListener("click", function () {
    const open = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  // Close the menu when a link is followed (single-page nav feel on mobile).
  nav.addEventListener("click", function (e) {
    if (e.target.closest("a") && nav.classList.contains("is-open")) {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
})();

// Publications filter (progressive enhancement).
(function () {
  const input = document.querySelector("[data-pub-filter]");
  if (!input) return;
  const items = Array.from(document.querySelectorAll(".pub[data-search]"));
  const sections = Array.from(document.querySelectorAll("[data-pub-section]"));
  const countEl = document.querySelector("[data-pub-count]");
  const emptyEl = document.querySelector("[data-pub-empty]");
  const total = items.length;

  function update() {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    items.forEach(function (li) {
      const match = !q || li.dataset.search.indexOf(q) !== -1;
      li.hidden = !match;
      if (match) shown++;
    });
    // Hide a section whose items are all filtered out.
    sections.forEach(function (sec) {
      const any = sec.querySelector(".pub:not([hidden])");
      sec.hidden = !any;
    });
    if (emptyEl) emptyEl.hidden = shown !== 0;
    if (countEl) {
      countEl.textContent = q
        ? shown + " of " + total + " publications"
        : total + " publications";
    }
  }

  input.addEventListener("input", update);
  update();
})();

// Play looping movies only while they are on screen (saves bandwidth/CPU).
(function () {
  const vids = document.querySelectorAll("video[data-autoplay]");
  if (!vids.length) return;
  if (!("IntersectionObserver" in window)) {
    vids.forEach((v) => v.play && v.play().catch(() => {}));
    return;
  }
  const io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.play().catch(() => {});
        } else {
          e.target.pause();
        }
      });
    },
    { threshold: 0.35 }
  );
  vids.forEach((v) => io.observe(v));
})();

// Parallax hero backgrounds (progressive enhancement). Elements tagged
// [data-parallax] are translated at a fraction of scroll speed so the page
// content scrolls over a slower-moving background. Disabled on small
// screens and under prefers-reduced-motion (JS transforms are not covered
// by the CSS reduced-motion block, so we gate here explicitly).
(function () {
  const els = document.querySelectorAll("[data-parallax]");
  if (!els.length) return;
  const motionOK = window.matchMedia("(prefers-reduced-motion: no-preference)");
  const wide = window.matchMedia("(min-width: 761px)");
  let active = false;
  let ticking = false;

  function update() {
    ticking = false;
    els.forEach(function (el) {
      const rect = el.parentElement.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
      const speed = parseFloat(el.dataset.parallaxSpeed || "0.25");
      el.style.transform =
        "translate3d(0," + (-rect.top * speed).toFixed(1) + "px,0)";
    });
  }
  function onScroll() {
    if (active && !ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }
  function evaluate() {
    active = motionOK.matches && wide.matches;
    if (!active) {
      els.forEach(function (el) {
        el.style.transform = "";
      });
    } else {
      update();
    }
  }

  motionOK.addEventListener("change", evaluate);
  wide.addEventListener("change", evaluate);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  evaluate();
})();

// Reveal-on-scroll (progressive enhancement). Elements tagged [data-reveal]
// start hidden via CSS (only when html.js + motion allowed) and fade/slide
// in as they enter the viewport, with a small stagger so grids cascade.
(function () {
  const els = document.querySelectorAll("[data-reveal]");
  if (!els.length) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !("IntersectionObserver" in window)) {
    els.forEach(function (el) {
      el.classList.add("is-visible");
    });
    return;
  }
  const io = new IntersectionObserver(
    function (entries) {
      let i = 0;
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.style.transitionDelay = Math.min(i++ * 70, 420) + "ms";
        e.target.classList.add("is-visible");
        io.unobserve(e.target);
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  els.forEach(function (el) {
    io.observe(el);
  });
})();

// Open external links in a new tab so the lab site stays open. Internal
// navigation keeps the same tab; mailto/tel links are left untouched.
(function () {
  document.querySelectorAll("a[href]").forEach(function (a) {
    const external =
      /^https?:$/.test(a.protocol) && a.origin !== window.location.origin;
    if (external) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  });
})();

// Compact the sticky header once the page is scrolled.
(function () {
  const header = document.querySelector("[data-header]");
  if (!header) return;
  let ticking = false;
  function update() {
    ticking = false;
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  }
  window.addEventListener(
    "scroll",
    function () {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true }
  );
  update();
})();

// Hero calcium-imaging neuron field. Builds a sparse network of stylized
// cortical neurons (pyramidal + interneuron) plus two defocused "volume"
// layers behind them, then runs a small real-time engine: every cell fires on
// its own irregular schedule (decorrelated population), a spike probabilistically
// propagates along the axon to a target dendrite, and the target flashes on
// arrival. Most spikes invade the dendrites as a fast backpropagating wave from
// soma to tips. Somas are opaque and brighten by fill colour so dendrites read
// as emerging from the cell body. Pauses when scrolled offscreen; static under
// reduced-motion. Styling for the parts lives in styles.css (.hero__motif ...).
(function () {
  const svg = document.getElementById("hero-neurons");
  if (!svg) return;

  const R = (n) => Number(n.toFixed(1));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function cubicPt(p0, c1, c2, p1, t) {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
    };
  }

  // ---- tunables ----
  const T_W = 0.35, P_DEND = 0.85, P_TX = 0.42, MAXDEPTH = 3;
  const ISI_MIN = 9, ISI_MAX = 20, BAP_V = 1040, D_MAX = 0.85;
  const HOVER_INTERVAL = 0.12; // while a cell is hovered, keep firing it this often
  const L_FOCAL = { base: 0.16, gain: 1.0, dbase: 0.1, dgain: 1.0, dim: [122, 105, 68], bright: [255, 236, 182] };
  const L_DOF1 = { base: 0.14, gain: 0.7, dbase: 0.09, dgain: 0.7, dim: [96, 82, 54], bright: [200, 175, 128] };
  const L_DOF2 = { base: 0.12, gain: 0.55, dbase: 0, dgain: 0, dim: [82, 70, 46], bright: [165, 142, 104] };

  // Calcium-transient waveform. A normalized difference of exponentials, which
  // is the shape a real GCaMP transient takes: a smoothly rounded rise into the
  // peak rather than a linear ramp with a corner at the top. The peak lands at
  // t_peak = (τr·τd/(τd−τr))·ln(τd/τr), so τr = 0.15 / τd = 1.0 s peaks at
  // ~0.33 s and is most of the way back to baseline ~1 s later (GCaMP6s-like).
  // Dendrites decay a little faster than somas so the arbor fades first.
  // TAIL is where the transient is truncated; at 5 s it is already under 1% of
  // peak, so the cut is below the 0.01 quantization step used when painting.
  const TAU_R = 0.15, TAU_D = 1.0, TAU_D_DEND = 0.85, TAIL = 5;
  function peakNorm(tr, td) {
    const tp = ((tr * td) / (td - tr)) * Math.log(td / tr);
    return 1 / (Math.exp(-tp / td) - Math.exp(-tp / tr));
  }
  const A_SOMA = peakNorm(TAU_R, TAU_D), A_DEND = peakNorm(TAU_R, TAU_D_DEND);
  function transS(tau) { if (tau < 0 || tau > TAIL) return 0; return A_SOMA * (Math.exp(-tau / TAU_D) - Math.exp(-tau / TAU_R)); }
  function transD(tau) { if (tau < 0 || tau > TAIL) return 0; return A_DEND * (Math.exp(-tau / TAU_D_DEND) - Math.exp(-tau / TAU_R)) * 0.6; }

  // recursive dendrite; leaf endpoints collected so axons can target dendrites;
  // each segment carries a bAP delay ∝ its path distance from the soma.
  function dendrite(rng, x, y, ang, len, width, depth, tips, ci, dist0) {
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    const perp = ang + Math.PI / 2, curl = (rng() - 0.5) * len * 0.28;
    const mx = (x + x2) / 2 + Math.cos(perp) * curl, my = (y + y2) / 2 + Math.sin(perp) * curl, far = dist0 + len;
    let d = '<path class="dend" data-cell="' + ci + '" data-delay="' + (far / BAP_V).toFixed(3) + '" style="stroke-width:' + width.toFixed(2) + '" d="M' + R(x) + "," + R(y) + " Q" + R(mx) + "," + R(my) + " " + R(x2) + "," + R(y2) + '"/>';
    if (depth > 0 && len > 7) {
      for (let i = 0; i < 2; i++) { const sp = (i === 0 ? -1 : 1) * (0.3 + rng() * 0.4); d += dendrite(rng, x2, y2, ang + sp, len * (0.6 + rng() * 0.18), width * 0.7, depth - 1, tips, ci, far); }
    } else if (tips) { tips.push({ x: x2, y: y2 }); }
    return d;
  }
  function pyramidal(rng, cx, cy, s, apicalAng, ci) {
    const tips = [], g = [], w0 = 2.4 * s;
    const ax = Math.cos(apicalAng), ay = Math.sin(apicalAng);
    // apical dendrite emerges from the apex point of the soma
    g.push(dendrite(rng, cx + ax * 11 * s, cy + ay * 11 * s, apicalAng, 44 * s, w0, 3, tips, ci, 0));
    // basal dendrites emerge from the two bottom corners of the pyramidal soma,
    // fanning down-and-outward (soma local corners ≈ (±5.6, 4), rotated to apical)
    const th = apicalAng + Math.PI / 2, cs = Math.cos(th), sn = Math.sin(th);
    const corner = (lx, ly) => ({ x: cx + lx * s * cs - ly * s * sn, y: cy + lx * s * sn + ly * s * cs });
    const baseDir = apicalAng + Math.PI;
    [[5.6, -1], [-5.6, 1]].forEach(function (c) {
      const o = corner(c[0], 4);
      g.push(dendrite(rng, o.x, o.y, baseDir + c[1] * (0.3 + rng() * 0.15), 24 * s, w0 * 0.85, 2, tips, ci, 0));
      g.push(dendrite(rng, o.x, o.y, baseDir + c[1] * (0.75 + rng() * 0.2), 19 * s, w0 * 0.78, 2, tips, ci, 0));
    });
    return { dend: g.join(""), cx, cy, s, ang: apicalAng, tips, axonDir: apicalAng + Math.PI };
  }
  function interneuron(rng, cx, cy, s, ci) {
    const tips = [], g = [], n = 6 + Math.floor(rng() * 3), w0 = 2.0 * s;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + rng() * 0.3; g.push(dendrite(rng, cx, cy, a, 22 * s, w0, 2, tips, ci, 0)); }
    return { dend: g.join(""), cx, cy, s, ang: 0, tips, axonDir: Math.PI / 2 + (rng() - 0.5) * 0.6 };
  }
  function pyrPath(s) {
    const P = (x, y) => R(x * s) + "," + R(y * s);
    return "M " + P(0, -11) + " C " + P(3.6, -9) + " " + P(6.2, -1.5) + " " + P(5.6, 4) + " Q " + P(5.8, 7.4) + " " + P(0, 7.4) + " Q " + P(-5.8, 7.4) + " " + P(-5.6, 4) + " C " + P(-6.2, -1.5) + " " + P(-3.6, -9) + " " + P(0, -11) + " Z";
  }
  function somaMarkup(nu, id, kind) {
    const { cx, cy, s, ang } = nu;
    if (kind === "blob") return '<circle class="cyto" data-cell="' + id + '" cx="' + R(cx) + '" cy="' + R(cy) + '" r="' + (9 * s).toFixed(1) + '"/>';
    if (kind === "p") { const deg = (ang * 180 / Math.PI + 90).toFixed(1); return '<path class="cyto" data-cell="' + id + '" transform="translate(' + R(cx) + " " + R(cy) + ") rotate(" + deg + ')" d="' + pyrPath(s) + '"/>'; }
    return '<circle class="cyto" data-cell="' + id + '" cx="' + R(cx) + '" cy="' + R(cy) + '" r="' + (7 * s).toFixed(1) + '"/>';
  }
  function buildAxon(rng, A, B) {
    const src = { x: A.cx, y: A.cy };
    let tip = B.tips[0], best = 1e9;
    for (const t of B.tips) { const dx = t.x - src.x, dy = t.y - src.y, d = dx * dx + dy * dy; if (d < best) { best = d; tip = t; } }
    const a0 = A.axonDir, p0 = { x: src.x + Math.cos(a0) * 16 * A.s, y: src.y + Math.sin(a0) * 16 * A.s };
    let ox = tip.x - B.cx, oy = tip.y - B.cy; const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol;
    const c1 = { x: p0.x + Math.cos(a0) * 50, y: p0.y + Math.sin(a0) * 50 }, c2 = { x: tip.x + ox * 40, y: tip.y + oy * 40 };
    const trunkD = "M" + R(src.x) + "," + R(src.y) + " L" + R(p0.x) + "," + R(p0.y) + " C" + R(c1.x) + "," + R(c1.y) + " " + R(c2.x) + "," + R(c2.y) + " " + R(tip.x) + "," + R(tip.y);
    let m = '<path class="axon" style="stroke-width:' + (1.15 * A.s).toFixed(2) + '" d="' + trunkD + '"/>';
    for (const t of [0.42, 0.7]) {
      const pt = cubicPt(p0, c1, c2, tip, t), nt = cubicPt(p0, c1, c2, tip, t + 0.02), tang = Math.atan2(nt.y - pt.y, nt.x - pt.x);
      const ba = tang + (rng() < 0.5 ? 1 : -1) * (0.7 + rng() * 0.4), bl = (11 + rng() * 9) * A.s, ex = pt.x + Math.cos(ba) * bl, ey = pt.y + Math.sin(ba) * bl;
      m += '<path class="axon" style="stroke-width:' + (0.8 * A.s).toFixed(2) + '" d="M' + R(pt.x) + "," + R(pt.y) + " Q" + R(pt.x + Math.cos(ba) * bl * 0.6) + "," + R(pt.y + Math.sin(ba) * bl * 0.6) + " " + R(ex) + "," + R(ey) + '"/>';
      m += '<circle class="bouton" cx="' + R(ex) + '" cy="' + R(ey) + '" r="' + (0.65 * A.s).toFixed(1) + '"/>';
    }
    m += '<circle class="bouton" cx="' + R(tip.x) + '" cy="' + R(tip.y) + '" r="' + (1 * A.s).toFixed(1) + '"/>';
    return { markup: m, trunkD };
  }
  function isText(x, y) { return x < 640 && y > 150 && y < 570; }
  function sample(rng, count, minDist, rightBias, textAccept) {
    const pts = []; let tries = 0;
    while (pts.length < count && tries < count * 600) {
      tries++;
      const u = rng(), x = 100 + (rightBias ? Math.pow(u, 0.6) : u) * 1000, y = 80 + rng() * 550;
      if (isText(x, y) && rng() > textAccept) continue;
      if (minDist > 0) { let ok = true; for (const p of pts) { if ((p[0] - x) ** 2 + (p[1] - y) ** 2 < minDist * minDist) { ok = false; break; } } if (!ok) continue; }
      pts.push([x, y]);
    }
    return pts;
  }

  const rng = mulberry32(23);
  const cells = []; let gid = 0;
  function addNeuron(x, y, s, kind, adeg, layer, bucket) {
    const id = gid++;
    let nu;
    if (kind === "blob") nu = { cx: x, cy: y, s, ang: 0, dend: "", tips: [], axonDir: 0 };
    else nu = kind === "p" ? pyramidal(rng, x, y, s, (adeg * Math.PI) / 180, id) : interneuron(rng, x, y, s, id);
    bucket.push(nu.dend + somaMarkup(nu, id, kind));
    cells[id] = { soma: null, dend: [], events: [], nextSpont: 0, dendWasActive: false, childEdges: [], base: layer.base, gain: layer.gain, dbase: layer.dbase, dgain: layer.dgain, dim: layer.dim, bright: layer.bright, hasDend: kind !== "blob", drives: kind === "p", hx: x, hy: y, hr: Math.max(12, 10 * s) };
    return { id, nu };
  }

  const focalStr = [], focal = [];
  sample(rng, 75, 28, true, 0).forEach(function (p) {
    const kind = rng() < 0.55 ? "p" : "i", s = 0.8 + rng() * 0.5;
    focal.push(addNeuron(p[0], p[1], s, kind, kind === "p" ? -90 + (rng() - 0.5) * 12 : 0, L_FOCAL, focalStr));
  });
  const F = focal.length;
  let mx = 0, my = 0; focal.forEach((f) => { mx += f.nu.cx; my += f.nu.cy; }); mx /= F; my /= F;
  let root = 0, bd = 1e9; focal.forEach((f, i) => { const d = (f.nu.cx - mx) ** 2 + (f.nu.cy - my) ** 2; if (d < bd) { bd = d; root = i; } });
  const par = new Array(F).fill(-1), inT = new Set([root]);
  while (inT.size < F) {
    let bA = -1, bB = -1, bD = 1e9;
    for (const a of inT) for (let b = 0; b < F; b++) if (!inT.has(b)) { const d = (focal[a].nu.cx - focal[b].nu.cx) ** 2 + (focal[a].nu.cy - focal[b].nu.cy) ** 2; if (d < bD) { bD = d; bA = a; bB = b; } }
    par[bB] = bA; inT.add(bB);
  }
  const edges = [];
  for (let b = 0; b < F; b++) if (par[b] >= 0) {
    const axon = buildAxon(rng, focal[par[b]].nu, focal[b].nu), j = edges.length;
    edges.push({ src: focal[par[b]].id, dst: focal[b].id, trunkD: axon.trunkD, markup: axon.markup, pulseT0: null });
    cells[focal[par[b]].id].childEdges.push(j);
  }

  const dof1Str = []; sample(rng, 42, 0, false, 0).forEach(function (p) { const kind = rng() < 0.55 ? "p" : "i"; addNeuron(p[0], p[1], 0.9 + rng() * 0.5, kind, kind === "p" ? -90 + (rng() - 0.5) * 12 : 0, L_DOF1, dof1Str); });
  const dof2Str = []; sample(rng, 60, 0, false, 0).forEach(function (p) { addNeuron(p[0], p[1], 1.0 + rng() * 0.8, "blob", 0, L_DOF2, dof2Str); });

  // Native SVG blur for the defocused volume layers. CSS filter:blur() on SVG
  // groups doesn't render in iOS Safari (shows sharp circles); feGaussianBlur does.
  let inner = '<defs>' +
    '<filter id="dofb1" x="-6%" y="-6%" width="112%" height="112%"><feGaussianBlur stdDeviation="2"/></filter>' +
    '<filter id="dofb2" x="-8%" y="-8%" width="116%" height="116%"><feGaussianBlur stdDeviation="4.4"/></filter>' +
    '</defs><g opacity="0.6">';
  inner += '<g class="dof2" opacity=".8">' + dof2Str.join("") + "</g>";
  inner += '<g class="dof1">' + dof1Str.join("") + "</g>";
  inner += '<g style="opacity:.30">' + edges.map((e) => e.markup).join("") + "</g>";
  inner += "<g>" + focalStr.join("") + "</g>";
  let waves = ""; edges.forEach(function (e, j) {
    waves += '<path class="spark spark--halo" data-ax="' + j + '" pathLength="100" d="' + e.trunkD + '" style="stroke-width:3.6;stroke-dasharray:5 400"/>';
    waves += '<path class="spark" data-ax="' + j + '" pathLength="100" d="' + e.trunkD + '" style="stroke-width:1.5;stroke-dasharray:2.5 400"/>';
  });
  inner += "<g>" + waves + "</g></g>";
  svg.innerHTML = inner;

  svg.querySelectorAll(".cyto").forEach((el) => { cells[+el.dataset.cell].soma = el; });
  svg.querySelectorAll(".dend").forEach((el) => { cells[+el.dataset.cell].dend.push({ el, delay: +el.dataset.delay }); });
  edges.forEach(function (e, j) { e.halo = svg.querySelector('.spark--halo[data-ax="' + j + '"]'); e.core = svg.querySelector('.spark:not(.spark--halo)[data-ax="' + j + '"]'); });

  const fillOf = (c, bv) => "rgb(" + Math.round(c.dim[0] + bv * (c.bright[0] - c.dim[0])) + "," + Math.round(c.dim[1] + bv * (c.bright[1] - c.dim[1])) + "," + Math.round(c.dim[2] + bv * (c.bright[2] - c.dim[2])) + ")";

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    cells.forEach((c) => { c.soma.style.fill = fillOf(c, 0.5); c.dend.forEach((d) => (d.el.style.opacity = c.dbase + 0.35 * c.dgain)); });
    return;
  }

  const rngE = mulberry32(99);
  const scheduled = [];
  cells.forEach((c) => { c.nextSpont = rngE() * ISI_MAX; });
  function fire(i, t, depth, forceDend) {
    const c = cells[i]; c.events.push({ t0: t, dend: forceDend || rngE() < P_DEND }); if (c.events.length > 8) c.events.shift();
    // Only pyramidal cells drive downstream activation; interneurons (non-pyramidal) don't propagate.
    if (c.drives && depth < MAXDEPTH) for (const j of c.childEdges) if (rngE() < P_TX) { edges[j].pulseT0 = t; scheduled.push({ cell: edges[j].dst, time: t + T_W, depth: depth + 1 }); }
  }

  // Occasional field-wide waves of activity: from a random seed point an
  // expanding front sweeps the whole field, firing each cell as it passes.
  // Speed is set so the front reaches the farthest cell in WAVE_TRAVERSE seconds.
  const WAVE_MIN = 10, WAVE_MAX = 24, WAVE_TRAVERSE = 2;
  const fieldWaves = [];
  let nextWave = 4; // first wave a few seconds in
  function launchWave(now, sx, sy) {
    if (sx === undefined) { sx = rngE() * 1200; sy = rngE() * 700; }
    const n = cells.length;
    const dist = new Float64Array(n); let maxD = 1;
    for (let i = 0; i < n; i++) { const dx = cells[i].hx - sx, dy = cells[i].hy - sy, d = Math.sqrt(dx * dx + dy * dy); dist[i] = d; if (d > maxD) maxD = d; }
    fieldWaves.push({ t0: now, speed: maxD / WAVE_TRAVERSE, maxD, dist, fired: new Uint8Array(n) });
  }

  // Advance sim-time only while running so an offscreen pause never causes a
  // "catch-up" burst of firing when the hero scrolls back into view.
  let simTime = 0, lastReal = null, rafId = null, hoveredId = null, lastHoverFire = -9, lastHovered = null, hoverStart = 0;
  function frame() {
    const real = performance.now() / 1000;
    if (lastReal == null) lastReal = real;
    simTime += real - lastReal; lastReal = real;
    const now = simTime;
    if (hoveredId !== lastHovered) { lastHovered = hoveredId; hoverStart = now; }
    if (hoveredId != null) {
      if (now - lastHoverFire > HOVER_INTERVAL) { fire(hoveredId, now, 0, true); lastHoverFire = now; }
      // Held on one neuron > 2s → seed a field wave from it; 5s refractory per neuron.
      if (now - hoverStart > 2 && cells[hoveredId].drives && now >= (cells[hoveredId].wRefr || 0)) { launchWave(now, cells[hoveredId].hx, cells[hoveredId].hy); cells[hoveredId].wRefr = now + 5; }
    }
    for (let i = 0; i < cells.length; i++) if (now >= cells[i].nextSpont) { fire(i, cells[i].nextSpont, 0); cells[i].nextSpont = now + ISI_MIN + rngE() * (ISI_MAX - ISI_MIN); }
    for (let k = scheduled.length - 1; k >= 0; k--) if (now >= scheduled[k].time) { const s = scheduled[k]; scheduled.splice(k, 1); fire(s.cell, s.time, s.depth); }
    if (now >= nextWave) { launchWave(now); nextWave = now + WAVE_MIN + rngE() * (WAVE_MAX - WAVE_MIN); }
    for (let w = fieldWaves.length - 1; w >= 0; w--) {
      const wv = fieldWaves[w], frontR = wv.speed * (now - wv.t0);
      for (let i = 0; i < cells.length; i++) if (!wv.fired[i] && wv.dist[i] <= frontR) { wv.fired[i] = 1; fire(i, now, MAXDEPTH, true); }
      if (frontR > wv.maxD) fieldWaves.splice(w, 1);
    }
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      for (let e = c.events.length - 1; e >= 0; e--) if (now - c.events[e].t0 > TAIL) c.events.splice(e, 1);
      let bv = c.base; for (const ev of c.events) bv += c.gain * transS(now - ev.t0);
      bv = Math.round(clamp(bv, 0, 1) * 100) / 100;
      // Only repaint on change so a blurred layer isn't re-rendered every frame
      // (native SVG blur re-blurs the whole group on any child change).
      if (bv !== c.lastBv) { c.soma.style.fill = fillOf(c, bv); c.lastBv = bv; }
      if (c.hasDend) {
        const active = c.events.some((ev) => ev.dend && now - ev.t0 < TAIL);
        // Quantize to 0.01 and only touch the DOM when a segment actually
        // changes: the slower transient keeps each arbor "active" for longer,
        // and blind per-frame opacity writes across every segment are the
        // dominant cost in this loop.
        if (active) {
          for (const seg of c.dend) {
            let o = c.dbase; for (const ev of c.events) if (ev.dend) o += c.dgain * transD(now - ev.t0 - seg.delay);
            o = Math.round(clamp(o, 0, D_MAX) * 100) / 100;
            if (o !== seg.lastO) { seg.el.style.opacity = o; seg.lastO = o; }
          }
          c.dendWasActive = true;
        } else if (c.dendWasActive) {
          for (const seg of c.dend) if (seg.lastO !== c.dbase) { seg.el.style.opacity = c.dbase; seg.lastO = c.dbase; }
          c.dendWasActive = false;
        }
      }
    }
    for (const e of edges) {
      if (e.pulseT0 == null) continue;
      const s = (now - e.pulseT0) / T_W;
      if (s < 0 || s > 1) { e.pulseT0 = null; e.halo.style.strokeDashoffset = 8; e.core.style.strokeDashoffset = 8; }
      else { const off = (-s * 100).toFixed(1); e.halo.style.strokeDashoffset = off; e.core.style.strokeDashoffset = off; }
    }
    rafId = requestAnimationFrame(frame);
  }
  function start() { if (rafId == null) { lastReal = null; rafId = requestAnimationFrame(frame); } }
  function stop() { if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; } }

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(function (entries) { entries[0].isIntersecting ? start() : stop(); }, { threshold: 0 });
    io.observe(svg);
  } else {
    start();
  }
  // Returning to a backgrounded tab: reset the frame clock so sim-time resumes
  // smoothly instead of jumping by the whole time the tab was hidden.
  document.addEventListener("visibilitychange", function () { if (!document.hidden) lastReal = null; });

  // Hover-to-fire: while the pointer rests on a cell body it fires continuously
  // (a sustained spike train, every HOVER_INTERVAL, each propagating to its
  // targets). The whole hero banner shows a gold bullseye reticle cursor (a
  // small inline-SVG cursor) to evoke "targeting" the neurons.
  const reticle =
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
    '<g fill="none" stroke="#000" stroke-opacity=".55" stroke-width="3">' +
    '<circle cx="16" cy="16" r="10.5"/><circle cx="16" cy="16" r="4.5"/>' +
    '<path d="M16 1.5V7M16 25v5.5M1.5 16H7M25 16h5.5"/></g>' +
    '<g fill="none" stroke="#e0a93b" stroke-width="1.6">' +
    '<circle cx="16" cy="16" r="10.5"/><circle cx="16" cy="16" r="4.5"/>' +
    '<path d="M16 1.5V7M16 25v5.5M1.5 16H7M25 16h5.5"/></g>' +
    '<circle cx="16" cy="16" r="1.4" fill="#e0a93b"/></svg>';
  const cursor = 'url("data:image/svg+xml,' + encodeURIComponent(reticle) + '") 16 16, crosshair';
  const hero = svg.parentElement || svg;
  // Reticle over the whole hero banner (buttons restore the pointer via CSS).
  hero.style.cursor = cursor;

  // Coordinate-based firing: map the pointer/touch to viewBox space and act on
  // the nearest cell. Listeners are on the .hero section (not the SVG) so events
  // bubble up from whichever child is topmost — on mobile the full-width headline
  // container covers the SVG, so SVG-attached handlers never fired on touch.
  function nearest(clientX, clientY, pad) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return -1;
    const sc = Math.max(rect.width / 1200, rect.height / 700); // preserveAspectRatio slice
    const vx = (clientX - rect.left - (rect.width - 1200 * sc) / 2) / sc;
    const vy = (clientY - rect.top - (rect.height - 700 * sc) / 2) / sc;
    let best = -1, bestD = 1e9;
    for (let i = 0; i < cells.length; i++) { const c = cells[i]; const dx = c.hx - vx, dy = c.hy - vy, d = dx * dx + dy * dy; if (d < bestD) { bestD = d; best = i; } }
    if (best < 0) return -1;
    const thr = cells[best].hr + pad;
    return bestD <= thr * thr ? best : -1;
  }
  let touchDown = false;
  hero.addEventListener("pointerdown", function (e) {
    touchDown = true;
    const id = nearest(e.clientX, e.clientY, e.pointerType === "mouse" ? 4 : 22);
    if (id >= 0) { hoveredId = id; fire(id, simTime, 0, true); lastHoverFire = simTime; }
  });
  hero.addEventListener("pointermove", function (e) {
    if (e.pointerType === "mouse") { const id = nearest(e.clientX, e.clientY, 4); hoveredId = id >= 0 ? id : null; }
    else if (touchDown) { const id = nearest(e.clientX, e.clientY, 22); if (id >= 0) hoveredId = id; }
  });
  hero.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") hoveredId = null; });
  function release(e) { touchDown = false; if (!e || e.pointerType !== "mouse") hoveredId = null; }
  hero.addEventListener("pointerup", release);
  hero.addEventListener("pointercancel", release);
})();
