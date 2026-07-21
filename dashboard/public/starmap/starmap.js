/* AIOS Brain — "Nervensystem". Gehirn = gemeinsames Wissen (Kern), Jarvis = CEO oben,
   Abteilungen darunter mit Unteraufgaben. Impulse feuern über die Bahnen, Knoten leuchtet
   bei Ankunft auf. Knoten ziehbar (Position gespeichert), Klick = Info, Doppelklick = Dashboard.
   Daten aus /api/starmap. */
(function () {
"use strict";
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const PARAMS = new URLSearchParams(location.search);
const BANNER = PARAMS.has("banner");
if (BANNER) document.body.classList.add("banner");
// Banner-Text wird direkt auf den Canvas gemalt (damit ein PNG-Export das Ganze erfasst).
const BANNER_MAIN = (PARAMS.get("line") || "Dein Team wächst.|Deine Personalkosten nicht.").split("|");
const BANNER_SUB = PARAMS.get("sub") || "Skalier mit KI statt mit Personal · 10x Output";
if (BANNER) { const bl = document.getElementById("bannerline"); if (bl) bl.style.display = "none"; }
const SAVE_KEY = "aios-brain-pos-v1";

const cv = document.getElementById("stage"), ctx = cv.getContext("2d");
let W = 0, H = 0, DPR = 1;
function resize() { DPR = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
  cv.width = W * DPR; cv.height = H * DPR; cv.style.width = W + "px"; cv.style.height = H + "px"; }
resize();

// --- Zustand ---
let nodes = [], links = [], byId = {}, feed = [], neigh = {};
let hover = null, selected = null, ready = false, userMoved = false;
const cam = { x: 0, y: 30, s: 0.8, tx: 0, ty: 30, ts: 0.8 };

// --- Positionen speichern/laden (manuelle Anordnung) ---
function loadSaved() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; } }
function savePositions() { const m = {}; nodes.forEach((n) => { m[n.id] = [Math.round(n.x), Math.round(n.y)]; });
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(m)); } catch {} }

// --- Layout: Default-Fächer, dann gespeicherte Overrides ---
function layoutNodes() {
  const saved = loadSaved();
  const depts = nodes.filter((n) => n.type === "dept");
  const j = byId.jarvis, b = byId.brain;
  if (j) { j.x = 0; j.y = -360; j.r = 26; }
  if (b) { b.x = 0; b.y = -70; b.r = 30; }
  const n = depts.length, span = 1200;
  depts.forEach((d, i) => { const t = n > 1 ? i / (n - 1) - 0.5 : 0; d.x = t * span; d.y = 200 + Math.abs(t) * 150; d.r = 12; });
  nodes.filter((x) => x.type === "unit").forEach((u) => {
    const p = byId[u.parent]; if (!p) return;
    const sibs = nodes.filter((x) => x.type === "unit" && x.parent === u.parent);
    const idx = sibs.indexOf(u), k = sibs.length;
    u.x = p.x + (idx - (k - 1) / 2) * 98; u.y = p.y + 168; u.r = 7;
  });
  nodes.forEach((nn) => { if (saved[nn.id]) { nn.x = saved[nn.id][0]; nn.y = saved[nn.id][1]; } });
}
function layoutLinks() {
  links.forEach((l, i) => {
    const a = byId[l.source], b = byId[l.target]; if (!a || !b) return;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const dir = (i % 2 ? 1 : -1), off = l.kind === "core" ? 0 : len * (l.kind === "command" ? 0.10 : 0.20) * dir;
    l.cx = mx - dy / len * off; l.cy = my + dx / len * off; l.len = len;
  });
}
function bez(l, u) { const w = 1 - u, a = byId[l.source], b = byId[l.target];
  return [w * w * a.x + 2 * w * u * l.cx + u * u * b.x, w * w * a.y + 2 * w * u * l.cy + u * u * b.y]; }

function buildNeighbors() { neigh = {}; nodes.forEach((n) => neigh[n.id] = new Set([n.id]));
  links.forEach((l) => { neigh[l.source] && neigh[l.source].add(l.target); neigh[l.target] && neigh[l.target].add(l.source); }); }
function inBranch(id) { return !hover || hover.id === id || (neigh[hover.id] && neigh[hover.id].has(id)); }

