'use strict';

// ---------------------------------------------------------------------------
// Lane Fighter - basic version
// Steer your squad, pick gates to grow it, shoot down the horde and the boss.
// Everything is drawn with simple shapes on one canvas (no assets yet).
// ---------------------------------------------------------------------------

// Logical playfield size (portrait). The canvas is scaled to fit the window.
const W = 540;
const H = 960;
const ROAD_L = 50;
const ROAD_R = 490;
const MID = (ROAD_L + ROAD_R) / 2;
const SQUAD_Y = 800;          // where the squad stands
const SCROLL = 110;           // world scroll speed (px/s)
const BULLET_SPEED = 900;
const MAX_VISIBLE = 60;       // soldiers drawn; more are "in the blob" but not drawn
const FIRE_INTERVAL = 0.3;    // seconds between shots per visible soldier
const MAX_WEAPON = 6;
const MAX_SQUAD = 999;        // keeps multiplier gates from snowballing forever

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let scale = 1;

// ---- helpers --------------------------------------------------------------
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function loadBest() {
  try { return parseInt(localStorage.getItem('laneFighterBest') || '0', 10) || 0; }
  catch (e) { return 0; }
}
function saveBest(v) {
  try { localStorage.setItem('laneFighterBest', String(v)); } catch (e) { /* ignore */ }
}

// Sunflower layout: offsets for soldiers around the squad centre.
const FORMATION = [];
for (let i = 0; i < MAX_VISIBLE; i++) {
  const r = 7.5 * Math.sqrt(i);
  const a = i * 2.39996;
  FORMATION.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.8 });
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
  events: [],
  bossTime: 1,
  boss: null,
  levelTime: 0,
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

// ---- level script -----------------------------------------------------------
function buildLevel(L) {
  const ev = [];
  let t = 1.0;
  const segments = 4 + Math.min(L, 6);
  for (let i = 0; i < segments; i++) {
    ev.push({ t, kind: 'gates' });
    t += 3.2;
    if (i % 3 === 1) { ev.push({ t, kind: 'crate' }); t += 1.6; }
    ev.push({ t, kind: 'horde', size: Math.round(12 + L * 6 + i * 4) });
    t += 4.6;
  }
  ev.push({ t: t + 1.5, kind: 'boss' });
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
  floater(MID, 420, 'LEVEL ' + state.level, '#ffffff', 34, 1.6);
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
  const left = { pair, x0: ROAD_L, x1: MID, y: -60, h: 56, op: a.op, v: a.v, acc: 0, used: false, chosen: false, flash: 0 };
  const right = { pair, x0: MID, x1: ROAD_R, y: -60, h: 56, op: b.op, v: b.v, acc: 0, used: false, chosen: false, flash: 0 };
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
      x, y: -30 - row * 22 + rand(-4, 4), r, hp, maxHp: hp,
      speed: SCROLL + (brute ? 25 : 45) + rand(-8, 8),
      dmg: brute ? 5 : 1, brute, hit: 0,
    });
  }
}

function spawnCrate() {
  const hp = 25 + state.level * 20;
  state.crates.push({ x: rand(ROAD_L + 50, ROAD_R - 50), y: -40, r: 26, hp, maxHp: hp, hit: 0 });
}

function spawnBoss() {
  const L = state.level;
  const hp = Math.round(350 * L * Math.pow(1.35, L - 1));
  state.boss = { x: MID, y: -90, r: 64, hp, maxHp: hp, speed: 60, hit: 0 };
  floater(MID, 380, 'BOSS!', '#ff5a5a', 40, 1.4);
}

