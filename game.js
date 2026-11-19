'use strict';

// ---------------------------------------------------------------------------
// Lane Fighter
// A medieval squad of archers marches up a forest road: pick the right gates
// to grow the squad, shoot down the goblin horde, then beat the troll.
//
// The game runs in flat "world" coordinates (x across the road, y along it;
// the squad stands at y = SQUAD_Y and things come from small y towards it).
// Only the drawing is projected into a fake-3D perspective view.
// All figures are drawn in code once at start-up and cached as sprites.
// ---------------------------------------------------------------------------

// Logical playfield size (portrait). The canvas is scaled to fit the window.
const W = 540;
const H = 960;
const ROAD_L = 50;
const ROAD_R = 490;
const MID = (ROAD_L + ROAD_R) / 2;
const SQUAD_Y = 800;          // where the squad stands (world y)
const SPAWN_Y = -350;         // where things appear, far up the road
const ARROW_END_Y = -260;     // arrows vanish past this point
const SCROLL = 110;           // world scroll speed (units/s)
const BULLET_SPEED = 900;
const MAX_VISIBLE = 60;       // soldiers drawn; more are "in the blob" but not drawn
const FIRE_INTERVAL = 0.3;    // seconds between shots per visible soldier
const MAX_WEAPON = 6;
const MAX_SQUAD = 999;        // keeps multiplier gates from snowballing forever

// Perspective camera: scale s = FOCAL / (CAM_Y - y); screen y = HORIZON + KY * s.
// At the squad (y = 800) s = 1, so world and screen sizes match there.
const CAM_Y = 1741;
const FOCAL = 941;
const HORIZON = -299;
const KY = 1109;

const FONT_TITLE = "'Cinzel', Georgia, 'Times New Roman', serif";
const FONT_UI = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let scale = 1;

// ---- helpers --------------------------------------------------------------
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function persp(y) { return FOCAL / Math.max(CAM_Y - y, 40); }
function screenX(x, s) { return MID + (x - MID) * s; }
function screenY(s) { return HORIZON + KY * s; }

function loadBest() {
  try { return parseInt(localStorage.getItem('laneFighterBest') || '0', 10) || 0; }
  catch (e) { return 0; }
}
function saveBest(v) {
  try { localStorage.setItem('laneFighterBest', String(v)); } catch (e) { /* ignore */ }
}

// Sunflower layout: offsets (world units) for soldiers around the squad centre.
const FORMATION = [];
for (let i = 0; i < MAX_VISIBLE; i++) {
  const r = 7.5 * Math.sqrt(i);
  const a = i * 2.39996;
  FORMATION.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.8 });
}

// ---- sprites (drawn once in code, cached as images) --------------------------
const RES = 3; // sprite pixels per world unit, keeps them sharp when scaled up

function makeSprite(w, h, draw, outline) {
  const pad = 1;
  const cw = (w + pad * 2) * RES;
  const ch = (h + pad * 2) * RES;
  const base = document.createElement('canvas');
  base.width = cw; base.height = ch;
  const g = base.getContext('2d');
  g.scale(RES, RES);
  g.translate(pad, pad);
  draw(g);
  let img = base;
  if (outline !== false) {
    // dark outline: a tinted silhouette drawn around the figure
    const sil = document.createElement('canvas');
    sil.width = cw; sil.height = ch;
    const sg = sil.getContext('2d');
    sg.drawImage(base, 0, 0);
    sg.globalCompositeOperation = 'source-in';
    sg.fillStyle = 'rgba(25,16,8,0.9)';
    sg.fillRect(0, 0, cw, ch);
    img = document.createElement('canvas');
    img.width = cw; img.height = ch;
    const og = img.getContext('2d');
    const o = RES * 0.8;
    og.drawImage(sil, -o, 0); og.drawImage(sil, o, 0);
    og.drawImage(sil, 0, -o); og.drawImage(sil, 0, o);
    og.drawImage(base, 0, 0);
  }
  return { img, w: w + pad * 2, h: h + pad * 2 };
}

