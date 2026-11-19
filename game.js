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
// Campaign progress: best stars (0-3) per level.
function loadStars() {
  try {
    const a = JSON.parse(localStorage.getItem('laneFighterStars') || '[]');
    return Array.isArray(a) ? a.map(v => clamp(v | 0, 0, 3)) : [];
  } catch (e) { return []; }
}
function saveStars(a) {
  try { localStorage.setItem('laneFighterStars', JSON.stringify(a)); } catch (e) { /* ignore */ }
}

// ---- campaign: hand-made challenge levels ----------------------------------------
// Each stretch: [horde size, left gate, right gate, extra]. Gates: '+8', '-5', 'x2', '/2';
// null = no gates. Extra 'c' = a treasure chest after the gates.
// hp = goblin health (orcs have 10x); tier = how hard the troll stomps, chests and gate upgrades.
// Stars: 1 for slaying the troll, +1 for each of the two goals.
// Tuned 19/11/2026 with an autopilot: perfect play wins every level; a player who picks
// the wrong gate 1 time in 5 wins most early levels and about half of levels 6, 8, 9, 10.
const CAMPAIGN = [
  { name: 'The Mill Road', tier: 1, hp: 2, start: 5, troll: 300,
    goals: [{ type: 'survivors', n: 70 }, { type: 'chests' }],
    stretches: [[6, '+5', '-2'], [10, 'x2', '+3', 'c'], [12, '+8', '-4'], [16, '-6', 'x2'], [18, '+10', '/2', 'c']] },
  { name: 'Count Carefully', tier: 2, hp: 3, start: 8, troll: 800,
    goals: [{ type: 'noRed' }, { type: 'survivors', n: 200 }],
    stretches: [[10, '+6', 'x2'], [14, '+12', 'x2', 'c'], [16, 'x2', '+30'], [20, '-8', '/2'], [22, '+20', 'x2'], [24, '+40', '-10']] },
  { name: 'Orc Patrol', tier: 3, hp: 4, start: 12, troll: 1500, brutes: 0.15,
    goals: [{ type: 'kills', n: 100 }, { type: 'survivors', n: 250 }],
    stretches: [[10, '+8', '-5'], [14, 'x2', '+10'], [18, '+15', '/2', 'c'], [22, 'x2', '-10'], [24, '+25', '+5'], [26, '-15', 'x2', 'c']] },
  { name: 'The Lesser Evil', tier: 3, hp: 4, start: 50, troll: 700,
    goals: [{ type: 'noRed' }, { type: 'survivors', n: 25 }],
    stretches: [[8, '-6', '/2'], [10, '-10', '-4'], [12, '/2', '-8', 'c'], [14, '-5', '-12'], [12, '-9', '/2']] },
  { name: 'Treasure Road', tier: 4, hp: 5, start: 15, troll: 2500,
    goals: [{ type: 'bows', n: 4 }, { type: 'survivors', n: 300 }],
    stretches: [[10, '+10', '-5', 'c'], [14, 'x2', '+8', 'c'], [18, '+20', '/2', 'c'], [20, '-10', 'x2', 'c'], [22, '+30', '-15', 'c'], [24, 'x2', '+40']] },
  { name: 'The Swarm', tier: 4, hp: 3.5, start: 25, troll: 2000, speed: 1.4,
    goals: [{ type: 'bitten', n: 3 }, { type: 'survivors', n: 250 }],
    stretches: [[25, '+15', '-8'], [40, 'x2', '+20'], [60, '+30', '/2', 'c'], [80, 'x2', '-20'], [100, '+40', '+10']] },
  { name: 'Few but Fierce', tier: 5, hp: 7, start: 60, weapon: 4, troll: 1700, brutes: 0.2,
    goals: [{ type: 'survivors', n: 50 }, { type: 'kills', n: 120 }],
    stretches: [[20, null], [25, '-10', '/2'], [30, null, null, 'c'], [30, '-15', '-20'], [35, null]] },
  { name: 'Crossroads', tier: 6, hp: 5, start: 25, troll: 7000,
    goals: [{ type: 'noRed' }, { type: 'survivors', n: 300 }],
    stretches: [[12, 'x3', '+10'], [16, '/2', 'x2'], [20, '+30', '-20', 'c'], [24, 'x2', '/2'], [30, '-60', '+25'], [34, '+40', '/2', 'c'], [36, '/2', '+60']] },
  { name: 'Goblin Night', tier: 7, hp: 6, start: 35, troll: 6000, speed: 1.2, brutes: 0.1,
    goals: [{ type: 'bitten', n: 30 }, { type: 'survivors', n: 300 }],
    stretches: [[16, '+15', '-10'], [24, 'x2', '+12'], [30, '+30', '/2', 'c'], [36, '-20', 'x2'], [40, '+40', '-30'], [44, '+50', '-30', 'c'], [48, '+60', '/2']] },
  { name: 'The Troll King', tier: 8, hp: 7, start: 50, troll: 22000,
    goals: [{ type: 'survivors', n: 600 }, { type: 'chests' }],
    stretches: [[12, '+20', '-10'], [24, 'x2', '+15', 'c'], [30, '+30', '/2'], [36, '-25', 'x2'], [40, '+90', '-50', 'c'], [44, '+60', '-30'], [48, '/2', '+80'], [52, '+80', '-40', 'c'], [56, '+120', '-60']] },
];