// ---- effects ----------------------------------------------------------------
function burst(x, y, color, n, speed) {
  for (let i = 0; i < n && state.particles.length < 500; i++) {
    const a = rand(0, Math.PI * 2);
    const s = rand(speed * 0.3, speed);
    state.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.6), max: 0.6, color, size: rand(2, 4) });
  }
}
function floater(x, y, text, color, size, life) {
  state.floaters.push({ x, y, text, color, size: size || 24, life: life || 1, max: life || 1 });
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
  floater(state.squadX, SQUAD_Y - 70, (diff >= 0 ? '+' : '') + diff, diff >= 0 ? '#7dffa0' : '#ff6b6b', 30, 1.1);
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
  state.scroll = (state.scroll + SCROLL * dt) % 80;

  // particles and floaters always animate
  for (const p of state.particles) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.life -= dt;
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
  const vis = visibleCount();
  if (vis > 0) {
    const dmg = soldierDps() * FIRE_INTERVAL * (state.squad / vis);
    state.fireAcc += dt * vis / FIRE_INTERVAL;
    while (state.fireAcc >= 1) {
      state.fireAcc -= 1;
      const f = FORMATION[randInt(0, vis - 1)];
      state.bullets.push({ x: state.squadX + f.x, y: SQUAD_Y + f.y - 10, dmg });
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
  state.gates = state.gates.filter(g => g.y < H + 80);

  // crates
  for (const c of state.crates) { c.y += SCROLL * dt; c.hit = Math.max(0, c.hit - dt); }
  state.crates = state.crates.filter(c => c.y < H + 60 && c.hp > 0);

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
      burst(e.x, e.y, '#ff5050', 5, 140);
      burst(e.x, e.y + 6, '#4aa8ff', 3 + e.dmg, 120);
      state.shake = Math.max(state.shake, e.brute ? 0.25 : 0.1);
    }
  }
  state.enemies = state.enemies.filter(e => e.hp > 0 && e.y < H + 40);

  // boss walks down, then crushes the squad until it dies
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
        burst(state.squadX, SQUAD_Y - 10, '#4aa8ff', 4, 140);
        state.shake = 0.15;
      }
    }
    if (b.hp <= 0) {
      burst(b.x, b.y, '#ff7a3a', 60, 320);
      burst(b.x, b.y, '#ffd84a', 40, 240);
      state.boss = null;
      for (const e of state.enemies) burst(e.x, e.y, '#ff5050', 3, 100);
      state.enemies.length = 0;
      const bonus = 5 + state.level * 2;
      state.squad = Math.min(state.squad + bonus, MAX_SQUAD);
      floater(MID, 420, 'LEVEL CLEAR!', '#ffd84a', 40, 2.4);
      floater(state.squadX, SQUAD_Y - 80, '+' + bonus + ' bonus', '#7dffa0', 24, 2);
      state.mode = 'clear';
      state.modeTimer = 2.6;
      if (state.level > state.best) { state.best = state.level; saveBest(state.best); }
    }
  }

  if (state.squad <= 0 && state.mode === 'play') {
    state.squad = 0;
    state.mode = 'over';
    state.modeTimer = 0;
    burst(state.squadX, SQUAD_Y, '#4aa8ff', 30, 200);
    const reached = state.level - 1;
    if (reached > state.best) { state.best = reached; saveBest(state.best); }
  }
}

function updateBullets(dt) {
  const enemies = state.enemies;
  const b = state.boss;
  for (const bl of state.bullets) {
    bl.y -= BULLET_SPEED * dt;
    if (bl.y < -20) { bl.dead = true; continue; }

    // gates (+/- only; multipliers let bullets through)
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
          burst(c.x, c.y, '#c58a4a', 18, 220);
          if (state.weapon < MAX_WEAPON) {
            state.weapon += 1;
            floater(c.x, c.y, 'FIRE POWER UP', '#ffd84a', 24, 1.4);
          } else {
            state.squad = Math.min(state.squad + 10, MAX_SQUAD);
            floater(c.x, c.y, '+10', '#7dffa0', 26, 1.2);
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
        if (Math.random() < 0.3) burst(bl.x, bl.y, '#ffb070', 1, 120);
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
          burst(e.x, e.y, e.brute ? '#b05cff' : '#ff5050', e.brute ? 10 : 5, 150);
        }
        break;
      }
    }
  }
  state.bullets = state.bullets.filter(bl => !bl.dead);
}