function flashSprite(spr) {
  const c = document.createElement('canvas');
  c.width = spr.img.width; c.height = spr.img.height;
  const g = c.getContext('2d');
  g.drawImage(spr.img, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.fillRect(0, 0, c.width, c.height);
  return { img: c, w: spr.w, h: spr.h };
}

function circ(g, x, y, r, c) { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
function rect(g, c, x, y, w, h) { g.fillStyle = c; g.fillRect(x, y, w, h); }
function poly(g, c, p) {
  g.fillStyle = c; g.beginPath(); g.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
  g.closePath(); g.fill();
}
function line(g, c, lw, x0, y0, x1, y1) {
  g.strokeStyle = c; g.lineWidth = lw; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
}

// Archer, seen from behind (24 x 34)
function drawArcher(g, f) {
  const a = f ? 1.6 : 0, b = f ? 0 : 1.6;
  rect(g, '#3b2a1a', 8, 25, 3, 8 - a); rect(g, '#3b2a1a', 13, 25, 3, 8 - b);
  rect(g, '#1f150b', 8, 31 - a, 3, 2); rect(g, '#1f150b', 13, 31 - b, 3, 2);
  rect(g, '#23509a', 3.5, 15, 3.5, 8); rect(g, '#23509a', 17, 15, 3.5, 8);
  circ(g, 5.2, 23.5, 1.6, '#e8b98a'); circ(g, 18.8, 23.5, 1.6, '#e8b98a');
  poly(g, '#2a5db0', [6.5, 14, 17.5, 14, 19, 27, 5, 27]);
  rect(g, '#5a3a1a', 5.6, 21, 12.8, 2);
  rect(g, '#7a4a22', 13.5, 9, 4, 12);
  line(g, '#f2f2f2', 1.2, 14.5, 9, 14, 6.5); line(g, '#f2f2f2', 1.2, 16.5, 9, 17.5, 6.5);
  circ(g, 12, 9, 5.2, '#a7b0ba');
  rect(g, '#7d8792', 6.8, 10.4, 10.4, 1.6);
  rect(g, '#d5dce3', 11.4, 4, 1.2, 6);
  g.strokeStyle = '#6b3f1d'; g.lineWidth = 1.7;
  g.beginPath(); g.arc(10, 17, 9.5, Math.PI - 1.0, Math.PI + 1.0); g.stroke();
  const bx = 10 - 9.5 * Math.cos(1.0), by = 9.5 * Math.sin(1.0);
  line(g, '#efe6cc', 0.6, bx, 17 - by, bx, 17 + by);
}

// Goblin, facing the squad (22 x 26)
function drawGoblin(g, f) {
  const a = f ? 1.5 : 0, b = f ? 0 : 1.5;
  rect(g, '#2f4a22', 7, 18, 3, 7 - a); rect(g, '#2f4a22', 12, 18, 3, 7 - b);
  line(g, '#5b8f3a', 2.6, 5, 13, 3, 19); line(g, '#5b8f3a', 2.6, 17, 13, 19, 18);
  line(g, '#6b4423', 2.6, 19.5, 19, 21, 8); circ(g, 21, 8.5, 2.2, '#7a5230');
  poly(g, '#7a5230', [5, 12, 17, 12, 18, 20, 15, 19, 13, 21, 10, 19.5, 7, 21, 4, 20]);
  poly(g, '#6fae45', [6, 7, 0.5, 3.5, 6.5, 10]); poly(g, '#6fae45', [16, 7, 21.5, 3.5, 15.5, 10]);
  circ(g, 11, 7.5, 5.5, '#6fae45');
  circ(g, 9, 7.3, 1.3, '#ffe14a'); circ(g, 13, 7.3, 1.3, '#ffe14a');
  circ(g, 9, 7.4, 0.55, '#1a1a1a'); circ(g, 13, 7.4, 0.55, '#1a1a1a');
  line(g, '#2a3d1c', 0.8, 9.2, 10.3, 12.8, 10.3);
}

// Orc brute with an axe (38 x 42)
function drawOrc(g, f) {
  const a = f ? 2 : 0, b = f ? 0 : 2;
  rect(g, '#2b2b2b', 10, 30, 5, 11 - a); rect(g, '#2b2b2b', 19, 30, 5, 11 - b);
  line(g, '#55803a', 5, 6, 18, 4, 29); line(g, '#55803a', 5, 28, 18, 31, 28);
  line(g, '#5a3a1a', 2.2, 31, 33, 32.5, 6);
  poly(g, '#aab3bc', [32, 7, 37.5, 3.5, 37.5, 15, 32, 13]);
  poly(g, '#5b5f66', [7, 15, 27, 15, 28, 32, 6, 32]);
  rect(g, '#737882', 11, 18, 12, 8);
  rect(g, '#3a2a1a', 6.5, 28, 21, 3);
  circ(g, 17, 10, 7.5, '#5f8a3e');
  g.fillStyle = '#3a3d42'; g.beginPath(); g.arc(17, 9.5, 7.9, Math.PI, 0); g.fill();
  poly(g, '#e8e0c8', [9.5, 6, 6, 0.5, 11.5, 4.5]); poly(g, '#e8e0c8', [24.5, 6, 28, 0.5, 22.5, 4.5]);
  circ(g, 14.5, 11, 1.3, '#ff3b2a'); circ(g, 19.5, 11, 1.3, '#ff3b2a');
  poly(g, '#f2ead2', [14, 15, 14.8, 12.6, 15.6, 15]); poly(g, '#f2ead2', [18.4, 15, 19.2, 12.6, 20, 15]);
}

// Troll boss with a club (120 x 130)
function drawTroll(g, f) {
  const a = f ? 4 : 0, b = f ? 0 : 4;
  rect(g, '#5f7182', 38, 96, 16, 30 - a); rect(g, '#5f7182', 66, 96, 16, 30 - b);
  rect(g, '#4c5b69', 34, 122 - a, 22, 7); rect(g, '#4c5b69', 64, 122 - b, 22, 7);
  line(g, '#6b4a2a', 9, 98, 96, 108, 22);
  circ(g, 108, 20, 12, '#6b4a2a'); circ(g, 104, 14, 2.5, '#3f2a14'); circ(g, 112, 25, 2.5, '#3f2a14'); circ(g, 113, 15, 2.5, '#3f2a14');
  line(g, '#7d93a6', 14, 28, 52, 15, 90); line(g, '#7d93a6', 14, 92, 52, 98, 90);
  circ(g, 15, 92, 9, '#7d93a6'); circ(g, 98, 92, 9, '#7d93a6');
  g.fillStyle = '#7d93a6'; g.beginPath(); g.ellipse(60, 68, 36, 38, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#9ab0c2'; g.beginPath(); g.ellipse(60, 76, 24, 24, 0, 0, Math.PI * 2); g.fill();
  poly(g, '#6b4a2a', [34, 90, 86, 90, 82, 108, 70, 102, 60, 110, 50, 102, 38, 108]);
  circ(g, 60, 30, 17, '#7d93a6');
  rect(g, '#4c5b69', 45, 22, 30, 5);
  circ(g, 53, 30, 3, '#ffd84a'); circ(g, 67, 30, 3, '#ffd84a');
  poly(g, '#f2ead2', [50, 41, 52, 33, 54, 41]); poly(g, '#f2ead2', [66, 41, 68, 33, 70, 41]);
}

// Treasure chest (40 x 34)
function drawChest(g) {
  rect(g, '#8a5a2b', 3, 14, 34, 18);
  g.fillStyle = '#9c6a35'; g.beginPath(); g.moveTo(3, 15); g.lineTo(3, 9);
  g.quadraticCurveTo(20, 0, 37, 9); g.lineTo(37, 15); g.closePath(); g.fill();
  rect(g, '#e0b030', 8, 5, 3, 27); rect(g, '#e0b030', 29, 5, 3, 27);
  rect(g, '#e0b030', 3, 14, 34, 2.2);
  rect(g, '#f4d35e', 17, 15, 6, 7); rect(g, '#5a3a1a', 19.3, 17.5, 1.4, 3);
}

// Trees (50 x 100 pines, 62 x 90 oak)
function drawPine(c1, c2, c3) {
  return g => {
    rect(g, '#5a3a1e', 22, 78, 6, 22);
    poly(g, c1, [25, 40, 3, 86, 47, 86]);
    poly(g, c2, [25, 22, 7, 64, 43, 64]);
    poly(g, c3, [25, 3, 11, 43, 39, 43]);
  };
}
function drawOak(g) {
  rect(g, '#5e3d20', 27, 58, 8, 32);
  circ(g, 31, 42, 21, '#3f7a35');
  circ(g, 17, 50, 14, '#3a7031'); circ(g, 45, 50, 14, '#3a7031');
  circ(g, 31, 28, 16, '#4c8f3f'); circ(g, 24, 24, 6, '#5aa04a');
}

const SPR = {
  archer: [makeSprite(24, 34, g => drawArcher(g, 0)), makeSprite(24, 34, g => drawArcher(g, 1))],
  goblin: [makeSprite(22, 26, g => drawGoblin(g, 0)), makeSprite(22, 26, g => drawGoblin(g, 1))],
  orc: [makeSprite(38, 42, g => drawOrc(g, 0)), makeSprite(38, 42, g => drawOrc(g, 1))],
  troll: [makeSprite(120, 130, g => drawTroll(g, 0)), makeSprite(120, 130, g => drawTroll(g, 1))],
  chest: makeSprite(40, 34, drawChest),
  trees: [
    makeSprite(50, 100, drawPine('#24502b', '#2d6334', '#357540')),
    makeSprite(50, 100, drawPine('#1f4727', '#285a2f', '#2f6a39')),
    makeSprite(62, 90, drawOak),
  ],
};
SPR.goblinHit = SPR.goblin.map(flashSprite);
SPR.orcHit = SPR.orc.map(flashSprite);
SPR.trollHit = SPR.troll.map(flashSprite);
SPR.chestHit = flashSprite(SPR.chest);

// Characters are drawn a bit larger than their hit circles so they read well on phones.
const FIGURE_SCALE = 1.35;

// Draw a sprite standing on the ground at world (x, y).
// s = perspective scale at that depth, k = extra size factor (does not move it).
function drawSprite(spr, x, y, s, k, mirror) {
  const w = spr.w * s * k;
  const h = spr.h * s * k;
  const px = screenX(x, s);
  const py = screenY(s);
  if (mirror) {
    ctx.save();
    ctx.translate(px, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(spr.img, -w / 2, py - h + s, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(spr.img, px - w / 2, py - h + s, w, h);
  }
}

// ---- game state -------------------------------------------------------------
const state = {
  mode: 'title',          // title | play | clear | over
  level: 1,
  squad: 5,
  weapon: 1,
  squadX: MID,
  targetX: MID,
  enemies: [],
  bullets: [],
  gates: [],
  crates: [],
  particles: [],
  floaters: [],
  trees: [],
  events: [],
  bossTime: 1,
  boss: null,
  levelTime: 0,
  time: 0,
  scroll: 0,
  fireAcc: 0,
  drainTimer: 0,
  modeTimer: 0,
  shake: 0,
  best: loadBest(),
  kills: 0,
};
window.__game = state; // handy for debugging in the browser console

function visibleCount() { return Math.min(state.squad, MAX_VISIBLE); }
function squadRadius() { return 7.5 * Math.sqrt(Math.max(visibleCount() - 1, 0)) + 9; }
function soldierDps() { return 1.5 * (1 + 0.35 * (state.weapon - 1)); }

// Forest on both sides of the road; trees scroll and wrap around.
const TREE_NEAR = 1150;
const TREE_FAR = -3200;
function plantTrees() {
  state.trees.length = 0;
  for (let y = TREE_FAR; y < TREE_NEAR; y += 46) {
    for (const side of [-1, 1]) {
      const edge = side < 0 ? ROAD_L : ROAD_R;
      state.trees.push({
        x: edge + side * rand(30, 300),
        y: y + rand(-20, 20),
        kind: Math.random() < 0.7 ? randInt(0, 1) : 2,
        size: rand(0.85, 1.25),
        mirror: Math.random() < 0.5,
      });
    }
  }
}
plantTrees();

// ---- level script -----------------------------------------------------------
function buildLevel(L) {
  const ev = [];
  let t = 1.0;
  const segments = 4 + Math.min(L, 6);
  // Each stretch: a horde, then a pair of gates behind it. Arrows hit whatever
  // is nearest, so you shoot through the horde first, then improve the gate.
  for (let i = 0; i < segments; i++) {
    const size = i === 0 ? 6 + L * 6 : 12 + L * 6 + i * 4;
    ev.push({ t, kind: 'horde', size: Math.round(size) });
    ev.push({ t: t + 1.2, kind: 'gates' });
    if (i % 3 === 1) ev.push({ t: t + 2.6, kind: 'crate' });
    t += i % 3 === 1 ? 9.2 : 7.8;
  }
  ev.push({ t: t + 1.5, kind: 'boss' });
  ev.sort((a, b) => a.t - b.t);
  state.bossTime = t + 1.5;
  return ev;
}

function startLevel() {
  state.events = buildLevel(state.level);
  state.levelTime = 0;
  state.enemies.length = 0;
  state.bullets.length = 0;
  state.gates.length = 0;
  state.crates.length = 0;
  state.boss = null;
  state.mode = 'play';
  floater(MID, 430, 'LEVEL ' + state.level, '#fff2c8', 38, 1.6, true);
}

function newGame() {
  state.level = 1;
  state.squad = 5;
  state.weapon = 1;
  state.kills = 0;
  state.squadX = state.targetX = MID;
  state.particles.length = 0;
  state.floaters.length = 0;
  startLevel();
}

// ---- spawning ---------------------------------------------------------------
function spawnGates() {
  const L = state.level;
  const good = () => (Math.random() < 0.7
    ? { op: 'add', v: randInt(4, 8 + L * 4) }
    : { op: 'mul', v: Math.random() < 0.85 ? 2 : 3 });
  const bad = () => {
    const r = Math.random();
    if (r < 0.55) return { op: 'sub', v: randInt(3, 6 + L * 3) };
    if (r < 0.8) return { op: 'div', v: 2 };
    return { op: 'add', v: randInt(1, 3) };
  };
  let a = good();
  let b = Math.random() < 0.65 ? bad() : good();
  if (Math.random() < 0.5) { const t = a; a = b; b = t; }
  const pair = {};
  const left = { pair, x0: ROAD_L, x1: MID, y: SPAWN_Y, h: 56, op: a.op, v: a.v, acc: 0, used: false, chosen: false, flash: 0 };
  const right = { pair, x0: MID, x1: ROAD_R, y: SPAWN_Y, h: 56, op: b.op, v: b.v, acc: 0, used: false, chosen: false, flash: 0 };
  pair.left = left; pair.right = right;
  state.gates.push(left, right);
}

function spawnHorde(size) {
  const L = state.level;
  const cols = Math.ceil(Math.sqrt(size * 1.6));
  const width = cols * 20;
  const cx = rand(ROAD_L + width / 2 + 10, ROAD_R - width / 2 - 10) || MID;
  for (let i = 0; i < size; i++) {
    const brute = L >= 3 && Math.random() < Math.min(0.05 * (L - 2), 0.25);
    const r = brute ? 16 : 9;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = clamp(cx + (col - (cols - 1) / 2) * 20 + rand(-4, 4), ROAD_L + r, ROAD_R - r);
    const hp = (brute ? 10 : 1) * (1.5 + L * 0.8) * Math.pow(1.22, L - 1);
    state.enemies.push({
      x, y: SPAWN_Y - row * 22 + rand(-4, 4), r, hp, maxHp: hp,
      speed: SCROLL + (brute ? 25 : 45) + rand(-8, 8),
      dmg: brute ? 5 : 1, brute, hit: 0, phase: rand(0, 2),
    });
  }
}

function spawnCrate() {
  const hp = 25 + state.level * 20;
  state.crates.push({ x: rand(ROAD_L + 50, ROAD_R - 50), y: SPAWN_Y, r: 22, hp, maxHp: hp, hit: 0 });
}

function spawnBoss() {
  const L = state.level;
  const hp = Math.round(350 * L * Math.pow(1.35, L - 1));
  state.boss = { x: MID, y: SPAWN_Y - 60, r: 64, hp, maxHp: hp, speed: 80, hit: 0 };
  floater(MID, 380, 'THE TROLL COMES!', '#ff6b4a', 34, 1.6, true);
}

// ---- effects ----------------------------------------------------------------
// Particles live in the world: (x, y) on the ground, z = height above it.
function burst(x, y, color, n, speed) {
  for (let i = 0; i < n && state.particles.length < 500; i++) {
    const a = rand(0, Math.PI * 2);
    const sp = rand(speed * 0.3, speed);
    state.particles.push({
      x, y, z: rand(6, 18), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, vz: rand(60, 200),
      life: rand(0.35, 0.7), max: 0.7, color, size: rand(2, 4),
    });
  }
}
// Floating text, in screen coordinates.
function floater(x, y, text, color, size, life, title) {
  state.floaters.push({ x, y, text, color, size: size || 24, life: life || 1, max: life || 1, title: !!title });
}
function floaterWorld(x, y, text, color, size, life) {
  const s = persp(y);
  floater(screenX(x, s), screenY(s) - 30 * s, text, color, size, life);
}

// ---- gates ------------------------------------------------------------------
function gateLabel(g) {
  if (g.op === 'add') return '+' + g.v;
  if (g.op === 'sub') return '−' + g.v;
  if (g.op === 'mul') return '×' + g.v;
  return '÷' + g.v;
}
function gateIsGood(g) { return g.op === 'add' || g.op === 'mul'; }

function applyGate(g) {
  const before = state.squad;
  if (g.op === 'add') state.squad += g.v;
  else if (g.op === 'sub') state.squad = Math.max(0, state.squad - g.v);
  else if (g.op === 'mul') state.squad *= g.v;
  else state.squad = Math.ceil(state.squad / g.v);
  state.squad = Math.min(state.squad, MAX_SQUAD);
  const diff = state.squad - before;
  floater(state.squadX, SQUAD_Y - 90, (diff >= 0 ? '+' : '') + diff, diff >= 0 ? '#9dffb0' : '#ff7b6b', 32, 1.1);
  if (diff < 0) state.shake = 0.25;
}

// Shooting a +/- gate makes it better.
function gateThreshold() { return 8 + state.level * 4; }
function hitGate(g, dmg) {
  g.acc += dmg;
  g.flash = 0.08;
  const thr = gateThreshold();
  while (g.acc >= thr) {
    g.acc -= thr;
    if (g.op === 'add') g.v = Math.min(g.v + 1, 999);
    else if (g.op === 'sub') {
      g.v -= 1;
      if (g.v <= 0) { g.op = 'add'; g.v = 0; }
    }
  }
}

// ---- update -----------------------------------------------------------------
const keys = { left: false, right: false };

function update(dt) {
  state.time += dt;
  state.scroll = (state.scroll + SCROLL * dt) % 160;

  // the forest always scrolls by
  for (const t of state.trees) {
    t.y += SCROLL * dt;
    if (t.y > TREE_NEAR) t.y -= TREE_NEAR - TREE_FAR;
  }

  // particles and floaters always animate
  for (const p of state.particles) {
    p.x += p.vx * dt; p.y += (p.vy + SCROLL * 0.5) * dt;
    p.vx *= 0.94; p.vy *= 0.94;
    p.z += p.vz * dt; p.vz -= 520 * dt;
    if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.6; p.vy *= 0.6; }
    p.life -= dt;
  }
  state.particles = state.particles.filter(p => p.life > 0);
  for (const f of state.floaters) { f.y -= 40 * dt; f.life -= dt; }
  state.floaters = state.floaters.filter(f => f.life > 0);
  state.shake = Math.max(0, state.shake - dt);

  if (state.mode === 'title' || state.mode === 'over') {
    state.modeTimer += dt;
    return;
  }

  // steering
  if (keys.left) state.targetX -= 420 * dt;
  if (keys.right) state.targetX += 420 * dt;
  const sr = squadRadius();
  state.targetX = clamp(state.targetX, ROAD_L + sr, ROAD_R - sr);
  state.squadX += (state.targetX - state.squadX) * Math.min(1, dt * 12);

  if (state.mode === 'clear') {
    state.modeTimer -= dt;
    updateBullets(dt);
    if (state.modeTimer <= 0) {
      state.level += 1;
      startLevel();
    }
    return;
  }

  // level script
  state.levelTime += dt;
  while (state.events.length && state.events[0].t <= state.levelTime) {
    const e = state.events.shift();
    if (e.kind === 'gates') spawnGates();
    else if (e.kind === 'horde') spawnHorde(e.size);
    else if (e.kind === 'crate') spawnCrate();
    else if (e.kind === 'boss') spawnBoss();
  }

  // firing: each visible soldier fires every FIRE_INTERVAL; damage scales with squad size
  // Archers aim at the nearest few enemies in range (or the troll);
  // with nothing in range they shoot straight ahead (at gates and chests).
  const vis = visibleCount();
  if (vis > 0) {
    const targets = [];
    for (const e of state.enemies) {
      if (e.hp > 0 && e.y > ARROW_END_Y + 60 && e.y < SQUAD_Y - 10) targets.push(e);
    }
    targets.sort((a, b) => b.y - a.y);
    if (targets.length > 8) targets.length = 8;
    if (!targets.length && state.boss && state.boss.y > ARROW_END_Y) targets.push(state.boss);
    const dmg = soldierDps() * FIRE_INTERVAL * (state.squad / vis);
    state.fireAcc += dt * vis / FIRE_INTERVAL;
    while (state.fireAcc >= 1) {
      state.fireAcc -= 1;
      const f = FORMATION[randInt(0, vis - 1)];
      const x = state.squadX + f.x;
      const y = SQUAD_Y + f.y - 10;
      let vx = 0;
      if (targets.length) {
        const t = targets[randInt(0, targets.length - 1)];
        const flight = Math.max(0.05, (y - t.y) / BULLET_SPEED);
        vx = clamp((t.x - x) / flight, -420, 420);
      }
      state.bullets.push({ x, y, vx, dmg });
    }
  }

  updateBullets(dt);

  // gates move with the world; passing one applies it
  for (const g of state.gates) {
    g.y += SCROLL * dt;
    g.flash = Math.max(0, g.flash - dt);
    if (!g.used && g.y >= SQUAD_Y) {
      const pick = state.squadX < MID ? g.pair.left : g.pair.right;
      g.pair.left.used = g.pair.right.used = true;
      pick.chosen = true;
      applyGate(pick);
    }
  }
  state.gates = state.gates.filter(g => g.y < 1100);

  // chests
  for (const c of state.crates) { c.y += SCROLL * dt; c.hit = Math.max(0, c.hit - dt); }
  state.crates = state.crates.filter(c => c.y < 1100 && c.hp > 0);

  // enemies run at the squad
  const cx = state.squadX;
  for (const e of state.enemies) {
    e.y += e.speed * dt;
    if (e.y > 300) e.x += clamp((cx - e.x) * 0.6, -50, 50) * dt;
    e.hit = Math.max(0, e.hit - dt);
    const dx = e.x - cx;
    const dy = e.y - SQUAD_Y;
    const rr = sr + e.r;
    if (e.hp > 0 && dx * dx + dy * dy < rr * rr) {
      e.hp = 0;
      state.squad = Math.max(0, state.squad - e.dmg);
      burst(e.x, e.y, e.brute ? '#4a6b30' : '#6fae45', 5, 140);
      burst(e.x, e.y + 6, '#2a5db0', 3 + e.dmg, 120);
      state.shake = Math.max(state.shake, e.brute ? 0.25 : 0.1);
    }
  }
  state.enemies = state.enemies.filter(e => e.hp > 0 && e.y < 1100);

  // the troll walks down, then crushes the squad until it dies
  const b = state.boss;
  if (b) {
    b.hit = Math.max(0, b.hit - dt);
    const stopY = SQUAD_Y - sr - b.r + 6;
    if (b.y < stopY) b.y = Math.min(stopY, b.y + b.speed * dt);
    b.x += clamp(cx - b.x, -40, 40) * dt;
    if (b.y >= stopY) {
      state.drainTimer += dt;
      while (state.drainTimer >= 0.25) {
        state.drainTimer -= 0.25;
        const lost = Math.min(state.squad, 2 + state.level);
        state.squad -= lost;
        burst(state.squadX, SQUAD_Y - 10, '#2a5db0', 4, 140);
        state.shake = 0.15;
      }
    }
    if (b.hp <= 0) {
      burst(b.x, b.y, '#7d93a6', 60, 320);
      burst(b.x, b.y, '#ffd84a', 40, 240);
      state.boss = null;
      for (const e of state.enemies) burst(e.x, e.y, '#6fae45', 3, 100);
      state.enemies.length = 0;
      const bonus = 5 + state.level * 2;
      state.squad = Math.min(state.squad + bonus, MAX_SQUAD);
      floater(MID, 420, 'VICTORY!', '#ffd84a', 46, 2.4, true);
      floater(state.squadX, SQUAD_Y - 100, '+' + bonus + ' recruits', '#9dffb0', 24, 2);
      state.mode = 'clear';
      state.modeTimer = 2.6;
      if (state.level > state.best) { state.best = state.level; saveBest(state.best); }
    }
  }

  if (state.squad <= 0 && state.mode === 'play') {
    state.squad = 0;
    state.mode = 'over';
    state.modeTimer = 0;
    burst(state.squadX, SQUAD_Y, '#2a5db0', 30, 200);
    const reached = state.level - 1;
    if (reached > state.best) { state.best = reached; saveBest(state.best); }
  }
}

function updateBullets(dt) {
  const enemies = state.enemies;
  const b = state.boss;
  for (const bl of state.bullets) {
    bl.y -= BULLET_SPEED * dt;
    bl.x += bl.vx * dt;
    if (bl.y < ARROW_END_Y) { bl.dead = true; continue; }

    // gates (+/- only; multipliers let arrows through)
    let done = false;
    for (const g of state.gates) {
      if (g.used || (g.op !== 'add' && g.op !== 'sub')) continue;
      if (bl.x >= g.x0 && bl.x <= g.x1 && Math.abs(bl.y - g.y) < g.h / 2) {
        hitGate(g, bl.dmg); bl.dead = true; done = true; break;
      }
    }
    if (done) continue;

    for (const c of state.crates) {
      const dx = bl.x - c.x, dy = bl.y - c.y;
      if (c.hp > 0 && Math.abs(dx) < c.r && Math.abs(dy) < c.r) {
        c.hp -= bl.dmg; c.hit = 0.06; bl.dead = true; done = true;
        if (c.hp <= 0) {
          burst(c.x, c.y, '#8a5a2b', 14, 220);
          burst(c.x, c.y, '#f4d35e', 10, 180);
          if (state.weapon < MAX_WEAPON) {
            state.weapon += 1;
            floaterWorld(c.x, c.y, 'BETTER BOWS!', '#ffd84a', 24, 1.4);
          } else {
            state.squad = Math.min(state.squad + 10, MAX_SQUAD);
            floaterWorld(c.x, c.y, '+10 recruits', '#9dffb0', 24, 1.2);
          }
        }
        break;
      }
    }
    if (done) continue;

    if (b && b.hp > 0) {
      const dx = bl.x - b.x, dy = bl.y - b.y;
      if (dx * dx + dy * dy < b.r * b.r) {
        b.hp -= bl.dmg; b.hit = 0.05; bl.dead = true;
        if (Math.random() < 0.3) burst(bl.x, bl.y, '#9ab0c2', 1, 120);
        continue;
      }
    }

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.hp <= 0) continue;
      const dy = bl.y - e.y;
      if (dy > e.r + 4 || dy < -e.r - 4) continue;
      const dx = bl.x - e.x;
      const rr = e.r + 3;
      if (dx * dx + dy * dy < rr * rr) {
        e.hp -= bl.dmg; e.hit = 0.06; bl.dead = true;
        if (e.hp <= 0) {
          state.kills += 1;
          burst(e.x, e.y, e.brute ? '#4a6b30' : '#6fae45', e.brute ? 10 : 5, 150);
        }
        break;
      }
    }
  }
  state.bullets = state.bullets.filter(bl => !bl.dead);
}

// ---- drawing ----------------------------------------------------------------
const drawList = [];

function draw() {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  if (state.shake > 0) ctx.translate(rand(-4, 4) * state.shake * 4, rand(-4, 4) * state.shake * 4);

  drawGround();
  drawShadows();

  // everything that stands on the ground, far to near
  drawList.length = 0;
  for (const t of state.trees) drawList.push(t.y, 0, t);
  for (const g of state.gates) drawList.push(g.y, 1, g);
  for (const c of state.crates) drawList.push(c.y, 2, c);
  for (const e of state.enemies) drawList.push(e.y, 3, e);
  if (state.boss) drawList.push(state.boss.y, 4, state.boss);
  if (state.squad > 0) {
    const vis = visibleCount();
    for (let i = 0; i < vis; i++) drawList.push(SQUAD_Y + FORMATION[i].y, 5, i);
  }
  const order = [];
  for (let i = 0; i < drawList.length; i += 3) order.push(i);
  order.sort((a, b) => drawList[a] - drawList[b]);
  for (const i of order) {
    const kind = drawList[i + 1];
    const o = drawList[i + 2];
    if (kind === 0) drawTree(o);
    else if (kind === 1) drawGate(o);
    else if (kind === 2) drawChestAt(o);
    else if (kind === 3) drawEnemy(o);
    else if (kind === 4) drawBoss(o);
    else drawSoldier(o);
  }

  drawArrows();
  drawParticles();
  drawFog();
  drawSquadBadge();
  drawBossBar();
  drawFloaters();

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawHud();
  if (state.mode === 'title') drawTitle();
  if (state.mode === 'over') drawGameOver();
}

function drawGround() {
  // mist colour behind everything (the far distance)
  ctx.fillStyle = '#c9d6d2';
  ctx.fillRect(-20, -20, W + 40, H + 40);
  // bands of grass and road, far to near, scrolling towards the camera
  const band = 80;
  const start = TREE_FAR - (TREE_FAR % (band * 2)) - band * 2 + state.scroll;
  let prevY = null;
  let k = 0;
  for (let y = start; y < 1180; y += band, k++) {
    const s0 = persp(y);
    const s1 = persp(y + band);
    const y0 = screenY(s0);
    const y1 = screenY(s1);
    if (y1 < 0) continue;
    const alt = (k & 1) === 0;
    ctx.fillStyle = alt ? '#4f8a3c' : '#4a8338';
    ctx.fillRect(-20, y0, W + 40, y1 - y0 + 1);
    ctx.fillStyle = alt ? '#a8835a' : '#9f7b53';
    ctx.beginPath();
    ctx.moveTo(screenX(ROAD_L, s0), y0);
    ctx.lineTo(screenX(ROAD_R, s0), y0);
    ctx.lineTo(screenX(ROAD_R, s1), y1 + 1);
    ctx.lineTo(screenX(ROAD_L, s1), y1 + 1);
    ctx.closePath();
    ctx.fill();
    prevY = y1;
  }
  // road edges (stones) and wheel ruts: straight lines towards the vanishing point
  const sNear = persp(1180);
  const yNear = screenY(sNear);
  const edge = (x, color, width) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(MID, HORIZON);
    ctx.lineTo(screenX(x, sNear), yNear);
    ctx.stroke();
  };
  edge(ROAD_L, '#6f5636', 7);
  edge(ROAD_R, '#6f5636', 7);
  edge(MID - 70, 'rgba(90,62,35,0.35)', 5);
  edge(MID + 70, 'rgba(90,62,35,0.35)', 5);
  edge(MID, 'rgba(255,240,200,0.18)', 3);
}

function drawShadows() {
  ctx.fillStyle = 'rgba(20,30,10,0.28)';
  ctx.beginPath();
  const add = (x, y, r) => {
    const s = persp(y);
    const px = screenX(x, s);
    const py = screenY(s);
    ctx.moveTo(px + r * s, py);
    ctx.ellipse(px, py, r * s, r * 0.32 * s, 0, 0, Math.PI * 2);
  };
  for (const e of state.enemies) add(e.x, e.y, e.r * 1.1);
  for (const c of state.crates) add(c.x, c.y, c.r);
  if (state.boss) add(state.boss.x, state.boss.y, 55);
  const vis = state.squad > 0 ? visibleCount() : 0;
  for (let i = 0; i < vis; i++) add(state.squadX + FORMATION[i].x, SQUAD_Y + FORMATION[i].y, 9);
  ctx.fill();
}

function drawTree(t) {
  if (t.y > 1150) return;
  const s = persp(t.y) * t.size;
  const spr = SPR.trees[t.kind];
  const px = screenX(t.x, persp(t.y));
  if (px < -spr.w * s || px > W + spr.w * s) return;
  drawSprite(spr, t.x, t.y, persp(t.y), t.size, t.mirror);
}

function drawGate(g) {
  const s = persp(g.y);
  const xa = screenX(g.x0 + 12, s);
  const xb = screenX(g.x1 - 12, s);
  const gy = screenY(s);
  const hgt = 100 * s;
  const good = gateIsGood(g);
  ctx.globalAlpha = g.used ? (g.chosen ? 0.35 : 0.15) : 1;
  // magic curtain
  ctx.fillStyle = g.flash > 0 ? 'rgba(255,255,255,0.55)'
    : good ? 'rgba(80,150,255,0.42)' : 'rgba(235,60,45,0.42)';
  ctx.fillRect(xa, gy - hgt, xb - xa, hgt);
  // wooden posts and beam
  const pw = 9 * s;
  ctx.fillStyle = '#6b4423';
  ctx.fillRect(xa - pw / 2, gy - hgt - 10 * s, pw, hgt + 10 * s);
  ctx.fillRect(xb - pw / 2, gy - hgt - 10 * s, pw, hgt + 10 * s);
  ctx.fillStyle = '#7d5230';
  ctx.fillRect(xa - 8 * s, gy - hgt - 14 * s, xb - xa + 16 * s, 11 * s);
  ctx.fillStyle = '#4a2e16';
  ctx.fillRect(xa - 8 * s, gy - hgt - 4 * s, xb - xa + 16 * s, 2 * s);
  // banner with the number
  const bw = (xb - xa) * 0.62;
  const bh = 46 * s;
  const bx = (xa + xb) / 2 - bw / 2;
  const by = gy - hgt - 4 * s;
  ctx.fillStyle = good ? '#1f4fa8' : '#a82020';
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx + bw, by);
  ctx.lineTo(bx + bw, by + bh);
  ctx.lineTo(bx + bw / 2, by + bh - 10 * s);
  ctx.lineTo(bx, by + bh);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#e0b030';
  ctx.lineWidth = Math.max(1, 2.5 * s);
  ctx.stroke();
  if (!g.used || g.chosen) {
    ctx.font = '900 ' + Math.round(30 * s) + 'px ' + FONT_TITLE;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff6d8';
    ctx.fillText(gateLabel(g), (xa + xb) / 2, by + bh * 0.42);
  }
  ctx.globalAlpha = 1;
}