// Goals: what they say, a short live label for the play screen, and whether they are met.
// r = { squad, red, chests, chestsTotal, weapon, kills, bitten }
const GOALS = {
  survivors: { text: g => 'Finish with ' + g.n + '+ archers', chip: (g, r) => 'Archers ' + r.squad + '/' + g.n,
    ok: (g, r) => r.squad >= g.n, lost: () => false },
  noRed: { text: () => 'Never walk through a red gate', chip: () => 'No red gates',
    ok: (g, r) => r.red === 0, lost: (g, r) => r.red > 0 },
  chests: { text: () => 'Break every chest', chip: (g, r) => 'Chests ' + r.chests + '/' + r.chestsTotal,
    ok: (g, r) => r.chests >= r.chestsTotal, lost: () => false },
  bows: { text: g => 'Reach bows level ' + g.n, chip: (g, r) => 'Bows ' + r.weapon + '/' + g.n,
    ok: (g, r) => r.weapon >= g.n, lost: () => false },
  kills: { text: g => 'Slay ' + g.n + '+ foes', chip: (g, r) => 'Slain ' + r.kills + '/' + g.n,
    ok: (g, r) => r.kills >= g.n, lost: () => false },
  bitten: { text: g => 'Let no more than ' + g.n + ' foes reach you', chip: (g, r) => 'Reached you ' + r.bitten + '/' + g.n,
    ok: (g, r) => r.bitten <= g.n, lost: (g, r) => r.bitten > g.n },
};

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
  mode: 'title',          // title | map | brief | play | clear | over | result
  run: 'endless',         // campaign | endless
  campIdx: 0,             // campaign level being played (0-based)
  spec: null,             // campaign level data, or null in endless
  stars: loadStars(),
  stats: { red: 0, chests: 0, chestsTotal: 0, bitten: 0 },
  result: null,           // campaign result screen data
  paused: false,
  level: 1,               // enemy strength tier; also the wave number in endless
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
// Each stretch: a horde, then a pair of gates behind it. Arrows hit whatever
// is nearest, so you shoot through the horde first, then improve the gate.
const STRETCH = 7.8;          // seconds per stretch
const STRETCH_CHEST = 9.2;    // a stretch with a chest is a bit longer

// Endless: random stretches that get harder every wave.
// Balance (tuned 19/11/2026 with an autopilot): each horde is sized against the squad a
// good player is expected to have by that wave, and the share of it that the squad
// can't shoot down in time grows every wave. Perfect play reaches about wave 14,
// a player who picks the wrong gate 1 time in 5 about wave 8, random play wave 2.
const ENDLESS = {
  pressure0: 0.2,     // horde strength vs the expected squad's firepower, wave 1
  pressureStep: 0.08, // added every wave
  squadStep: 110,     // expected squad growth per wave (good play)
  window: 4,          // seconds of shooting a horde gets before it arrives
};
function expectedSquad(L) { return Math.min(MAX_SQUAD, 15 + ENDLESS.squadStep * (L - 1)); }
function expectedBows(L) { return 1 + 0.35 * (Math.min(MAX_WEAPON, 1 + 0.8 * (L - 1)) - 1); }
function expectedFire(L) { return expectedSquad(L) * 1.5 * expectedBows(L); }