// --- Sichtbarkeit (Banner = nur Hauptpunkte) ---
function visNode(n) { return !BANNER || n.type !== "unit"; }
function visLink(l) { return !BANNER || (byId[l.source] && byId[l.target] && byId[l.source].type !== "unit" && byId[l.target].type !== "unit"); }

// --- Nebel + Kamera ---
let blobs = [];
function makeBlobs() { blobs = []; let s = 7; const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const cols = ["167,139,250", "63,208,201", "244,114,182", "255,207,107"];
  for (let i = 0; i < 6; i++) blobs.push({ x: (rnd() - 0.5) * 1500, y: (rnd() - 0.5) * 1100 - 100, r: 300 + rnd() * 320, c: cols[i % 4], a: 0.05 + rnd() * 0.05, ph: rnd() * 6.28 }); }
function bbox() { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  nodes.forEach((n) => { if (!visNode(n)) return; x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); });
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }; }
function fit() {
  const b = bbox();
  if (BANNER) { const s = Math.min((W * 0.58) / (b.w + 140), (H * 0.90) / (b.h + 70));
    cam.ts = s; cam.tx = b.cx + (W * 0.19) / s; cam.ty = b.cy + 45; }
  else { const padL = 300, padR = 40, padT = 90, padB = 60;
    const s = Math.min((W - padL - padR) / (b.w + 160), (H - padT - padB) / (b.h + 160));
    cam.ts = Math.min(s, 1.05); cam.tx = b.cx - (padL - padR) / 2 / cam.ts; cam.ty = b.cy; }
  if (!ready) { cam.s = cam.ts; cam.x = cam.tx; cam.y = cam.ty; }
}
function toScreen(x, y) { return [(x - cam.x) * cam.s + W / 2, (y - cam.y) * cam.s + H / 2]; }
function toWorld(sx, sy) { return [(sx - W / 2) / cam.s + cam.x, (sy - H / 2) / cam.s + cam.y]; }
addEventListener("resize", () => { resize(); if (!userMoved) fit(); });

// --- Interaktion: Knoten ziehen · Karte schwenken · Klick/Doppelklick ---
let panDrag = false, nodeDrag = null, dragOff = [0, 0], moved = false, lx = 0, ly = 0;
function hitNode(cx, cy) { const [wx, wy] = toWorld(cx, cy);
  for (const n of nodes) { if (!visNode(n)) continue; if (Math.hypot(n.x - wx, n.y - wy) < (n.r + 10) / Math.min(cam.s, 1) + n.r) return n; } return null; }
if (!BANNER) {
  cv.addEventListener("mousedown", (e) => { moved = false; lx = e.clientX; ly = e.clientY;
    const hit = hitNode(e.clientX, e.clientY);
    if (hit) { nodeDrag = hit; const [wx, wy] = toWorld(e.clientX, e.clientY); dragOff = [hit.x - wx, hit.y - wy]; }
    else { panDrag = true; cv.classList.add("drag"); } });
  addEventListener("mouseup", () => {
    if (nodeDrag) { if (moved) savePositions(); else select(nodeDrag); nodeDrag = null; }
    else if (panDrag && !moved && selected) deselect();
    panDrag = false; cv.classList.remove("drag"); });
  cv.addEventListener("mousemove", (e) => {
    if (nodeDrag) { const [wx, wy] = toWorld(e.clientX, e.clientY); nodeDrag.x = wx + dragOff[0]; nodeDrag.y = wy + dragOff[1];
      moved = true; userMoved = true; layoutLinks(); return; }
    if (panDrag) { const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) { moved = true; userMoved = true; }
      cam.x -= dx / cam.s; cam.y -= dy / cam.s; cam.tx = cam.x; cam.ty = cam.y; return; }
    hover = hitNode(e.clientX, e.clientY); cv.style.cursor = hover ? "grab" : "default"; });
  cv.addEventListener("dblclick", (e) => { const hit = hitNode(e.clientX, e.clientY); if (hit && hit.deepLink) location.href = hit.deepLink; });
  cv.addEventListener("wheel", (e) => { e.preventDefault(); userMoved = true;
    const f = Math.exp(-e.deltaY * 0.0012), ns = Math.max(0.3, Math.min(3, cam.s * f)), [wx, wy] = toWorld(e.clientX, e.clientY);
    cam.x = wx - (e.clientX - W / 2) / ns; cam.y = wy - (e.clientY - H / 2) / ns; cam.s = ns; cam.tx = cam.x; cam.ty = cam.y; cam.ts = ns; }, { passive: false });
  document.querySelector("#panel .close").addEventListener("click", deselect);
  addEventListener("keydown", (e) => { if (e.key === "Escape") deselect(); });
}