function drawChestAt(c) {
  const s = persp(c.y);
  drawSprite(c.hit > 0 ? SPR.chestHit : SPR.chest, c.x, c.y, s, 1.1);
  const w = 44 * s;
  bar(screenX(c.x, s) - w / 2, screenY(s) - 46 * s, w, Math.max(2, 5 * s), c.hp / c.maxHp, '#ffd84a');
}

function drawEnemy(e) {
  if (e.y > 1150) return;
  const s = persp(e.y);
  const f = ((state.time * 7 + e.phase) | 0) & 1;
  if (e.brute) {
    drawSprite((e.hit > 0 ? SPR.orcHit : SPR.orc)[f], e.x, e.y, s, FIGURE_SCALE);
    if (e.hp < e.maxHp) {
      const w = 34 * s * FIGURE_SCALE;
      bar(screenX(e.x, s) - w / 2, screenY(s) - 50 * s * FIGURE_SCALE, w, Math.max(2, 4 * s), e.hp / e.maxHp, '#ff5a5a');
    }
  } else {
    drawSprite((e.hit > 0 ? SPR.goblinHit : SPR.goblin)[f], e.x, e.y, s, FIGURE_SCALE);
  }
}

function drawBoss(b) {
  const s = persp(b.y);
  const f = ((state.time * 3) | 0) & 1;
  drawSprite((b.hit > 0 ? SPR.trollHit : SPR.troll)[f], b.x, b.y, s, 1.2);
}