// ---- drawing ----------------------------------------------------------------
function draw() {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  if (state.shake > 0) ctx.translate(rand(-4, 4) * state.shake * 4, rand(-4, 4) * state.shake * 4);

  // ground and road
  ctx.fillStyle = '#2f6b3a';
  ctx.fillRect(-20, -20, W + 40, H + 40);
  ctx.fillStyle = '#3a3f4b';
  ctx.fillRect(ROAD_L, -20, ROAD_R - ROAD_L, H + 40);
  ctx.fillStyle = '#e9e9e9';
  ctx.fillRect(ROAD_L - 6, -20, 6, H + 40);
  ctx.fillRect(ROAD_R, -20, 6, H + 40);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let y = -80 + state.scroll; y < H; y += 80) ctx.fillRect(MID - 3, y, 6, 44);

  drawGates();
  drawCrates();
  drawEnemies();
  drawBoss();
  drawSquad();

  // bullets
  ctx.strokeStyle = '#ffe36b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const bl of state.bullets) { ctx.moveTo(bl.x, bl.y); ctx.lineTo(bl.x, bl.y + 10); }
  ctx.stroke();

  // particles
  for (const p of state.particles) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  // floaters
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const f of state.floaters) {
    ctx.globalAlpha = clamp(f.life / (f.max * 0.4), 0, 1);
    ctx.font = 'bold ' + f.size + 'px system-ui, sans-serif';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawHud();
  if (state.mode === 'title') drawTitle();
  if (state.mode === 'over') drawGameOver();
}

function drawGates() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const g of state.gates) {
    const good = gateIsGood(g);
    const alpha = g.used ? (g.chosen ? 0.25 : 0.12) : 0.55;
    ctx.fillStyle = good ? `rgba(60,150,255,${alpha})` : `rgba(255,70,70,${alpha})`;
    if (g.flash > 0) ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(g.x0 + 4, g.y - g.h / 2, g.x1 - g.x0 - 8, g.h);
    ctx.strokeStyle = good ? '#9fd0ff' : '#ffb0b0';
    ctx.lineWidth = 3;
    ctx.strokeRect(g.x0 + 4, g.y - g.h / 2, g.x1 - g.x0 - 8, g.h);
    if (!g.used || g.chosen) {
      ctx.font = 'bold 34px system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(gateLabel(g), (g.x0 + g.x1) / 2, g.y + 1);
    }
  }
}

function drawCrates() {
  for (const c of state.crates) {
    ctx.fillStyle = c.hit > 0 ? '#ffffff' : '#a8692f';
    ctx.fillRect(c.x - c.r, c.y - c.r, c.r * 2, c.r * 2);
    ctx.strokeStyle = '#5a3412';
    ctx.lineWidth = 3;
    ctx.strokeRect(c.x - c.r, c.y - c.r, c.r * 2, c.r * 2);
    ctx.beginPath();
    ctx.moveTo(c.x - c.r, c.y - c.r); ctx.lineTo(c.x + c.r, c.y + c.r);
    ctx.moveTo(c.x + c.r, c.y - c.r); ctx.lineTo(c.x - c.r, c.y + c.r);
    ctx.stroke();
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillStyle = '#ffd84a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚡', c.x, c.y + 1);
    bar(c.x - c.r, c.y - c.r - 10, c.r * 2, 5, c.hp / c.maxHp, '#ffd84a');
  }
}