function buildEndlessLevel(L) {
  const ev = [];
  let t = 1.0;
  const segments = 4 + Math.min(L, 6);
  for (let i = 0; i < segments; i++) {
    ev.push({ t, kind: 'horde', stretch: i });
    ev.push({ t: t + 1.2, kind: 'gates' });
    if (i % 3 === 1) ev.push({ t: t + 2.6, kind: 'crate' });
    t += i % 3 === 1 ? STRETCH_CHEST : STRETCH;
  }
  return finishScript(ev, t);
}

// Campaign: the stretches written in CAMPAIGN.
function buildCampaignLevel(spec) {
  const ev = [];
  let t = 1.0;
  for (const [n, a, b, extra] of spec.stretches) {
    if (n) ev.push({ t, kind: 'horde', size: n });
    if (a) ev.push({ t: t + 1.2, kind: 'gates', a, b });
    if (extra === 'c') { ev.push({ t: t + 2.6, kind: 'crate' }); state.stats.chestsTotal += 1; }
    t += extra === 'c' ? STRETCH_CHEST : STRETCH;
  }
  return finishScript(ev, t);
}

function finishScript(ev, t) {
  ev.push({ t: t + 1.5, kind: 'boss' });
  ev.sort((a, b) => a.t - b.t);
  state.bossTime = t + 1.5;
  return ev;
}

function resetField() {
  state.levelTime = 0;
  state.enemies.length = 0;
  state.bullets.length = 0;
  state.gates.length = 0;
  state.crates.length = 0;
  state.boss = null;
  state.paused = false;
}

function startLevel() {
  resetField();
  state.mode = 'play';
  if (state.run === 'campaign') {
    state.events = buildCampaignLevel(state.spec);
    floater(MID, 410, 'LEVEL ' + (state.campIdx + 1), '#fff2c8', 38, 1.8, true);
    floater(MID, 456, state.spec.name, '#ffe9a8', 26, 1.8, true);
  } else {
    state.events = buildEndlessLevel(state.level);
    floater(MID, 430, 'WAVE ' + state.level, '#fff2c8', 38, 1.6, true);
  }
}

function freshRun(squad, weapon) {
  state.squad = squad;
  state.weapon = weapon;
  state.kills = 0;
  state.stats = { red: 0, chests: 0, chestsTotal: 0, bitten: 0 };
  state.squadX = state.targetX = MID;
  state.particles.length = 0;
  state.floaters.length = 0;
}

function startEndless() {
  state.run = 'endless';
  state.spec = null;
  state.level = 1;
  freshRun(5, 1);
  startLevel();
}

function startCampaign(i) {
  const spec = CAMPAIGN[i];
  state.run = 'campaign';
  state.campIdx = i;
  state.spec = spec;
  state.level = spec.tier;
  freshRun(spec.start, spec.weapon || 1);
  startLevel();
}

// ---- spawning ---------------------------------------------------------------
// Random gates (endless). Multipliers only show up while the squad is still small
// for the wave, so they help you catch up instead of snowballing.
function randGood(L) {
  const mulChance = state.squad < 25 + 20 * L ? Math.max(0.1, 0.3 - 0.03 * (L - 1)) : 0;
  if (Math.random() < mulChance) return { op: 'mul', v: 2 };
  return { op: 'add', v: randInt(2 + L, 5 + 2 * L) };
}
function randBad(L) {
  const r = Math.random();
  if (r < 0.65) return { op: 'sub', v: randInt(4 + 3 * L, 8 + 6 * L) };
  if (r < 0.9) return { op: 'div', v: 2 };
  return { op: 'add', v: randInt(1, 3) };
}
const GATE_OPS = { '+': 'add', '-': 'sub', 'x': 'mul', '/': 'div' };
function parseGate(s) { return { op: GATE_OPS[s[0]], v: parseInt(s.slice(1), 10) }; }

function spawnGates(sa, sb) {
  const L = state.level;
  let a, b;
  if (sa) {
    a = parseGate(sa);
    b = parseGate(sb);
  } else {
    a = randGood(L);
    b = Math.random() < Math.min(0.85, 0.6 + 0.03 * L) ? randBad(L) : randGood(L);
    if (Math.random() < 0.5) { const t = a; a = b; b = t; }
  }
  const pair = {};
  const left = { pair, x0: ROAD_L, x1: MID, y: SPAWN_Y, h: 56, op: a.op, v: a.v, acc: 0, used: false, chosen: false, flash: 0 };
  const right = { pair, x0: MID, x1: ROAD_R, y: SPAWN_Y, h: 56, op: b.op, v: b.v, acc: 0, used: false, chosen: false, flash: 0 };
  pair.left = left; pair.right = right;
  state.gates.push(left, right);
}