function drawSoldier(i) {
  const f = FORMATION[i];
  const y = SQUAD_Y + f.y;
  const s = persp(y);
  const fr = ((state.time * 8 + i * 0.37) | 0) & 1;
  drawSprite(SPR.archer[fr], state.squadX + f.x, y, s, FIGURE_SCALE);
}

function drawArrows() {
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#d9c39a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const bl of state.bullets) {
    const s0 = persp(bl.y);
    const s1 = persp(bl.y + 18);
    ctx.moveTo(screenX(bl.x, s0), screenY(s0) - 18 * s0);
    ctx.lineTo(screenX(bl.x - bl.vx * 0.02, s1), screenY(s1) - 18 * s1);
  }
  ctx.stroke();
  ctx.fillStyle = '#eef3f6';
  for (const bl of state.bullets) {
    const s0 = persp(bl.y);
    ctx.fillRect(screenX(bl.x, s0) - 1.2 * s0, screenY(s0) - 18 * s0 - 2 * s0, 2.4 * s0, 3 * s0);
  }
}

function drawParticles() {
  for (const p of state.particles) {
    const s = persp(p.y);
    ctx.globalAlpha = clamp(p.life / p.max * 1.5, 0, 1);
    ctx.fillStyle = p.color;
    const sz = p.size * s;
    ctx.fillRect(screenX(p.x, s) - sz / 2, screenY(s) - p.z * s - sz / 2, sz, sz);
  }
  ctx.globalAlpha = 1;
}