function drawEnemies() {
  for (const e of state.enemies) {
    ctx.fillStyle = e.hit > 0 ? '#ffffff' : (e.brute ? '#8a3fd1' : '#d93a3a');
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = e.brute ? '#5d2397' : '#8f1f1f';
    ctx.beginPath();
    ctx.arc(e.x, e.y + e.r * 0.25, e.r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    if (e.brute && e.hp < e.maxHp) bar(e.x - 16, e.y - 24, 32, 4, e.hp / e.maxHp, '#ff5a5a');
  }
}

function drawBoss() {
  const b = state.boss;
  if (!b) return;
  ctx.fillStyle = b.hit > 0 ? '#ffd0d0' : '#7a1414';
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4a0a0a';
  ctx.beginPath();
  ctx.arc(b.x, b.y + 14, b.r * 0.6, 0, Math.PI * 2);
  ctx.fill();
  // eyes
  ctx.fillStyle = '#ffd84a';
  ctx.beginPath();
  ctx.arc(b.x - 20, b.y - 18, 8, 0, Math.PI * 2);
  ctx.arc(b.x + 20, b.y - 18, 8, 0, Math.PI * 2);
  ctx.fill();
  bar(b.x - 70, b.y - b.r - 22, 140, 10, b.hp / b.maxHp, '#ff4a4a');
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(Math.ceil(b.hp), b.x, b.y - b.r - 34);
}

function drawSquad() {
  if (state.squad <= 0) return;
  const vis = visibleCount();
  for (let i = vis - 1; i >= 0; i--) {
    const f = FORMATION[i];
    const x = state.squadX + f.x;
    const y = SQUAD_Y + f.y;
    ctx.fillStyle = '#1f5fb8';
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7cc4ff';
    ctx.beginPath();
    ctx.arc(x, y - 3, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // count bubble
  const sr = squadRadius();
  const label = String(state.squad);
  ctx.font = 'bold 24px system-ui, sans-serif';
  const w = Math.max(44, ctx.measureText(label).width + 20);
  const by = SQUAD_Y - sr - 26;
  ctx.fillStyle = 'rgba(15,40,90,0.85)';
  roundRect(state.squadX - w / 2, by - 16, w, 32, 10);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, state.squadX, by + 1);
}

function drawHud() {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, W, 54);
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('LEVEL ' + state.level, 14, 27);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffd84a';
  ctx.fillText('⚡ ' + state.weapon, W - 14, 27);
  // progress to boss
  const p = state.mode === 'title' ? 0 : clamp(state.levelTime / state.bossTime, 0, 1);
  bar(140, 21, 300, 12, p, '#7dffa0');
  ctx.font = '16px system-ui, sans-serif';
  ctx.fillStyle = '#ff7070';
  ctx.textAlign = 'left';
  ctx.fillText('☠', 446, 28);
}

function drawPanel(lines) {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of lines) {
    ctx.font = (l.bold ? 'bold ' : '') + l.size + 'px system-ui, sans-serif';
    ctx.fillStyle = l.color || '#ffffff';
    ctx.fillText(l.text, W / 2, l.y);
  }
}

function drawTitle() {
  const pulse = 0.6 + 0.4 * Math.sin(state.modeTimer * 4);
  drawPanel([
    { text: 'LANE FIGHTER', y: 300, size: 56, bold: true, color: '#ffd84a' },
    { text: 'Steer your squad. Pick the right gates.', y: 390, size: 22 },
    { text: 'Shoot the horde, then beat the boss.', y: 422, size: 22 },
    { text: 'Shooting a + or − gate makes it better.', y: 470, size: 19, color: '#9fd0ff' },
    { text: 'Mouse / drag / ← → to move', y: 540, size: 20, color: '#cccccc' },
    { text: 'TAP TO START', y: 660, size: 34, bold: true, color: `rgba(125,255,160,${pulse})` },
    { text: state.best > 0 ? 'Best: level ' + state.best : '', y: 730, size: 20, color: '#cccccc' },
  ]);
}

function drawGameOver() {
  const pulse = 0.6 + 0.4 * Math.sin(state.modeTimer * 4);
  drawPanel([
    { text: 'SQUAD LOST', y: 320, size: 52, bold: true, color: '#ff6b6b' },
    { text: 'You reached level ' + state.level, y: 400, size: 26 },
    { text: 'Enemies defeated: ' + state.kills, y: 440, size: 22, color: '#cccccc' },
    { text: 'Best: level ' + state.best + ' cleared', y: 480, size: 22, color: '#cccccc' },
    { text: state.modeTimer > 0.8 ? 'TAP TO TRY AGAIN' : '', y: 620, size: 32, bold: true, color: `rgba(125,255,160,${pulse})` },
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
function toLogicalX(clientX) {
  const rect = canvas.getBoundingClientRect();
  return (clientX - rect.left) / rect.width * W;
}

function tryStart() {
  if (state.mode === 'title') newGame();
  else if (state.mode === 'over' && state.modeTimer > 0.8) newGame();
}

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  state.targetX = toLogicalX(e.clientX);
  tryStart();
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse' || e.buttons) state.targetX = toLogicalX(e.clientX);
});
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

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