const panel = document.getElementById("panel");
function select(n) {
  selected = n;
  const eb = n.type === "core" ? "CEO" : n.type === "brain" ? "WISSEN" : n.type === "unit" ? "AUFGABE · " + (byId[n.parent] ? byId[n.parent].label.toUpperCase() : "") : "ABTEILUNG";
  document.getElementById("p-eyebrow").textContent = eb;
  document.getElementById("p-name").textContent = n.label;
  document.getElementById("p-sub").textContent = n.sub || "";
  document.getElementById("p-status").textContent = (n.status || "online").toUpperCase();
  document.getElementById("p-kpis").innerHTML = (n.kpis || []).map((k) => `<div class="kpi"><b>${k[1]}</b><span>${String(k[0]).toUpperCase()}</span></div>`).join("");
  const last = (n.last || []).filter(Boolean);
  document.getElementById("p-lasth").hidden = !last.length;
  document.getElementById("p-last").innerHTML = last.map((t) => `<li>${t}</li>`).join("");
  document.getElementById("p-deep").href = n.deepLink || "/#dashboard";
  panel.classList.add("open"); userMoved = true; cam.tx = n.x + 150; cam.ty = n.y; cam.ts = Math.max(1.15, cam.s);
}
function deselect() { selected = null; panel.classList.remove("open"); userMoved = false; fit(); }