function drawFog() {
  const g = ctx.createLinearGradient(0, 0, 0, 330);
  g.addColorStop(0, 'rgba(201,214,210,1)');
  g.addColorStop(0.45, 'rgba(201,214,210,0.75)');
  g.addColorStop(1, 'rgba(201,214,210,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-20, -20, W + 40, 350);
}

function drawSquadBadge() {
  if (state.squad <= 0) return;
  const sr = squadRadius();
  const label = String(state.squad);
  ctx.font = 'bold 24px ' + FONT_UI;
  const w = Math.max(48, ctx.measureText(label).width + 24);
  const by = SQUAD_Y - sr - 56;
  const x = state.squadX;
  // shield-shaped badge
  ctx.fillStyle = '#1f3f7a';
  ctx.strokeStyle = '#e0b030';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, by - 16);
  ctx.lineTo(x + w / 2, by - 16);
  ctx.lineTo(x + w / 2, by + 8);
  ctx.lineTo(x, by + 20);
  ctx.lineTo(x - w / 2, by + 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, by - 2);
}

function drawBossBar() {
  const b = state.boss;
  if (!b) return;
  const s = persp(b.y);
  const px = screenX(b.x, s);
  const top = screenY(s) - 160 * s;
  const w = 150 * Math.max(s, 0.6);
  bar(px - w / 2, top - 14, w, 10, b.hp / b.maxHp, '#ff4a4a');
  ctx.font = 'bold 14px ' + FONT_UI;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeText(Math.ceil(b.hp), px, top - 26);
  ctx.fillText(Math.ceil(b.hp), px, top - 26);
}