function bruteShare() {
  if (state.spec && state.spec.brutes !== undefined) return state.spec.brutes;
  const L = state.level;
  return L >= 3 ? Math.min(0.05 * (L - 2), 0.25) : 0;
}

function spawnHorde(size, stretch) {
  const L = state.level;
  const share = bruteShare();
  const fast = (state.spec && state.spec.speed) || 1;
  let base = state.spec && state.spec.hp ? state.spec.hp : (1.5 + L * 0.8) * Math.pow(1.22, L - 1);
  if (stretch !== undefined) {
    // endless: size and health from the wave's pressure (see ENDLESS)
    size = Math.min(150, 12 + 6 * L + 4 * stretch);
    const pressure = ENDLESS.pressure0 + ENDLESS.pressureStep * (L - 1);
    const strength = pressure * expectedFire(L) * ENDLESS.window * (0.8 + 0.08 * stretch);
    base = Math.max(1, strength / (size * (1 + 9 * share)));
  }
  const cols = Math.ceil(Math.sqrt(size * 1.6));
  const width = cols * 20;
  const cx = rand(ROAD_L + width / 2 + 10, ROAD_R - width / 2 - 10) || MID;
  for (let i = 0; i < size; i++) {
    const brute = Math.random() < share;
    const r = brute ? 16 : 9;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = clamp(cx + (col - (cols - 1) / 2) * 20 + rand(-4, 4), ROAD_L + r, ROAD_R - r);
    const hp = (brute ? 10 : 1) * base;
    state.enemies.push({
      x, y: SPAWN_Y - row * 22 + rand(-4, 4), r, hp, maxHp: hp,
      speed: SCROLL + ((brute ? 25 : 45) + rand(-8, 8)) * fast,
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
  // endless: about (4 + 0.6 x wave) seconds of the expected squad's full fire
  const hp = state.spec ? state.spec.troll : Math.round((4 + 0.6 * L) * expectedFire(L));
  state.boss = { x: MID, y: SPAWN_Y - 60, r: 64, hp, maxHp: hp, speed: 80, hit: 0 };
  floater(MID, 380, 'THE TROLL COMES!', '#ff6b4a', 34, 1.6, true);
}

// ---- campaign results -------------------------------------------------------------
function goalRecord() {
  return {
    squad: state.squad, weapon: state.weapon, kills: state.kills,
    red: state.stats.red, chests: state.stats.chests, chestsTotal: state.stats.chestsTotal, bitten: state.stats.bitten,
  };
}

function finishCampaign(won) {
  const spec = state.spec;
  const r = goalRecord();
  const goals = spec.goals.map(g => ({ text: GOALS[g.type].text(g), ok: won && GOALS[g.type].ok(g, r) }));
  const stars = won ? 1 + goals.filter(g => g.ok).length : 0;
  const prev = state.stars[state.campIdx] || 0;
  if (stars > prev) {
    state.stars[state.campIdx] = stars;
    for (let i = 0; i < CAMPAIGN.length; i++) state.stars[i] = state.stars[i] || 0;
    saveStars(state.stars);
  }
  state.result = { won, stars, goals, newBest: stars > prev };
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
  if (!gateIsGood(g)) state.stats.red += 1;
  if (g.op === 'add') state.squad += g.v;
  else if (g.op === 'sub') state.squad = Math.max(0, state.squad - g.v);
  else if (g.op === 'mul') state.squad *= g.v;
  else state.squad = Math.ceil(state.squad / g.v);
  state.squad = Math.min(state.squad, MAX_SQUAD);
  const diff = state.squad - before;
  floater(state.squadX, SQUAD_Y - 90, (diff >= 0 ? '+' : '') + diff, diff >= 0 ? '#9dffb0' : '#ff7b6b', 32, 1.1);
  if (diff < 0) state.shake = 0.25;
}

// Shooting a +/- gate makes it better. Each step costs a bit more than the last, and a
// gate can improve by at most its own number + 5, so a huge squad can't turn every gate
// into a jackpot. In endless a bigger squad also pays more per step.
function gateThreshold(g) {
  const big = state.run === 'endless' ? 1 + state.squad / 60 : 1;
  return (8 + state.level * 4) * (1 + 0.15 * (g.steps || 0)) * big;
}
function hitGate(g, dmg) {
  g.acc += dmg;
  g.flash = 0.08;
  if (g.maxSteps === undefined) g.maxSteps = g.v + 5;
  let thr;
  while ((g.steps || 0) < g.maxSteps && g.acc >= (thr = gateThreshold(g))) {
    g.acc -= thr;
    g.steps = (g.steps || 0) + 1;
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
  if (state.paused) return;
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

  if (state.mode !== 'play' && state.mode !== 'clear') {
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
      if (state.run === 'campaign') {
        state.mode = 'result';
        state.modeTimer = 0;
      } else {
        state.level += 1;
        startLevel();
      }
    }
    return;
  }

  // level script
  state.levelTime += dt;
  while (state.events.length && state.events[0].t <= state.levelTime) {
    const e = state.events.shift();
    if (e.kind === 'gates') spawnGates(e.a, e.b);
    else if (e.kind === 'horde') spawnHorde(e.size, e.stretch);
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
      state.stats.bitten += 1;
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
      floater(MID, 420, 'VICTORY!', '#ffd84a', 46, 2.4, true);
      state.mode = 'clear';
      state.modeTimer = 2.6;
      if (state.run === 'campaign') {
        finishCampaign(true);
        state.modeTimer = 2.0;
      } else {
        const bonus = 5 + state.level * 2;
        state.squad = Math.min(state.squad + bonus, MAX_SQUAD);
        floater(state.squadX, SQUAD_Y - 100, '+' + bonus + ' recruits', '#9dffb0', 24, 2);
        if (state.level > state.best) { state.best = state.level; saveBest(state.best); }
      }
    }
  }

  if (state.squad <= 0 && state.mode === 'play') {
    state.squad = 0;
    state.modeTimer = 0;
    burst(state.squadX, SQUAD_Y, '#2a5db0', 30, 200);
    if (state.run === 'campaign') {
      finishCampaign(false);
      state.mode = 'result';
    } else {
      state.mode = 'over';
      const reached = state.level - 1;
      if (reached > state.best) { state.best = reached; saveBest(state.best); }
    }
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
          state.stats.chests += 1;
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
  buttons.length = 0;
  primary = null;
  const m = state.mode;
  if (m === 'play' || m === 'clear') {
    drawHud();
    if (state.run === 'campaign') drawGoalChips();
    if (state.paused) drawPause();
  }
  if (m === 'title') drawTitle();
  else if (m === 'map') drawMap();
  else if (m === 'brief') drawBrief();
  else if (m === 'over') drawGameOver();
  else if (m === 'result') drawResult();
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
  // pause button
  if (state.mode === 'play' && !state.paused) {
    button(6, 7, 42, 40, '', () => { state.paused = true; }, 'wood');
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(19, 17, 5, 20);
    ctx.fillRect(30, 17, 5, 20);
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = '900 20px ' + FONT_TITLE;
  ctx.fillStyle = '#ffe9a8';
  const label = state.run === 'campaign' ? 'LEVEL ' + (state.campIdx + 1) : 'WAVE ' + state.level;
  ctx.fillText(label, 58, 28);
  ctx.textAlign = 'right';
  ctx.font = 'bold 20px ' + FONT_UI;
  ctx.fillStyle = '#ffd84a';
  ctx.fillText('🏹 ' + state.weapon, W - 12, 28);
  // march progress towards the troll
  const p = clamp(state.levelTime / state.bossTime, 0, 1);
  bar(190, 22, 230, 12, p, '#9dd16b');
  ctx.font = '16px ' + FONT_UI;
  ctx.fillStyle = '#ff7a5a';
  ctx.textAlign = 'left';
  ctx.fillText('☠', 425, 29);
}

// Campaign goals, live, under the top bar: gold when met, red when lost for good.
function drawGoalChips() {
  const r = goalRecord();
  const chips = state.spec.goals.map(g => {
    const G = GOALS[g.type];
    return { text: G.chip(g, r), st: G.lost(g, r) ? 'lost' : G.ok(g, r) ? 'ok' : 'todo' };
  });
  ctx.font = 'bold 15px ' + FONT_UI;
  const widths = chips.map(c => ctx.measureText(c.text).width + 40);
  let x = W / 2 - (widths[0] + widths[1] + 10) / 2;
  chips.forEach((c, i) => {
    const w = widths[i];
    ctx.fillStyle = c.st === 'ok' ? 'rgba(120,90,10,0.85)' : c.st === 'lost' ? 'rgba(120,25,20,0.85)' : 'rgba(40,26,12,0.75)';
    roundRect(x, 64, w, 28, 14);
    ctx.fill();
    drawStar(x + 16, 78, 8, c.st === 'ok', c.st === 'lost' ? '#ff8a7a' : '#ffd84a');
    ctx.fillStyle = c.st === 'lost' ? '#ffc4bb' : '#fff2c8';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.text, x + 30, 79);
    x += w + 10;
  });
}

// ---- buttons (drawn on the canvas, registered each frame for taps) -----------------
const buttons = [];
let primary = null; // what Enter / Space does on the current screen

function button(x, y, w, h, label, action, style, size) {
  buttons.push({ x, y, w, h, action });
  if (style === 'wood') {
    ctx.fillStyle = '#5a3a1e';
    roundRect(x, y, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = '#e0b030';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    const main = style === 'main';
    ctx.fillStyle = main ? '#8a2323' : '#d9c49a';
    roundRect(x, y, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = main ? '#e0b030' : '#7a5230';
    ctx.lineWidth = 3;
    ctx.stroke();
    if (main) primary = primary || action;
  }
  if (label) {
    ctx.font = '900 ' + (size || 26) + 'px ' + FONT_TITLE;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = style === 'main' ? '#fff2c8' : '#3b2614';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  }
}

function drawStar(cx, cy, r, filled, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  if (filled) { ctx.fillStyle = color || '#ffd84a'; ctx.fill(); }
  ctx.strokeStyle = filled ? '#7a5210' : (color || 'rgba(90,60,30,0.6)');
  ctx.lineWidth = Math.max(1.2, r * 0.16);
  ctx.stroke();
}

function unlocked(i) { return i === 0 || (state.stars[i - 1] || 0) > 0; }
function totalStars() { return state.stars.reduce((a, b) => a + (b || 0), 0); }

function goToMap() {
  state.mode = 'map';
  state.modeTimer = 0;
  state.paused = false;
  resetField();
  state.squad = 0;
}
function goToTitle() {
  state.mode = 'title';
  state.modeTimer = 0;
  state.paused = false;
  resetField();
  state.squad = 0;
}
function openBrief(i) {
  state.campIdx = i;
  state.mode = 'brief';
  state.modeTimer = 0;
}

// Positions of the level stops on the campaign map, bottom (level 1) to top.
function mapNode(i) {
  const n = CAMPAIGN.length;
  const y = 790 - i * (580 / (n - 1));
  const x = MID + Math.sin(i * 1.15 + 0.4) * 140;
  return { x, y };
}

function drawMap() {
  drawParchment(24, 70, W - 48, H - 110);
  drawLines([
    { text: 'THE CAMPAIGN', y: 118, size: 34, weight: '900', title: true, color: '#7a1f1f' },
    { text: '★ ' + totalStars() + ' / ' + CAMPAIGN.length * 3, y: 156, size: 20, weight: 'bold', color: '#7a5210' },
  ]);
  button(W / 2 - 70, 856, 140, 46, 'Back', goToTitle, null, 20);
  // the winding road between the stops
  ctx.strokeStyle = 'rgba(122,82,48,0.55)';
  ctx.lineWidth = 6;
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  for (let i = 0; i < CAMPAIGN.length; i++) {
    const p = mapNode(i);
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  // first level not yet won pulses
  const next = CAMPAIGN.findIndex((_, i) => !(state.stars[i] > 0));
  const pulse = 0.5 + 0.5 * Math.sin(state.modeTimer * 4);
  for (let i = 0; i < CAMPAIGN.length; i++) {
    const p = mapNode(i);
    const open = unlocked(i);
    const st = state.stars[i] || 0;
    if (open) buttons.push({ x: p.x - 34, y: p.y - 34, w: 68, h: 68, action: () => openBrief(i) });
    if (i === next) {
      ctx.fillStyle = `rgba(224,176,48,${0.25 + 0.35 * pulse})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 36, 0, Math.PI * 2); ctx.fill();
      primary = primary || (() => openBrief(i));
    }
    ctx.fillStyle = !open ? '#9a8f7e' : st > 0 ? '#b8862a' : '#8a2323';
    ctx.beginPath(); ctx.arc(p.x, p.y, 27, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = open ? '#4a2e16' : '#6b6255';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.font = '900 24px ' + FONT_TITLE;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = open ? '#fff2c8' : '#d8d0c2';
    ctx.fillText(open ? String(i + 1) : '🔒', p.x, p.y + 1);
    if (open) for (let k = 0; k < 3; k++) drawStar(p.x - 20 + k * 20, p.y + 40, 8, k < st);
    // level name beside the stop, on the roomier side
    ctx.font = 'bold 15px ' + FONT_UI;
    ctx.fillStyle = open ? '#3b2614' : '#8a7f6e';
    const right = p.x < MID;
    ctx.textAlign = right ? 'left' : 'right';
    ctx.fillText(CAMPAIGN[i].name, p.x + (right ? 40 : -40), p.y);
  }
}

function drawBrief() {
  const i = state.campIdx;
  const spec = CAMPAIGN[i];
  const best = state.stars[i] || 0;
  drawParchment(40, 200, 460, 560);
  drawLines([
    { text: 'LEVEL ' + (i + 1), y: 252, size: 22, weight: 'bold', color: '#6b5a44' },
    { text: spec.name, y: 294, size: 36, weight: '900', title: true, color: '#7a1f1f' },
    { text: 'Start: ' + spec.start + ' archers' + (spec.weapon > 1 ? ', bows ' + spec.weapon : ''), y: 340, size: 18, color: '#6b5a44' },
  ]);
  const lines = ['Slay the troll'].concat(spec.goals.map(g => GOALS[g.type].text(g)));
  ctx.textBaseline = 'middle';
  lines.forEach((t, k) => {
    const y = 400 + k * 46;
    drawStar(92, y, 13, k < best);
    ctx.font = (k === 0 ? 'bold ' : '') + '20px ' + FONT_UI;
    ctx.fillStyle = '#3b2614';
    ctx.textAlign = 'left';
    ctx.fillText(t, 118, y + 1);
  });
  if (best > 0) drawLines([{ text: 'Your best: ' + best + ' of 3 stars', y: 552, size: 17, color: '#7a5210' }]);
  button(140, 590, 260, 70, 'MARCH!', () => startCampaign(i), 'main', 32);
  button(190, 676, 160, 48, 'Map', goToMap, null, 20);
}

function drawResult() {
  const res = state.result;
  const ready = state.modeTimer > 0.6;
  drawParchment(40, 190, 460, 590);
  drawLines([
    { text: res.won ? 'VICTORY!' : 'THE SQUAD HAS FALLEN', y: 250, size: res.won ? 44 : 30, weight: '900', title: true, color: res.won ? '#7a5210' : '#7a1f1f' },
    { text: 'Level ' + (state.campIdx + 1) + ': ' + state.spec.name, y: 296, size: 19, color: '#6b5a44' },
  ]);
  for (let k = 0; k < 3; k++) {
    // stars pop in one by one
    const shown = k < res.stars && state.modeTimer > 0.25 + k * 0.3;
    drawStar(W / 2 - 70 + k * 70, 360, 28, shown);
  }
  const lines = [{ text: 'Slay the troll', ok: res.won }].concat(res.goals);
  lines.forEach((l, k) => {
    const y = 432 + k * 40;
    ctx.font = 'bold 22px ' + FONT_UI;
    ctx.textAlign = 'center';
    ctx.fillStyle = l.ok ? '#2e7d32' : '#a82020';
    ctx.textBaseline = 'middle';
    ctx.fillText(l.ok ? '✔' : '✘', 86, y);
    ctx.font = '19px ' + FONT_UI;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#3b2614';
    ctx.fillText(l.text, 106, y + 1);
  });
  if (res.newBest && res.won) drawLines([{ text: 'New best!', y: 556, size: 18, weight: 'bold', color: '#7a5210' }]);
  if (!ready) return;
  const i = state.campIdx;
  const hasNext = res.won && i + 1 < CAMPAIGN.length;
  if (hasNext) {
    button(130, 590, 280, 66, 'NEXT LEVEL', () => openBrief(i + 1), 'main', 28);
    button(90, 676, 170, 50, 'Retry', () => startCampaign(i), null, 20);
  } else {
    button(130, 590, 280, 66, 'RETRY', () => startCampaign(i), 'main', 28);
    button(90, 676, 170, 50, res.won ? 'Retry' : 'Briefing', res.won ? () => startCampaign(i) : () => openBrief(i), null, 20);
  }
  button(280, 676, 170, 50, 'Map', goToMap, null, 20);
}

function drawPause() {
  drawParchment(90, 320, 360, 330);
  drawLines([{ text: 'PAUSED', y: 380, size: 40, weight: '900', title: true, color: '#7a1f1f' }]);
  button(140, 430, 260, 70, 'RESUME', () => { state.paused = false; }, 'main', 30);
  button(170, 530, 200, 56, 'Quit', state.run === 'campaign' ? goToMap : goToTitle, null, 22);
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
  drawParchment(40, 170, 460, 640);
  drawLines([
    { text: 'LANE FIGHTER', y: 240, size: 50, weight: '900', title: true, color: '#7a1f1f' },
    { text: 'Lead your archers up the forest road.', y: 306, size: 20 },
    { text: 'Pick the right gates to grow your squad,', y: 336, size: 20 },
    { text: 'shoot down the goblins, then slay the troll.', y: 366, size: 20 },
    { text: 'Arrows make a + or − gate better.', y: 410, size: 18, color: '#1f4fa8' },
    { text: 'Drag left / right (or ← →) to move', y: 446, size: 18, color: '#6b5a44' },
  ]);
  button(110, 490, 320, 74, 'CAMPAIGN', goToMap, 'main', 32);
  drawLines([{ text: '★ ' + totalStars() + ' / ' + CAMPAIGN.length * 3 + ' stars', y: 588, size: 17, color: '#7a5210' }]);
  button(110, 622, 320, 64, 'ENDLESS', startEndless, null, 28);
  drawLines([{ text: state.best > 0 ? 'Best: wave ' + state.best + ' cleared' : 'How far can you march?', y: 712, size: 17, color: '#6b5a44' }]);
}

function drawGameOver() {
  drawParchment(40, 250, 460, 470);
  drawLines([
    { text: 'THE SQUAD HAS FALLEN', y: 320, size: 30, weight: '900', title: true, color: '#7a1f1f' },
    { text: 'You reached wave ' + state.level, y: 390, size: 24 },
    { text: 'Foes slain: ' + state.kills, y: 430, size: 20, color: '#6b5a44' },
    { text: state.best > 0 ? 'Best: wave ' + state.best + ' cleared' : '', y: 465, size: 20, color: '#6b5a44' },
  ]);
  if (state.modeTimer < 0.8) return;
  button(110, 530, 320, 70, 'MARCH AGAIN', startEndless, 'main', 28);
  button(170, 620, 200, 54, 'Menu', goToTitle, null, 22);
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
function toLogicalY(clientY) {
  const rect = canvas.getBoundingClientRect();
  return (clientY - rect.top) / rect.height * H;
}

// A tap on a button runs it (newest first, so overlays win over what is under them).
function pressButton(x, y) {
  for (let i = buttons.length - 1; i >= 0; i--) {
    const b = buttons[i];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      buttons.length = 0; // one action per tap
      b.action();
      return true;
    }
  }
  return false;
}

// Drag-only steering: the squad moves by how far the finger/mouse travels while held down,
// from wherever the drag starts. A tap or click on its own never moves it.
let dragPointer = null, dragLastX = 0;
canvas.addEventListener('pointerdown', e => {
  if (pressButton(toLogicalX(e.clientX), toLogicalY(e.clientY))) return;
  if (state.mode !== 'play' && state.mode !== 'clear') return;
  if (state.paused) return;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not capturable: drag still works */ }
  dragPointer = e.pointerId;
  dragLastX = toLogicalX(e.clientX);
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
  else if (e.key === ' ' || e.key === 'Enter') { if (primary) { const p = primary; primary = null; p(); } }
  else if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
    if (state.mode === 'play') state.paused = !state.paused;
    else if (state.mode === 'brief') goToMap();
    else if (state.mode === 'map') goToTitle();
  }
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