// --- Boot ---
const t0 = performance.now();
function bootT() { return (BANNER || REDUCED) ? 99 : (performance.now() - t0) / 1000; }
function ramp(t, a, b) { return Math.max(0, Math.min(1, (t - a) / (b - a))); }
function ease(p) { return p < 0 ? 0 : p > 1 ? 1 : p * p * (3 - 2 * p); }
function wakeOf(n) { if (n.type === "core") return 0.3; if (n.type === "brain") return 0.9; if (n.type === "dept") return 1.5 + (n._i || 0) * 0.1; return 2.4 + (n._i || 0) * 0.08; }
function hexA(hex, a) { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`; }
function drawBannerText() {
  ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
  const rx = W * 0.955, h1 = Math.round(W * 0.030), lh = h1 * 1.14, subH = Math.round(W * 0.0135);
  const top = H * 0.5 - (BANNER_MAIN.length * lh + subH * 1.6) / 2 + h1 * 0.55;
  ctx.fillStyle = "#ffffff"; ctx.font = "600 " + h1 + "px Sora, 'Segoe UI', sans-serif";
  BANNER_MAIN.forEach((line, i) => ctx.fillText(line, rx, top + i * lh));
  ctx.fillStyle = "#b98bff"; ctx.font = "italic 300 " + subH + "px Fraunces, Georgia, serif";
  ctx.fillText(BANNER_SUB, rx, top + BANNER_MAIN.length * lh + subH * 1.2);
}

// --- Zeichnen ---
function draw() { try {
  const t = performance.now() / 1000, bt = bootT();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = "#070510"; ctx.fillRect(0, 0, W, H);
  const skyA = ease(ramp(bt, 0, 0.8));
  for (const b of blobs) { const [sx, sy] = toScreen(b.x + Math.sin(t * 0.05 + b.ph) * 40, b.y + Math.cos(t * 0.04 + b.ph) * 30);
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, b.r * cam.s);
    g.addColorStop(0, `rgba(${b.c},${b.a * skyA})`); g.addColorStop(1, `rgba(${b.c},0)`);
    ctx.fillStyle = g; ctx.fillRect(sx - b.r * cam.s, sy - b.r * cam.s, b.r * 2 * cam.s, b.r * 2 * cam.s); }

  // Kanten + feuernde Impulse (Synapse). Impuls schießt über die Bahn, Zielknoten leuchtet bei Ankunft auf.
  for (const l of links) {
    if (!visLink(l)) continue;
    const a = byId[l.source], b = byId[l.target]; if (!a || !b) continue;
    const wake = ease(ramp(bt, wakeOf(b) - 0.3, wakeOf(b) + 0.3)); if (wake <= 0) continue;
    const dim = (inBranch(l.source) && inBranch(l.target)) ? 1 : 0.10;
    const [x1, y1] = toScreen(a.x, a.y), [x2, y2] = toScreen(b.x, b.y), [cx, cy] = toScreen(l.cx, l.cy);
    ctx.globalAlpha = (l.kind === "command" ? 0.14 : 0.26) * wake * dim;
    ctx.strokeStyle = l.color; ctx.lineWidth = l.kind === "knowledge" ? 1.3 : 1;
    ctx.setLineDash(l.kind === "command" ? [3, 6] : []);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, x2, y2); ctx.stroke(); ctx.setLineDash([]);
    // feuern
    if (l.pulses == null) { l.pulses = []; l.nextFire = t + 0.4 + Math.random() * 2.5; }
    const act = b.activity != null ? b.activity : 0.3;
    if (bt > wakeOf(b) && t > l.nextFire) {
      const burst = 1 + Math.round(act * 2);
      for (let k = 0; k < burst; k++) l.pulses.push({ start: t + k * 0.13, dur: 0.85 + Math.random() * 0.4, dir: Math.random() < 0.8 ? 1 : -1 });
      l.nextFire = t + 0.7 + Math.random() * 3.4 / (0.25 + act);
    }
    l.pulses = l.pulses.filter((p) => t - p.start < p.dur);
    for (const p of l.pulses) {
      const prog = (t - p.start) / p.dur; if (prog < 0) continue;
      const along = p.dir > 0 ? prog : 1 - prog;
      for (let s = 0; s < 5; s++) {
        const uu = Math.max(0, Math.min(1, along - s * 0.035 * p.dir)), [px, py] = bez(l, uu), [sx, sy] = toScreen(px, py);
        ctx.globalAlpha = dim * (1 - s / 5) * 0.95; ctx.fillStyle = s === 0 ? "#ffffff" : l.color;
        ctx.shadowColor = l.color; ctx.shadowBlur = s === 0 ? 12 : 0;
        ctx.beginPath(); ctx.arc(sx, sy, s === 0 ? 2.3 : 1.6 - s * 0.25, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
      }
      if (prog > 0.96) { const hitN = p.dir > 0 ? b : a; hitN.flash = t; }   // Ankunft → aufleuchten
    }
  }
  ctx.globalAlpha = 1;

  // Knoten
  for (const n of nodes) {
    if (!visNode(n)) continue;
    const wake = ease(ramp(bt, wakeOf(n), wakeOf(n) + 0.5)); if (wake <= 0) continue;
    const dim = inBranch(n.id) ? 1 : 0.12;
    const [sx, sy] = toScreen(n.x, n.y);
    const breath = 0.8 + 0.2 * Math.sin(t * (0.6 + (n.activity || .5) * 1.2) + (n._i || 0));
    const flash = Math.max(0, 1 - (t - (n.flash || 0)) * 2.6);
    const pop = 1 + (1 - wake) * 1.4;
    const R = n.r * pop * cam.s * (n === hover || n === selected ? 1.18 : 1) * (n === nodeDrag ? 1.15 : 1);
    const halo = R * (n.type === "brain" ? 4.2 : n.type === "core" ? 3.4 : 2.8) * (breath + flash * 0.6);
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(1, halo));
    g.addColorStop(0, hexA(n.color, (0.42 + flash * 0.4) * breath * dim)); g.addColorStop(0.5, hexA(n.color, 0.14 * dim)); g.addColorStop(1, hexA(n.color, 0));
    ctx.globalAlpha = wake; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, Math.max(1, halo), 0, 7); ctx.fill();
    ctx.globalAlpha = wake * dim; ctx.fillStyle = n.type === "brain" || n.type === "core" ? "#ffffff" : "#f4eeff";
    ctx.shadowColor = n.color; ctx.shadowBlur = ((n.type === "brain" ? 28 : n.type === "core" ? 22 : 14) * breath) + flash * 26;
    ctx.beginPath(); ctx.arc(sx, sy, R * (0.72 + 0.28 * breath) + flash * R * 0.3, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    if (n.type === "brain" || n.type === "core") { ctx.globalAlpha = wake * dim * 0.6; ctx.strokeStyle = n.color; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(sx, sy, R + 7, 0, 7); ctx.stroke(); }
    if (n === selected) { ctx.globalAlpha = 0.9; ctx.strokeStyle = "#fff"; ctx.setLineDash([2, 5]); ctx.beginPath(); ctx.arc(sx, sy, R + 12, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
    const la = wake * dim * ease(ramp(bt, wakeOf(n) + 0.3, wakeOf(n) + 0.9));
    if (la > 0.02 && (n.type !== "unit" || cam.s > 0.62)) {
      ctx.globalAlpha = la; ctx.textAlign = "center";
      const big = n.type === "core" || n.type === "brain";
      ctx.font = (big ? "600 14px" : n.type === "dept" ? "500 12.5px" : "500 11px") + " 'Sora'";
      ctx.fillStyle = "#efe8ff"; ctx.fillText(n.label, sx, sy + R + (big ? 22 : 17));
      if (n.sub) { ctx.font = "italic 300 " + (big ? "13px" : "11.5px") + " 'Fraunces'"; ctx.fillStyle = hexA(n.color, 0.9); ctx.fillText(n.sub, sx, sy + R + (big ? 40 : 31)); }
    }
  }
  ctx.globalAlpha = 1;
  if (BANNER) drawBannerText();
} catch (e) { if (!window.__drawErr) window.__drawErr = (e && e.message || String(e)) + " @ " + (e && e.stack || ""); }
  if (document.hidden) { bgPaused = true; return; } // Hintergrund → Loop stoppen (17.07.), Resume via visibilitychange
  requestAnimationFrame(draw);
}
// Hintergrund-Schutz (17.07.): Die Star-Map darf im Hintergrund keine CPU fressen:
// beide Zeichen-Loops stoppen sich bei document.hidden selbst und werden hier wieder angeworfen.
let bgPaused = false;
function camStep() { cam.x += (cam.tx - cam.x) * 0.08; cam.y += (cam.ty - cam.y) * 0.08; cam.s += (cam.ts - cam.s) * 0.08; if (document.hidden) { bgPaused = true; return; } requestAnimationFrame(camStep); }
camStep();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && bgPaused) { bgPaused = false; if (ready) requestAnimationFrame(draw); requestAnimationFrame(camStep); }
});

// --- Feed + Uhr ---
function renderFeed() { if (BANNER) return; const ul = document.getElementById("feedlist"); ul.innerHTML = "";
  const col = {}; nodes.forEach((n) => col[n.id] = n.color);
  feed.slice(0, 24).forEach((f) => { const li = document.createElement("li");
    const hh = f.ts ? new Date(f.ts * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "";
    const c = col[f.dept] || "#8f86ad";
    li.innerHTML = `<span class="t">${hh}</span><span class="d" style="background:${c};box-shadow:0 0 6px ${c}"></span><span class="x">${f.text}</span>`;
    ul.appendChild(li); requestAnimationFrame(() => li.classList.add("in")); }); }
function tick() { const n = new Date(), el = document.getElementById("clock");
  if (el) el.textContent = n.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }) + " · " + n.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }); }

// --- Laden ---
function ingest(data) {
  const prevSel = selected && selected.id;
  nodes = data.nodes || []; links = data.links || []; feed = data.feed || [];
  byId = {}; nodes.forEach((n, i) => { n._i = i; byId[n.id] = n; });
  layoutNodes(); layoutLinks(); buildNeighbors(); makeBlobs(); fit(); renderFeed();
  if (prevSel && byId[prevSel]) { selected = byId[prevSel]; }
}
async function load(first) {
  try {
    const r = await fetch("/api/starmap", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    ingest(await r.json());
    if (first) { ready = true; requestAnimationFrame(draw); }
  } catch (e) {
    if (first) { const el = document.getElementById("err"); el.classList.add("show");
      el.textContent = "Brain-Daten nicht erreichbar (/api/starmap). Läuft der Dashboard-Server auf 4321? " + e.message; }
  }
}
if (PARAMS.has("debug")) window.__sm = { get cam() { return cam; }, get nodes() { return nodes; }, get links() { return links; }, toScreen, select };
load(true).then(() => { if (!ready) return;
  if (!BANNER) { setInterval(() => { if (!document.hidden) load(false); }, 6000);
    setTimeout(() => document.getElementById("hint").classList.add("in"), 4000);
    setTimeout(() => document.getElementById("hint").classList.remove("in"), 13000);
    tick(); setInterval(tick, 10000); } });
})();