function drawFloaters() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const f of state.floaters) {
    ctx.globalAlpha = clamp(f.life / (f.max * 0.4), 0, 1);
    ctx.font = (f.title ? '900 ' : 'bold ') + f.size + 'px ' + (f.title ? FONT_TITLE : FONT_UI);
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(30,18,8,0.75)';
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

function drawHud() {
  // dark wood bar
  ctx.fillStyle = 'rgba(52,32,16,0.88)';
  ctx.fillRect(0, 0, W, 54);
  ctx.fillStyle = '#e0b030';
  ctx.fillRect(0, 54, W, 2);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = '900 21px ' + FONT_TITLE;
  ctx.fillStyle = '#ffe9a8';
  ctx.fillText('LEVEL ' + state.level, 14, 28);
  ctx.textAlign = 'right';
  ctx.font = 'bold 20px ' + FONT_UI;
  ctx.fillStyle = '#ffd84a';
  ctx.fillText('🏹 ' + state.weapon, W - 14, 28);
  // march progress towards the troll
  const p = state.mode === 'title' ? 0 : clamp(state.levelTime / state.bossTime, 0, 1);
  bar(150, 22, 290, 12, p, '#9dd16b');
  ctx.font = '16px ' + FONT_UI;
  ctx.fillStyle = '#ff7a5a';
  ctx.textAlign = 'left';
  ctx.fillText('☠', 446, 29);
}

function drawParchment(x, y, w, h) {
  ctx.fillStyle = 'rgba(15,10,5,0.55)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#efdfb8';
  roundRect(x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = '#7a5230';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(122,82,48,0.4)';
  ctx.lineWidth = 2;
  roundRect(x + 10, y + 10, w - 20, h - 20, 10);
  ctx.stroke();
}

function drawLines(lines) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of lines) {
    if (!l.text) continue;
    ctx.font = (l.weight || '') + ' ' + l.size + 'px ' + (l.title ? FONT_TITLE : FONT_UI);
    ctx.fillStyle = l.color || '#3b2614';
    ctx.fillText(l.text, W / 2, l.y);
  }
}

function drawTitle() {
  const pulse = 0.55 + 0.45 * Math.sin(state.modeTimer * 4);
  drawParchment(40, 230, 460, 520);
  drawLines([
    { text: 'LANE FIGHTER', y: 300, size: 50, weight: '900', title: true, color: '#7a1f1f' },
    { text: 'Lead your archers up the forest road.', y: 370, size: 20 },
    { text: 'Pick the right gates to grow your squad,', y: 400, size: 20 },
    { text: 'shoot down the goblins, then slay the troll.', y: 430, size: 20 },
    { text: 'Arrows make a + or − gate better.', y: 478, size: 18, color: '#1f4fa8' },
    { text: 'Drag left / right (or ← →) to move', y: 520, size: 18, color: '#6b5a44' },
    { text: 'TAP TO MARCH', y: 620, size: 34, weight: '900', title: true, color: `rgba(122,31,31,${pulse})` },
    { text: state.best > 0 ? 'Best: level ' + state.best : '', y: 690, size: 18, color: '#6b5a44' },
  ]);
}

function drawGameOver() {
  const pulse = 0.55 + 0.45 * Math.sin(state.modeTimer * 4);
  drawParchment(40, 250, 460, 440);
  drawLines([
    { text: 'THE SQUAD HAS FALLEN', y: 320, size: 30, weight: '900', title: true, color: '#7a1f1f' },
    { text: 'You reached level ' + state.level, y: 390, size: 24 },
    { text: 'Goblins slain: ' + state.kills, y: 430, size: 20, color: '#6b5a44' },
    { text: 'Best: level ' + state.best + ' cleared', y: 465, size: 20, color: '#6b5a44' },
    { text: state.modeTimer > 0.8 ? 'TAP TO MARCH AGAIN' : '', y: 600, size: 28, weight: '900', title: true, color: `rgba(122,31,31,${pulse})` },
  ]);
}

function bar(x, y, w, h, p, color) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * clamp(p, 0, 1), h);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---- input ------------------------------------------------------------------
// The squad stands where perspective scale is 1, so screen x maps straight to world x.
function toLogicalX(clientX) {
  const rect = canvas.getBoundingClientRect();
  return (clientX - rect.left) / rect.width * W;
}

function tryStart() {
  if (state.mode === 'title') newGame();
  else if (state.mode === 'over' && state.modeTimer > 0.8) newGame();
}

// Drag-only steering: the squad moves by how far the finger/mouse travels while held down,
// from wherever the drag starts. A tap or click on its own never moves it.
let dragPointer = null, dragLastX = 0;
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  dragPointer = e.pointerId;
  dragLastX = toLogicalX(e.clientX);
  tryStart();
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerId !== dragPointer) return;
  const x = toLogicalX(e.clientX);
  const sr = squadRadius();
  state.targetX = clamp(state.targetX + (x - dragLastX), ROAD_L + sr, ROAD_R - sr);
  dragLastX = x;
});
const endDrag = e => { if (e.pointerId === dragPointer) dragPointer = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
window.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = true;
  else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = true;
  else if (e.key === ' ' || e.key === 'Enter') tryStart();
});
window.addEventListener('keyup', e => {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
  else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
});

// ---- main loop --------------------------------------------------------------
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  canvas.style.width = Math.floor(W * s) + 'px';
  canvas.style.height = Math.floor(H * s) + 'px';
  canvas.width = Math.round(W * s * dpr);
  canvas.height = Math.round(H * s * dpr);
  scale = s * dpr;
}
window.addEventListener('resize', resize);
resize();

// make sure the title font is fetched (canvas text alone does not trigger it)
if (document.fonts && document.fonts.load) {
  document.fonts.load("900 20px 'Cinzel'").catch(() => {});
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!window.__pause) update(dt); // window.__pause = true freezes the game for testing
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
