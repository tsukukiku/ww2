const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const overlay = document.querySelector("#overlay");
const startButton = document.querySelector("#startButton");
const leaderboardSelect = document.querySelector("#leaderboardSelect");
const scoreForm = document.querySelector("#scoreForm");
const pilotNameInput = document.querySelector("#pilotName");
const saveScoreButton = document.querySelector("#saveScoreButton");
const scoreMessage = document.querySelector("#scoreMessage");
const LEADERBOARD_KEY = "skyFront1944Leaderboard";
const LEADERBOARD_LIMIT = 10;

const hud = {
  score: document.querySelector("#score"),
  wave: document.querySelector("#wave"),
  lives: document.querySelector("#lives"),
  power: document.querySelector("#power")
};

const W = canvas.width;
const H = canvas.height;
const keys = new Set();
const touch = { left: false, right: false, fire: false };
const pointerAim = { active: false, fire: false, x: W / 2, y: H - 84, lastX: W / 2 };
const overlayTitle = overlay.querySelector(".title");

const ENEMY = {
  bf109: { hp: 11, score: 140, w: 42, h: 42 },
  bf110: { hp: 34, score: 340, w: 66, h: 48 },
  fw190: { hp: 15, score: 210, w: 46, h: 42 },
  v1: { hp: 999, score: 0, w: 22, h: 70 },
  v2: { hp: 999, score: 0, w: 24, h: 78 }
};

let state = makeState();
let lastTime = performance.now();
let animationId = 0;

function makeState() {
  return {
    running: false,
    paused: false,
    t: 0,
    scroll: 0,
    spawnTimer: 0.7,
    v1Timer: 6,
    phase: "skirmish",
    phaseTimer: 0,
    boss: null,
    cloudSeed: Array.from({ length: 62 }, (_, i) => ({
      x: (i * 151 + (i % 5) * 37) % W,
      y: (i * 229 + (i % 7) * 41) % H,
      r: 16 + (i * 19) % 68,
      speed: 14 + (i * 7) % 38,
      layer: i % 3,
      tone: i % 4,
      shape: i % 8
    })),
    landSeed: Array.from({ length: 20 }, (_, i) => ({
      x: (i * 97 + (i % 4) * 29) % W,
      y: (i * 173 + (i % 6) * 51) % H,
      w: 42 + (i * 37) % 130,
      h: 18 + (i * 23) % 58,
      tone: i % 5
    })),
    player: {
      x: W / 2,
      y: H - 84,
      w: 42,
      h: 54,
      speed: 315,
      cooldown: 0,
      invincible: 0,
      roll: 0,
      inputX: 0,
      destroyed: false
    },
    bullets: [],
    enemyBullets: [],
    rockets: [],
    enemies: [],
    warnings: [],
    flak: [],
    flakTimer: 2.2,
    particles: [],
    explosions: [],
    score: 0,
    scoreSubmitted: false,
    stage: 1,
    lives: 5,
    power: 1,
    kills: 0,
    killsToBoss: 14,
    gameOverTimer: null
  };
}

function startGame() {
  state = makeState();
  state.running = true;
  setPixelTitle("SKY FRONT 1944");
  startButton.textContent = "SORTIE";
  hideScoreForm();
  overlay.classList.add("hidden");
  lastTime = performance.now();
  cancelAnimationFrame(animationId);
  animationId = requestAnimationFrame(loop);
}

function endGame() {
  state.running = false;
  overlay.classList.remove("hidden");
  setPixelTitle("GAME OVER");
  showScoreForm();
  startButton.textContent = "FLY AGAIN";
}

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.033);
  lastTime = now;
  if (state.running && !state.paused) update(dt);
  draw();
  animationId = requestAnimationFrame(loop);
}

function update(dt) {
  state.t += dt;
  state.scroll += dt * 62;
  state.player.cooldown -= dt;
  state.player.invincible -= dt;

  if (state.gameOverTimer !== null) {
    state.gameOverTimer -= dt;
    if (state.gameOverTimer <= 0) endGame();
  }

  if (!state.player.destroyed) {
    updatePlayer(dt);
    updateSpawning(dt);
    updateFlak(dt);
  }
  updateWarnings(dt);
  updateBoss(dt);
  updateEnemies(dt);
  updateProjectiles(dt);
  updateFx(dt);
  if (!state.player.destroyed) handleCollisions();
  updateHud();
}

function updatePlayer(dt) {
  const p = state.player;
  if (pointerAim.active) {
    const targetX = clamp(pointerAim.x, 28, W - 28);
    const targetY = clamp(pointerAim.y, 48, H - 34);
    const dxp = targetX - p.x;
    const dyp = targetY - p.y;
    const maxMove = p.speed * 1.45 * dt;
    const dist = Math.hypot(dxp, dyp);
    if (dist <= maxMove || dist < 1) {
      p.x = targetX;
      p.y = targetY;
    } else {
      p.x += (dxp / dist) * maxMove;
      p.y += (dyp / dist) * maxMove;
    }
    p.inputX = clamp((p.x - pointerAim.lastX) / 18, -1, 1);
    pointerAim.lastX = p.x;
    p.roll += (p.inputX - p.roll) * Math.min(1, dt * 10);
    if (pointerAim.fire) firePlayer();
    return;
  }

  let dx = 0;
  let dy = 0;
  if (keys.has("arrowleft") || keys.has("a") || touch.left) dx -= 1;
  if (keys.has("arrowright") || keys.has("d") || touch.right) dx += 1;
  if (keys.has("arrowup") || keys.has("w")) dy -= 1;
  if (keys.has("arrowdown") || keys.has("s")) dy += 1;

  p.inputX = dx;
  p.roll += (dx - p.roll) * Math.min(1, dt * 10);
  const len = Math.hypot(dx, dy) || 1;
  p.x = clamp(p.x + (dx / len) * p.speed * dt, 28, W - 28);
  p.y = clamp(p.y + (dy / len) * p.speed * dt, 48, H - 34);

  if (keys.has(" ") || touch.fire) firePlayer();
}

function firePlayer() {
  const p = state.player;
  if (p.cooldown > 0) return;
  p.cooldown = 0.072;
  addPlayerBullet(p.x - 20, p.y - 16, -9);
  addPlayerBullet(p.x - 11, p.y - 24, -4);
  addPlayerBullet(p.x + 11, p.y - 24, 4);
  addPlayerBullet(p.x + 20, p.y - 16, 9);
}

function addPlayerBullet(x, y, vx) {
  state.bullets.push({ x, y, vx, vy: -590, r: 4, damage: 1.18 });
}

function updateSpawning(dt) {
  if (state.phase === "boss") return;

  if (state.phase === "retreat") {
    state.phaseTimer -= dt;
    if (state.phaseTimer <= 0 && state.enemies.length === 0) startBoss();
    return;
  }

  state.spawnTimer -= dt;
  state.v1Timer -= dt;

  if (state.kills >= state.killsToBoss) {
    state.phase = "retreat";
    state.phaseTimer = 2.2;
    return;
  }

  if (state.v1Timer <= 0) {
    state.v1Timer = 8 + Math.random() * 5;
    const count = Math.random() < 0.45 ? 2 + Math.floor(Math.random() * 2) : 1;
    const used = [];
    for (let i = 0; i < count; i += 1) {
      let x = 42 + Math.random() * (W - 84);
      for (let tries = 0; tries < 10 && used.some((u) => Math.abs(u - x) < 58); tries += 1) {
        x = 42 + Math.random() * (W - 84);
      }
      used.push(x);
      const kind = Math.random() < 0.35 ? "v2" : "v1";
      state.warnings.push({ kind, x, w: kind === "v2" ? 54 : 48, timer: 1.15 + i * 0.12, total: 1.15 });
    }
  }

  if (state.spawnTimer > 0) return;
  state.spawnTimer = Math.max(0.62, 1.18 - state.stage * 0.05);
  const roll = Math.random();
  if (roll < 0.5) spawnBf109();
  else if (roll < 0.78) spawnFw190();
  else spawnBf110();
}

function spawnBf109() {
  const spec = ENEMY.bf109;
  state.enemies.push({
    type: "bf109",
    x: 36 + Math.random() * (W - 72),
    y: -48,
    vx: 0,
    vy: 150 + state.stage * 6,
    w: spec.w,
    h: spec.h,
    hp: spec.hp,
    maxHp: spec.hp,
    shootTimer: 0.45,
    burst: 0,
    alive: true
  });
}

function spawnBf110() {
  const spec = ENEMY.bf110;
  state.enemies.push({
    type: "bf110",
    x: 46 + Math.random() * (W - 92),
    y: -52,
    vx: 0,
    vy: 58 + state.stage * 3,
    w: spec.w,
    h: spec.h,
    hp: spec.hp,
    maxHp: spec.hp,
    shootTimer: 1.0,
    burst: 0,
    burstTimer: 0,
    alive: true
  });
}

function spawnFw190() {
  const spec = ENEMY.fw190;
  state.enemies.push({
    type: "fw190",
    x: 36 + Math.random() * (W - 72),
    y: -48,
    vx: 0,
    vy: 165 + state.stage * 9,
    w: spec.w,
    h: spec.h,
    hp: spec.hp,
    maxHp: spec.hp,
    shootTimer: 0.7,
    alive: true
  });
}

function spawnVWeapon(kind, x) {
  const spec = ENEMY[kind];
  state.enemies.push({
    type: kind,
    x,
    y: H + 56,
    vx: 0,
    vy: kind === "v2" ? -450 : -320,
    w: spec.w,
    h: spec.h,
    hp: spec.hp,
    maxHp: spec.hp,
    alive: true,
    hazard: true
  });
}

function startBoss() {
  state.phase = "boss";
  state.enemyBullets.length = 0;
  state.rockets.length = 0;
  if (Math.random() < 0.5) {
    startJu288();
    return;
  }
  const me262Hp = (98 + state.stage * 18) * 3;
  state.boss = {
    kind: "me262",
    hp: me262Hp,
    maxHp: me262Hp,
    mode: "raid",
    timer: 0,
    raidsLeft: 5,
    shotTimer: 0.26,
    planes: []
  };
  setupBossRaid();
}

function startJu288() {
  const bodyHp = (260 + state.stage * 44) * 2;
  const engineHp = 70 + state.stage * 12;
  const gunMounts = [
    { x: -112, y: 72 }, { x: -70, y: 88 }, { x: -28, y: 96 }, { x: 28, y: 96 }, { x: 70, y: 88 }, { x: 112, y: 72 },
    { x: -44, y: 26 }, { x: 44, y: 26 }, { x: 0, y: 58 }
  ];
  state.boss = {
    kind: "ju288",
    x: W / 2,
    y: -175,
    mode: "enter",
    timer: 2.8,
    pathTime: 0,
    body: { hp: bodyHp, maxHp: bodyHp },
    engines: [-128, -72, 72, 128].map((offset) => ({ offset, hp: engineHp, maxHp: engineHp })),
    guns: gunMounts.map((mount) => ({
      ...mount,
      cooldown: 1.2 + Math.random() * 2.4,
      burst: 0,
      burstTimer: 0
    }))
  };
}

function setupBossRaid() {
  const boss = state.boss;
  boss.mode = "raid";
  boss.timer = 1.85;
  boss.shotTimer = 0.26;
  const side = Math.floor(Math.random() * 4);
  let sx = W / 2;
  let sy = -80;
  if (side === 1) {
    sx = -80;
    sy = 120 + Math.random() * 360;
  } else if (side === 2) {
    sx = W + 80;
    sy = 120 + Math.random() * 360;
  } else if (side === 3) {
    sx = 70 + Math.random() * (W - 140);
    sy = H + 80;
  }
  const angle = Math.atan2(state.player.y - sy, state.player.x - sx);
  const speed = 525 + state.stage * 18;
  boss.planes = [-44, 0, 44].map((offset) => ({
    x: sx + Math.cos(angle + Math.PI / 2) * offset,
    y: sy + Math.sin(angle + Math.PI / 2) * offset,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    angle
  }));
}

function setupBossHover() {
  const boss = state.boss;
  const fromLeft = Math.random() < 0.5;
  const startX = fromLeft ? -92 : W + 92;
  const targets = [
    { x: W / 2 - 58, y: 94 },
    { x: W / 2, y: 72 },
    { x: W / 2 + 58, y: 94 }
  ];
  boss.mode = "hoverEnter";
  boss.timer = 2.1;
  boss.shotTimer = 999;
  boss.planes = targets.map((target, index) => ({
    x: startX + (fromLeft ? -index * 42 : index * 42),
    y: target.y + 10 + index * 16,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    targetX: target.x,
    targetY: target.y
  }));
}

function updateBoss(dt) {
  const boss = state.boss;
  if (!boss) return;
  if (boss.kind === "ju288") {
    updateJu288(dt);
    return;
  }

  boss.timer -= dt;
  boss.shotTimer -= dt;
  let hoverEnterSettled = boss.mode === "hoverEnter";
  for (const plane of boss.planes) {
    if (boss.mode === "hoverEnter") {
      const dx = plane.targetX - plane.x;
      const dy = plane.targetY - plane.y;
      plane.x += dx * Math.min(1, dt * 2.4);
      plane.y += dy * Math.min(1, dt * 2.4);
      plane.angle = -Math.PI / 2;
      if (Math.hypot(dx, dy) > 3) hoverEnterSettled = false;
    } else if (boss.mode === "hover") {
      plane.x += Math.sin(state.t * 2.2 + plane.y) * 16 * dt;
      plane.y += Math.cos(state.t * 2 + plane.x) * 8 * dt;
    } else {
      plane.x += plane.vx * dt;
      plane.y += plane.vy * dt;
    }
    if (boss.hp < boss.maxHp * 0.5) trailSmoke(plane.x, plane.y, plane.angle + Math.PI, 0.6);
  }

  if (hoverEnterSettled) {
    boss.mode = "hover";
    boss.timer = 4.2;
    boss.shotTimer = 999;
  }

  if (boss.mode === "raid" && boss.shotTimer <= 0) {
    boss.shotTimer = 0.18;
    for (const plane of boss.planes) {
      fireBossForward(plane);
    }
  }

  if (boss.mode === "raid" && boss.timer <= 0) {
    boss.raidsLeft -= 1;
    if (boss.raidsLeft <= 0) setupBossHover();
    else setupBossRaid();
  } else if (boss.mode === "hover" && boss.timer <= 0) {
    boss.raidsLeft = 3;
    setupBossRaid();
  }
}

function fireBossForward(plane) {
  const bulletSpeed = 880;
  for (const offset of [-6, 6]) {
    state.enemyBullets.push({
      x: plane.x + Math.cos(plane.angle + Math.PI / 2) * offset,
      y: plane.y + Math.sin(plane.angle + Math.PI / 2) * offset,
      vx: Math.cos(plane.angle) * bulletSpeed + plane.vx * 0.25,
      vy: Math.sin(plane.angle) * bulletSpeed + plane.vy * 0.25,
      r: 8,
      damage: 2,
      color: "#ffcf5a",
      tracer: true,
      len: 28
    });
  }
}

function updateJu288(dt) {
  const boss = state.boss;
  boss.timer -= dt;

  if (boss.mode === "enter") {
    boss.y += 55 * dt;
    if (boss.y >= 126) {
      boss.y = 126;
      boss.mode = "loop";
      boss.pathTime = 0;
    }
  } else {
    boss.pathTime += dt * 0.58;
    boss.x = W / 2 + Math.sin(boss.pathTime) * 126;
    boss.y = 126 + Math.sin(boss.pathTime * 2) * 38;
  }

  if (boss.mode === "loop") {
    updateJu288Guns(dt);
  }

  if (boss.body.hp < boss.body.maxHp * 0.5 || boss.engines.some((e) => e.hp <= 0)) {
    for (const engine of boss.engines) {
      if (engine.hp <= 0 || Math.random() < 0.25) {
        trailSmoke(boss.x + engine.offset, boss.y + 24, Math.PI / 2, 1.2);
      }
    }
  }
}

function updateJu288Guns(dt) {
  const boss = state.boss;
  for (const gun of boss.guns) {
    gun.cooldown -= dt;
    gun.burstTimer -= dt;
    if (gun.cooldown <= 0 && gun.burst <= 0) {
      gun.burst = 2 + Math.floor(Math.random() * 2);
      gun.burstTimer = 0;
      gun.cooldown = 3.0 + Math.random() * 3.0;
    }
    if (gun.burst <= 0 || gun.burstTimer > 0) continue;
    gun.burst -= 1;
    gun.burstTimer = 0.055 + Math.random() * 0.045;
    fireJu288Gun(gun);
  }
}

function fireJu288Gun(gun) {
  const boss = state.boss;
  const x = boss.x + gun.x;
  const y = boss.y + gun.y;
  for (let i = 0; i < 1; i += 1) {
    const aim = Math.atan2(state.player.y - y, state.player.x - x);
    const spread = (Math.random() - 0.5) * 0.48;
    state.enemyBullets.push({
      x,
      y,
      vx: Math.cos(aim + spread) * 335,
      vy: Math.sin(aim + spread) * 335,
      r: 8,
      damage: 1,
      color: "#ffb45c",
      tracer: true,
      len: 26
    });
  }
}

function updateWarnings(dt) {
  for (const w of state.warnings) {
    w.timer -= dt;
    if (w.timer <= 0 && !w.done) {
      w.done = true;
      spawnVWeapon(w.kind, w.x);
    }
  }
  state.warnings = state.warnings.filter((w) => w.timer > -0.08);
}

function updateFlak(dt) {
  state.flakTimer -= dt;
  if (state.flakTimer <= 0) {
    state.flakTimer = 2.3 + Math.random() * 2.2;
    const count = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i += 1) {
      state.flak.push({
        x: 48 + Math.random() * (W - 96),
        y: 64 + Math.random() * (H - 210),
        r: 22 + Math.random() * 24,
        timer: 0.9 + Math.random() * 0.45,
        total: 1,
        exploded: false,
        hitWindow: 0
      });
    }
  }

  for (const f of state.flak) {
    f.timer -= dt;
    if (f.timer <= 0 && !f.exploded) {
      f.exploded = true;
      f.hitWindow = 0.24;
      flakBurst(f.x, f.y, f.r);
    }
    if (f.exploded) f.hitWindow -= dt;
  }
  state.flak = state.flak.filter((f) => !f.exploded || f.hitWindow > -0.35);
}

function updateEnemies(dt) {
  for (const e of state.enemies) {
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    if (e.type === "bf110") e.x += Math.sin(state.t * 2.1 + e.y * 0.02) * 18 * dt;
    if (e.hp < e.maxHp * 0.5 && e.type !== "v1" && e.type !== "v2") trailSmoke(e.x, e.y - Math.sign(e.vy) * e.h * 0.45, e.vy >= 0 ? -Math.PI / 2 : Math.PI / 2, 1);

    if (state.phase === "retreat" && e.type !== "v1") {
      e.vy += 55 * dt;
      continue;
    }

    if (e.type === "bf109") updateBf109(e, dt);
    if (e.type === "bf110") updateBf110(e, dt);
    if (e.type === "fw190") updateFw190(e, dt);
  }

  state.enemies = state.enemies.filter((e) => e.y < H + 100 && e.y > -130 && e.x > -120 && e.x < W + 120 && e.alive);
}

function updateBf109(e, dt) {
  e.shootTimer -= dt;
  if (e.shootTimer <= 0 && e.y > 20) {
    e.shootTimer = 1.05;
    for (const offset of [-22, 0, 22]) {
      state.enemyBullets.push({
        x: e.x + offset,
        y: e.y + 24,
        vx: 0,
        vy: 420,
        r: 8,
        damage: 1,
        color: offset === 0 ? "#ffcf5a" : "#e8674f",
        tracer: true,
        len: offset === 0 ? 24 : 19
      });
    }
  }
}

function updateBf110(e, dt) {
  e.shootTimer -= dt;
  e.burstTimer -= dt;
  const playerBehind = state.player.y > e.y + 10;
  if (!playerBehind) {
    e.burst = 0;
    return;
  }
  if (e.shootTimer <= 0 && e.burst <= 0 && e.y > 10) {
    e.shootTimer = 2.0;
    e.burst = 4;
    e.burstTimer = 0;
  }
  if (e.burst > 0 && e.burstTimer <= 0) {
    e.burst -= 1;
    e.burstTimer = 0.11;
    burstAtPlayer(e.x, e.y + 19, 270, 1, 4, false);
  }
}

function updateFw190(e, dt) {
  e.shootTimer -= dt;
  if (e.shootTimer <= 0 && !e.rocketFired && e.y > 24) {
    e.rocketFired = true;
    const aim = Math.atan2(state.player.y - e.y, state.player.x - e.x);
    for (const side of [-1, 1]) {
      const angle = aim + side * 0.08;
      state.rockets.push({
        x: e.x + side * 12,
        y: e.y + 18,
        vx: Math.cos(angle) * 145,
        vy: Math.sin(angle) * 145,
        ax: Math.cos(angle) * 390,
        ay: Math.sin(angle) * 390,
        angle,
        r: 8
      });
    }
  }
}

function burstAtPlayer(x, y, speed, damage, radius, highPower) {
  const aim = Math.atan2(state.player.y - y, state.player.x - x);
  const wobble = (Math.random() - 0.5) * 0.12;
  const tunedSpeed = speed * 1.12;
  state.enemyBullets.push({
    x,
    y,
    vx: Math.cos(aim + wobble) * tunedSpeed,
    vy: Math.sin(aim + wobble) * tunedSpeed,
    r: Math.max(radius, 8),
    damage,
    color: highPower ? "#ffcf5a" : "#ee7156",
    tracer: true,
    len: highPower ? 25 : 18
  });
}

function updateProjectiles(dt) {
  for (const b of state.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }
  for (const b of state.enemyBullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }
  for (const r of state.rockets) {
    r.vx += r.ax * dt;
    r.vy += r.ay * dt;
    r.x += r.vx * dt;
    r.y += r.vy * dt;
    r.angle = Math.atan2(r.vy, r.vx);
    trailSmoke(r.x - Math.cos(r.angle) * 10, r.y - Math.sin(r.angle) * 10, r.angle + Math.PI, 1.4);
  }
  state.bullets = state.bullets.filter((b) => b.y > -30 && b.x > -30 && b.x < W + 30);
  state.enemyBullets = state.enemyBullets.filter((b) => b.y > -40 && b.y < H + 40 && b.x > -40 && b.x < W + 40);
  state.rockets = state.rockets.filter((r) => r.y > -80 && r.y < H + 80 && r.x > -80 && r.x < W + 80);
}

function updateFx(dt) {
  for (const p of state.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    p.size += (p.grow || 0) * dt;
  }
  for (const e of state.explosions) {
    e.life += dt;
  }
  state.particles = state.particles.filter((p) => p.life > 0);
  state.explosions = state.explosions.filter((e) => e.life < e.total);
}

function handleCollisions() {
  for (const bullet of state.bullets) {
    let hit = false;
    for (const enemy of state.enemies) {
      if (enemy.type !== "v1" && enemy.type !== "v2" && rectCircle(enemy, bullet)) {
        enemy.hp -= bullet.damage;
        bullet.y = -100;
        hit = true;
        pixelSparks(bullet.x, bullet.y, "#fff4a5", 4);
        if (enemy.hp <= 0) killEnemy(enemy);
        break;
      }
    }
    if (!hit && state.boss) {
  if (state.boss.kind === "ju288") {
        if (hitJu288Part(bullet)) {
          bullet.y = -100;
          pixelSparks(bullet.x, bullet.y, "#fff4a5", 4);
          if (isJu288Defeated()) killBoss();
        }
      } else {
        for (const plane of state.boss.planes) {
          if (circleRect(bullet, { x: plane.x, y: plane.y, w: 54, h: 32 })) {
            state.boss.hp -= bullet.damage;
            bullet.y = -100;
            pixelSparks(bullet.x, bullet.y, "#fff4a5", 4);
            if (state.boss.hp <= 0) killBoss();
            break;
          }
        }
      }
    }
  }

  const p = state.player;
  if (p.invincible > 0) return;

  for (const f of state.flak) {
    if (f.exploded && f.hitWindow > 0 && Math.hypot(f.x - p.x, f.y - p.y) < f.r + 13) {
      damagePlayer(2);
      return;
    }
  }

  for (const b of state.enemyBullets) {
    if (Math.hypot(b.x - p.x, b.y - p.y) < b.r + 15) {
      b.y = H + 99;
      damagePlayer(b.damage || 1);
      return;
    }
  }
  for (const r of state.rockets) {
    if (Math.hypot(r.x - p.x, r.y - p.y) < r.r + 17) {
      instantKillPlayer();
      return;
    }
  }
  for (const e of state.enemies) {
    const instant = e.type === "v1" || e.type === "v2";
    if (Math.abs(e.x - p.x) < e.w * 0.38 + 15 && Math.abs(e.y - p.y) < e.h * 0.4 + 18) {
      if (instant) instantKillPlayer();
      else damagePlayer(1);
      e.alive = false;
      explosion(e.x, e.y, e.type === "bf110" ? 1.3 : 1);
      return;
    }
  }
  if (state.boss) {
    if (state.boss.kind === "ju288") {
      if (Math.abs(state.boss.x - p.x) < 142 && Math.abs(state.boss.y - p.y) < 88) {
        damagePlayer(2);
        return;
      }
    } else {
      for (const plane of state.boss.planes) {
        if (Math.abs(plane.x - p.x) < 38 && Math.abs(plane.y - p.y) < 28) {
          damagePlayer(2);
          return;
        }
      }
    }
  }
}

function hitJu288Part(bullet) {
  const boss = state.boss;
  for (const engine of boss.engines) {
    if (engine.hp > 0 && circleRect(bullet, { x: boss.x + engine.offset, y: boss.y - 2, w: 36, h: 42 })) {
      engine.hp -= bullet.damage;
      return true;
    }
  }
  if (circleRect(bullet, { x: boss.x, y: boss.y, w: 94, h: 150 })) {
    boss.body.hp -= bullet.damage;
    return true;
  }
  if (circleRect(bullet, { x: boss.x, y: boss.y - 6, w: 292, h: 52 })) {
    boss.body.hp -= bullet.damage * 0.35;
    return true;
  }
  return false;
}

function isJu288Defeated() {
  const boss = state.boss;
  return boss.body.hp <= 0 || boss.engines.every((engine) => engine.hp <= 0);
}

function killEnemy(enemy) {
  enemy.alive = false;
  state.kills += 1;
  state.score += ENEMY[enemy.type].score;
  explosion(enemy.x, enemy.y, enemy.type === "bf110" ? 1.35 : 1);
}

function killBoss() {
  const boss = state.boss;
  if (boss.kind === "ju288") {
    for (let i = 0; i < 14; i += 1) {
      const x = boss.x + (Math.random() - 0.5) * 230;
      const y = boss.y + (Math.random() - 0.5) * 130;
      explosion(x, y, 1.2 + Math.random() * 1.4);
    }
    state.score += 2600 + state.stage * 520;
  } else {
    for (const plane of boss.planes) explosion(plane.x, plane.y, 1.4);
    state.score += 1800 + state.stage * 400;
  }
  state.stage += 1;
  state.kills = 0;
  state.killsToBoss = 14 + state.stage * 3;
  state.phase = "skirmish";
  state.spawnTimer = 3;
  state.boss = null;
}

function damagePlayer(amount) {
  state.lives -= amount;
  state.player.invincible = 1.7;
  explosion(state.player.x, state.player.y, 1.2);
  if (state.lives <= 0) destroyPlayer();
}

function instantKillPlayer() {
  state.lives = 0;
  destroyPlayer();
}

function destroyPlayer() {
  if (state.player.destroyed) return;
  state.player.destroyed = true;
  state.player.invincible = 99;
  state.gameOverTimer = 1.45;
  state.enemyBullets.length = 0;
  state.rockets.length = 0;
  playerBreakup(state.player.x, state.player.y);
}

function draw() {
  ctx.imageSmoothingEnabled = false;
  drawBackground();
  drawFlakWarnings();
  drawWarnings();
  drawBullets();
  drawEnemies();
  drawBoss();
  drawPlayer();
  drawFx();
  drawPhaseText();
  if (state.paused) drawBanner("PAUSED");
}

function drawBackground() {
  const skyBands = [
    ["#9bd6ff", 0, 80],
    ["#8fcef7", 80, 170],
    ["#7fc1ed", 170, 285],
    ["#70b5e4", 285, 430],
    ["#65aad9", 430, 720]
  ];
  for (const [color, y, h] of skyBands) {
    ctx.fillStyle = color;
    ctx.fillRect(0, y, W, h);
  }

  for (let i = 0; i < 16; i += 1) {
    const yy = Math.floor((i * 53 + state.scroll * (0.055 + (i % 4) * 0.012)) % (H + 70) - 35);
    const alpha = 0.035 + (i % 5) * 0.008;
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.fillRect(0, yy, W, 2 + (i % 3));
    ctx.fillStyle = `rgba(67, 119, 160, ${alpha * 0.72})`;
    ctx.fillRect(0, yy + 3 + (i % 4), W, 1);
  }
  for (let i = 0; i < 9; i += 1) {
    const yy = Math.floor((i * 91 + state.scroll * 0.035) % (H + 100) - 50);
    ctx.fillStyle = "rgba(255, 255, 255, 0.028)";
    ctx.fillRect(0, yy, W, 8 + (i % 3) * 3);
  }

  drawLandBelow();

  for (const c of state.cloudSeed) {
    const y = Math.floor((c.y + state.scroll * (c.speed / 42)) % (H + 150) - 95);
    drawPixelCloud(Math.floor(c.x), y, c.r, c.layer, c.tone, c.shape);
  }
}

function drawLandBelow() {
  ctx.fillStyle = "rgba(76, 118, 76, 0.22)";
  for (const p of state.landSeed) {
    const y = Math.floor((p.y + state.scroll * 0.18) % (H + 140) - 70);
    const green = 84 + p.tone * 11;
    const brown = 92 + p.tone * 8;
    ctx.fillStyle = `rgba(${green}, ${brown + 28}, ${green - 22}, 0.22)`;
    px(p.x - p.w / 2, y, p.w, p.h);
    ctx.fillStyle = `rgba(${brown}, ${brown - 12}, ${green - 34}, 0.14)`;
    px(p.x - p.w * 0.34, y + p.h * 0.45, p.w * 0.72, Math.max(4, p.h * 0.3));
    ctx.fillStyle = "rgba(220, 214, 166, 0.12)";
    px(p.x - p.w * 0.45, y + 3, p.w * 0.28, 3);
    px(p.x + p.w * 0.08, y + p.h * 0.25, p.w * 0.2, 3);
  }
}

function drawPixelCloud(x, y, r, layer, tone, shape) {
  const scale = layer === 0 ? 0.78 : layer === 1 ? 1.12 : 1.48;
  const rr = Math.floor(r * scale);
  const shade = tone === 0 ? 0 : tone === 1 ? 8 : tone === 2 ? -6 : 4;
  const hi = `rgba(${clamp(248 + shade, 220, 255)}, ${clamp(252 + shade, 220, 255)}, 255, ${layer === 0 ? 0.54 : 0.76})`;
  const mid = `rgba(${clamp(220 + shade, 180, 255)}, ${clamp(236 + shade, 190, 255)}, ${clamp(246 + shade, 200, 255)}, ${layer === 0 ? 0.42 : 0.62})`;
  const low = `rgba(${clamp(154 + shade, 120, 210)}, ${clamp(190 + shade, 150, 230)}, ${clamp(216 + shade, 170, 245)}, ${layer === 0 ? 0.26 : 0.42})`;

  if (shape === 0) {
    ctx.fillStyle = low;
    px(x - rr * 1.12, y + rr * 0.22, rr * 2.36, Math.max(5, rr * 0.3));
    px(x - rr * 0.78, y + rr * 0.36, rr * 1.8, Math.max(4, rr * 0.18));
    ctx.fillStyle = mid;
    px(x - rr, y, rr * 2.0, rr * 0.3);
    px(x - rr * 0.72, y - rr * 0.18, rr * 0.92, rr * 0.34);
    px(x - rr * 0.18, y - rr * 0.32, rr * 0.98, rr * 0.42);
    px(x + rr * 0.36, y - rr * 0.12, rr * 0.78, rr * 0.32);
    ctx.fillStyle = hi;
    px(x - rr * 0.88, y - rr * 0.06, rr * 0.62, rr * 0.12);
    px(x - rr * 0.5, y - rr * 0.28, rr * 0.72, rr * 0.16);
    px(x + rr * 0.02, y - rr * 0.42, rr * 0.62, rr * 0.16);
    px(x + rr * 0.48, y - rr * 0.2, rr * 0.46, rr * 0.14);
  } else if (shape === 1) {
    ctx.fillStyle = low;
    px(x - rr * 1.35, y + rr * 0.28, rr * 2.65, rr * 0.22);
    ctx.fillStyle = mid;
    px(x - rr * 1.25, y + rr * 0.06, rr * 1.35, rr * 0.25);
    px(x - rr * 0.18, y - rr * 0.06, rr * 1.5, rr * 0.28);
    px(x - rr * 0.58, y - rr * 0.28, rr * 0.88, rr * 0.26);
    ctx.fillStyle = hi;
    px(x - rr * 1.0, y - rr * 0.02, rr * 0.62, rr * 0.1);
    px(x - rr * 0.42, y - rr * 0.3, rr * 0.58, rr * 0.12);
    px(x + rr * 0.35, y - rr * 0.1, rr * 0.74, rr * 0.12);
  } else if (shape === 2) {
    ctx.fillStyle = low;
    px(x - rr * 0.7, y + rr * 0.45, rr * 1.45, rr * 0.18);
    ctx.fillStyle = mid;
    px(x - rr * 0.68, y + rr * 0.12, rr * 1.36, rr * 0.3);
    px(x - rr * 0.48, y - rr * 0.18, rr * 0.9, rr * 0.32);
    ctx.fillStyle = hi;
    px(x - rr * 0.42, y - rr * 0.22, rr * 0.55, rr * 0.12);
    px(x + rr * 0.05, y + rr * 0.05, rr * 0.44, rr * 0.1);
  } else if (shape === 3) {
    ctx.fillStyle = low;
    px(x - rr * 1.55, y + rr * 0.26, rr * 3.0, rr * 0.16);
    ctx.fillStyle = mid;
    px(x - rr * 1.45, y + rr * 0.08, rr * 2.55, rr * 0.16);
    px(x - rr * 1.0, y - rr * 0.08, rr * 1.75, rr * 0.14);
    ctx.fillStyle = hi;
    px(x - rr * 1.32, y, rr * 0.72, rr * 0.08);
    px(x - rr * 0.45, y - rr * 0.12, rr * 0.86, rr * 0.08);
    px(x + rr * 0.5, y + rr * 0.04, rr * 0.5, rr * 0.08);
  } else if (shape === 4) {
    ctx.fillStyle = low;
    px(x - rr * 1.0, y + rr * 0.32, rr * 2.05, rr * 0.2);
    ctx.fillStyle = mid;
    px(x - rr * 0.98, y + rr * 0.08, rr * 0.72, rr * 0.28);
    px(x - rr * 0.38, y - rr * 0.18, rr * 0.82, rr * 0.34);
    px(x + rr * 0.28, y + rr * 0.04, rr * 0.78, rr * 0.25);
    ctx.fillStyle = hi;
    px(x - rr * 0.28, y - rr * 0.24, rr * 0.45, rr * 0.12);
    px(x + rr * 0.42, y, rr * 0.42, rr * 0.1);
  } else if (shape === 5) {
    ctx.fillStyle = low;
    px(x - rr * 0.95, y + rr * 0.38, rr * 1.85, rr * 0.14);
    ctx.fillStyle = mid;
    px(x - rr * 0.9, y + rr * 0.18, rr * 0.7, rr * 0.15);
    px(x - rr * 0.08, y + rr * 0.08, rr * 0.9, rr * 0.18);
    ctx.fillStyle = hi;
    px(x - rr * 0.7, y + rr * 0.12, rr * 0.42, rr * 0.07);
    px(x + rr * 0.18, y + rr * 0.02, rr * 0.52, rr * 0.08);
  } else if (shape === 6) {
    ctx.fillStyle = low;
    px(x - rr * 1.75, y + rr * 0.18, rr * 3.35, rr * 0.3);
    px(x - rr * 1.32, y + rr * 0.42, rr * 2.65, rr * 0.14);
    ctx.fillStyle = mid;
    px(x - rr * 1.5, y - rr * 0.03, rr * 0.86, rr * 0.28);
    px(x - rr * 0.72, y - rr * 0.24, rr * 1.1, rr * 0.34);
    px(x + rr * 0.2, y - rr * 0.08, rr * 1.25, rr * 0.3);
    ctx.fillStyle = hi;
    px(x - rr * 1.2, y - rr * 0.1, rr * 0.56, rr * 0.12);
    px(x - rr * 0.48, y - rr * 0.28, rr * 0.62, rr * 0.12);
    px(x + rr * 0.48, y - rr * 0.14, rr * 0.62, rr * 0.12);
  } else {
    ctx.fillStyle = low;
    px(x - rr * 1.18, y + rr * 0.2, rr * 2.4, rr * 0.22);
    ctx.fillStyle = mid;
    for (let i = 0; i < 5; i += 1) {
      const ox = (-0.9 + i * 0.43) * rr;
      const oy = (Math.sin(i * 1.7) * 0.18 - 0.12) * rr;
      px(x + ox, y + oy, rr * 0.48, rr * (0.2 + (i % 2) * 0.08));
    }
    ctx.fillStyle = hi;
    px(x - rr * 0.72, y - rr * 0.16, rr * 0.42, rr * 0.08);
    px(x - rr * 0.08, y - rr * 0.22, rr * 0.52, rr * 0.08);
    px(x + rr * 0.52, y - rr * 0.08, rr * 0.36, rr * 0.08);
  }

  ctx.fillStyle = "rgba(88, 137, 176, 0.18)";
  px(x - rr * 0.92, y + rr * 0.5, rr * 1.98, 2 + layer);
}

function drawFlakWarnings() {
  for (const f of state.flak) {
    if (f.exploded) continue;
    const pulse = 0.08 + Math.sin(state.t * 16) * 0.03;
    ctx.fillStyle = `rgba(210, 46, 46, ${pulse})`;
    pixelCircle(f.x, f.y, f.r);
    ctx.fillStyle = "rgba(255, 190, 190, 0.42)";
    pixelRing(f.x, f.y, f.r);
  }
}

function drawWarnings() {
  for (const w of state.warnings) {
    if (w.done) continue;
    const alpha = 0.16 + Math.sin(state.t * 18) * 0.07;
    ctx.fillStyle = w.kind === "v2" ? `rgba(170, 255, 80, ${alpha + 0.06})` : `rgba(230, 30, 30, ${alpha})`;
    ctx.fillRect(Math.floor(w.x - w.w / 2), 0, Math.floor(w.w), H);
    ctx.fillStyle = w.kind === "v2" ? "rgba(230, 255, 190, 0.82)" : "rgba(255, 230, 230, 0.72)";
    for (let y = 0; y < H; y += 28) px(w.x - 2, y, 4, 12);
  }
}

function drawPlayer() {
  const p = state.player;
  if (p.destroyed) return;
  if (p.invincible > 0 && Math.floor(state.t * 18) % 2 === 0) return;
  ctx.save();
  ctx.translate(Math.round(p.x), Math.round(p.y));
  drawP51D(p.roll);
  ctx.restore();
}

function drawEnemies() {
  for (const e of state.enemies) {
    ctx.save();
    ctx.translate(Math.round(e.x), Math.round(e.y));
    if (e.type === "bf109") drawBf109();
    if (e.type === "bf110") {
      ctx.rotate(Math.PI);
      drawBf110();
    }
    if (e.type === "fw190") drawFw190();
    if (e.type === "v1") drawV1();
    if (e.type === "v2") drawV2();
    ctx.restore();
    drawHpBar(e.x, e.y - e.h * 0.62, e.w, e.hp, e.maxHp);
  }
}

function drawBoss() {
  const boss = state.boss;
  if (!boss) return;
  if (boss.kind === "ju288") {
    drawJu288Boss(boss);
    return;
  }
  for (const plane of boss.planes) {
    ctx.save();
    ctx.translate(Math.round(plane.x), Math.round(plane.y));
    ctx.rotate(plane.angle + Math.PI / 2);
    drawMe262();
    ctx.restore();
    drawHpBar(plane.x, plane.y - 28, 54, boss.hp, boss.maxHp);
  }
  ctx.fillStyle = "#17212a";
  ctx.fillRect(72, 14, W - 144, 9);
  ctx.fillStyle = "#e85845";
  ctx.fillRect(72, 14, (W - 144) * Math.max(0, boss.hp / boss.maxHp), 9);
  ctx.fillStyle = "#f6f1df";
  ctx.font = "12px monospace";
  ctx.textAlign = "center";
  ctx.fillText("Me262 Formation", W / 2, 36);
}

function drawJu288Boss(boss) {
  const fade = boss.mode === "enter" ? clamp((boss.y + 145) / 260, 0.22, 1) : 1;
  ctx.globalAlpha = fade;
  ctx.save();
  ctx.translate(Math.round(boss.x), Math.round(boss.y));
  drawJu288();
  ctx.restore();
  ctx.globalAlpha = 1;

  drawHpBar(boss.x, boss.y - 92, 84, boss.body.hp, boss.body.maxHp);
  for (const engine of boss.engines) {
    drawHpBar(boss.x + engine.offset, boss.y - 26, 34, Math.max(0, engine.hp), engine.maxHp);
  }
  ctx.fillStyle = "#17212a";
  ctx.fillRect(54, 14, W - 108, 9);
  ctx.fillStyle = "#e85845";
  const engineRatio = boss.engines.reduce((sum, engine) => sum + Math.max(0, engine.hp / engine.maxHp), 0) / boss.engines.length;
  const bodyRatio = Math.max(0, boss.body.hp / boss.body.maxHp);
  ctx.fillRect(54, 14, (W - 108) * Math.max(bodyRatio, engineRatio), 9);
  ctx.fillStyle = "#f6f1df";
  ctx.font = "12px monospace";
  ctx.textAlign = "center";
  ctx.fillText("Ju 288 Heavy Bomber", W / 2, 36);
}

function drawP51D(roll) {
  const shade = roll > 0.08 ? 3 : roll < -0.08 ? -3 : 0;
  const flap = Math.floor(Math.sin(state.t * 42) * 2);
  ctx.fillStyle = "#e3e8eb";
  px(-3 + shade, -42, 6, 7);
  px(-5 + shade, -36, 10, 16);
  px(-7 + shade, -24, 14, 38);
  px(-9 + shade, 7, 18, 17);
  ctx.fillStyle = "#aeb9be";
  px(2 + shade, -34, 4, 48);
  px(-7 + shade, 13, 14, 8);

  ctx.fillStyle = "#d3d9dd";
  px(-45, -6 - shade, 90, 6);
  px(-41, 0 - shade, 82, 7);
  px(-35, 7 - shade, 70, 5);
  ctx.fillStyle = "#eef2f4";
  px(-31, -9 - shade, 62, 4);
  px(-23, -12 - shade, 46, 3);
  ctx.fillStyle = "#8c9aa0";
  px(-43, 3 - shade, 17, 5);
  px(26, 3 + shade, 17, 5);
  px(-29, 8 - shade, 12, 4);
  px(17, 8 + shade, 12, 4);

  ctx.fillStyle = "#c63d3d";
  px(-40, -5 - shade, 10, 4);
  px(30, -5 + shade, 10, 4);
  ctx.fillStyle = "#25343e";
  px(-5 + shade, -25, 10, 12);
  px(-4 + shade, -32, 8, 6);
  ctx.fillStyle = "#78b7d4";
  px(-3 + shade, -23, 6, 5);

  ctx.fillStyle = "#30373b";
  px(-18, 20, 36, 6);
  px(-13, 26, 26, 5);
  px(-4, 19, 8, 16);
  ctx.fillStyle = "#76838a";
  px(-26, 18, 17, 5);
  px(9, 18, 17, 5);

  ctx.fillStyle = "#2b3338";
  px(-22, -12 - shade, 3, 13);
  px(-15, -11 - shade, 3, 12);
  px(12, -11 + shade, 3, 12);
  px(19, -12 + shade, 3, 13);
  ctx.fillStyle = "#3b4245";
  px(-6, -47, 12, 4);
  px(-2, -50, 4, 10);
  ctx.fillStyle = "#e0c66a";
  px(-1, -45, 2, 7);
  ctx.fillStyle = "rgba(36, 42, 44, 0.52)";
  px(-16 + flap, -46, 32 - flap * 2, 2);
  px(-2, -58 + flap, 4, 26 - flap * 2);
}

function drawBf109() {
  ctx.fillStyle = "#758071";
  px(-5, -24, 10, 43);
  ctx.fillStyle = "#566256";
  px(-33, -4, 66, 8);
  px(-25, 3, 50, 6);
  px(-19, 15, 38, 6);
  ctx.fillStyle = "#364139";
  px(-4, -15, 8, 12);
  px(-12, 18, 24, 5);
  ctx.fillStyle = "#1f2c28";
  px(-23, 1, 7, 5);
  px(16, 1, 7, 5);
  ctx.fillStyle = "#d8c47b";
  px(-2, 22, 4, 8);
}

function drawBf110() {
  ctx.fillStyle = "#70766d";
  px(-8, -23, 16, 45);
  ctx.fillStyle = "#5b655b";
  px(-45, -4, 90, 10);
  px(-38, 12, 76, 8);
  ctx.fillStyle = "#3f4b45";
  px(-31, 3, 16, 17);
  px(15, 3, 16, 17);
  ctx.fillStyle = "#222d2e";
  px(-24, 8, 7, 11);
  px(17, 8, 7, 11);
  px(-5, -15, 10, 10);
  ctx.fillStyle = "#8c938a";
  px(-12, -2, 24, 5);
  ctx.fillStyle = "#d0bd7d";
  px(-3, 24, 6, 7);
}

function drawFw190() {
  ctx.fillStyle = "#766f62";
  px(-8, -22, 16, 43);
  ctx.fillStyle = "#5d574d";
  px(-36, -4, 72, 10);
  px(-27, 4, 54, 6);
  ctx.fillStyle = "#46433c";
  px(-22, 13, 44, 7);
  ctx.fillStyle = "#263238";
  px(-5, -12, 10, 11);
  ctx.fillStyle = "#958b75";
  px(-7, -23, 14, 5);
  ctx.fillStyle = "#d69a57";
  px(-9, 24, 18, 5);
}

function drawV1() {
  ctx.fillStyle = "#b6cfa3";
  px(-8, -36, 16, 60);
  ctx.fillStyle = "#87a978";
  px(2, -32, 5, 49);
  ctx.fillStyle = "#6f8f65";
  px(-18, 0, 36, 8);
  ctx.fillStyle = "#435a42";
  px(-8, 24, 16, 10);
  ctx.fillStyle = "#d7e6bf";
  px(-3, -43, 6, 9);
}

function drawV2() {
  ctx.fillStyle = "#c2d7aa";
  px(-9, -40, 18, 66);
  ctx.fillStyle = "#8fae7a";
  px(2, -35, 6, 52);
  ctx.fillStyle = "#6c8d61";
  px(-17, 8, 34, 8);
  ctx.fillStyle = "#415940";
  px(-9, 27, 18, 11);
  ctx.fillStyle = "#e0edc8";
  px(-4, -50, 8, 12);
  ctx.fillStyle = "#f5f2dc";
  px(-9, -24, 9, 8);
  px(0, -16, 9, 8);
  px(-9, -8, 9, 8);
  ctx.fillStyle = "#161b1c";
  px(0, -24, 9, 8);
  px(-9, -16, 9, 8);
  px(0, -8, 9, 8);
}

function drawMe262() {
  ctx.fillStyle = "#77838a";
  px(-7, -27, 14, 52);
  ctx.fillStyle = "#5a676d";
  px(-41, -5, 82, 9);
  px(-31, 4, 62, 6);
  ctx.fillStyle = "#303c43";
  px(-33, 2, 13, 13);
  px(20, 2, 13, 13);
  ctx.fillStyle = "#243039";
  px(-5, -16, 10, 12);
  ctx.fillStyle = "#aab3b7";
  px(-4, -27, 8, 7);
  ctx.fillStyle = "#d4c079";
  px(-2, -35, 4, 8);
}

function drawJu288() {
  ctx.fillStyle = "#69747a";
  px(-17, -94, 34, 174);
  ctx.fillStyle = "#7f8b91";
  px(-13, -108, 26, 28);
  px(-22, -64, 44, 54);
  ctx.fillStyle = "#4d5960";
  px(-150, -19, 300, 25);
  px(-130, 6, 260, 20);
  px(-92, 57, 184, 18);
  ctx.fillStyle = "#5d686e";
  px(-138, -29, 276, 12);
  px(-116, 27, 232, 10);
  ctx.fillStyle = "#354147";
  px(-143, -3, 34, 42);
  px(-88, -3, 34, 42);
  px(54, -3, 34, 42);
  px(109, -3, 34, 42);
  ctx.fillStyle = "#202a30";
  px(-135, 12, 21, 26);
  px(-80, 12, 21, 26);
  px(59, 12, 21, 26);
  px(114, 12, 21, 26);
  ctx.fillStyle = "#25313a";
  px(-9, -75, 18, 24);
  px(-12, -104, 24, 10);
  ctx.fillStyle = "#a8b2b5";
  px(-10, -91, 20, 10);
  ctx.fillStyle = "#303a40";
  px(-76, 70, 152, 18);
  px(-44, 84, 88, 12);
  px(-5, 66, 10, 38);
  ctx.fillStyle = "#1f292f";
  px(-160, -16, 28, 8);
  px(132, -16, 28, 8);
  px(-24, 86, 48, 8);
  ctx.fillStyle = "#1d2529";
  px(-113, 69, 7, 8);
  px(-72, 85, 7, 8);
  px(-31, 94, 7, 8);
  px(24, 94, 7, 8);
  px(65, 85, 7, 8);
  px(106, 69, 7, 8);
}

function drawBullets() {
  ctx.fillStyle = "#fff1a0";
  for (const b of state.bullets) px(b.x - 2, b.y - 8, 4, 12);
  for (const b of state.enemyBullets) {
    drawTracer(b);
  }
  for (const r of state.rockets) {
    ctx.save();
    ctx.translate(Math.round(r.x), Math.round(r.y));
    ctx.rotate(r.angle + Math.PI / 2);
    ctx.fillStyle = "#3c4547";
    px(-4, -14, 8, 24);
    ctx.fillStyle = "#e85845";
    px(-5, 10, 10, 5);
    ctx.restore();
  }
}

function drawTracer(b) {
  const angle = Math.atan2(b.vy, b.vx);
  const len = b.len || 18;
  const thick = Math.max(6, Math.floor(b.r * 0.85));
  ctx.save();
  ctx.translate(Math.round(b.x), Math.round(b.y));
  ctx.rotate(angle + Math.PI / 2);
  ctx.fillStyle = "rgba(255, 245, 180, 0.72)";
  px(-Math.ceil(thick / 2), -len * 0.55, thick, len);
  ctx.fillStyle = b.color || "#e8674f";
  px(-Math.floor(thick / 2), -len * 0.35, Math.max(2, thick - 1), len * 0.62);
  ctx.fillStyle = "#fff8cf";
  px(-1, -len * 0.52, 2, 5);
  ctx.restore();
}

function drawFx() {
  for (const p of state.particles) {
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1) * (p.alpha || 1);
    ctx.fillStyle = p.color;
    px(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  for (const e of state.explosions) {
    const k = e.life / e.total;
    ctx.fillStyle = k < 0.45 ? "#fff0a5" : "#e36b3f";
    const r = Math.floor((8 + k * 34) * e.scale);
    px(e.x - r / 2, e.y - r / 2, r, r);
    ctx.fillStyle = "#2b2925";
    px(e.x - r * 0.25, e.y - r * 0.15, r * 0.5, r * 0.32);
  }
}

function drawHpBar(x, y, w, hp, maxHp) {
  const width = Math.max(24, Math.floor(w));
  const left = Math.floor(x - width / 2);
  const top = Math.floor(y - 10);
  ctx.fillStyle = "rgba(17, 25, 31, 0.72)";
  ctx.fillRect(left, top, width, 5);
  ctx.fillStyle = hp < maxHp * 0.5 ? "#e85845" : "#66d06f";
  ctx.fillRect(left, top, Math.max(0, Math.ceil(width * hp / maxHp)), 5);
  ctx.strokeStyle = "rgba(246, 241, 223, 0.6)";
  ctx.strokeRect(left - 0.5, top - 0.5, width + 1, 6);
}

function drawPhaseText() {
  if (state.phase === "retreat") {
    ctx.fillStyle = "rgba(17, 25, 31, 0.58)";
    ctx.fillRect(88, 62, W - 176, 34);
    ctx.fillStyle = "#f6f1df";
    ctx.font = "16px monospace";
    ctx.textAlign = "center";
    ctx.fillText("Enemy retreat. Heavy contact inbound.", W / 2, 84);
  }
}

function drawBanner(text) {
  ctx.fillStyle = "rgba(17, 25, 31, 0.78)";
  ctx.fillRect(0, H / 2 - 48, W, 96);
  ctx.fillStyle = "#f6f1df";
  ctx.font = "40px monospace";
  ctx.textAlign = "center";
  ctx.fillText(text, W / 2, H / 2 + 14);
}

const PIXEL_FONT = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "A": ["01110", "10001", "11111", "10001", "10001"],
  "E": ["11111", "10000", "11110", "10000", "11111"],
  "F": ["11111", "10000", "11110", "10000", "10000"],
  "G": ["01111", "10000", "10111", "10001", "01111"],
  "K": ["10001", "10010", "11100", "10010", "10001"],
  "M": ["10001", "11011", "10101", "10001", "10001"],
  "N": ["10001", "11001", "10101", "10011", "10001"],
  "O": ["01110", "10001", "10001", "10001", "01110"],
  "R": ["11110", "10001", "11110", "10010", "10001"],
  "S": ["01111", "10000", "01110", "00001", "11110"],
  "T": ["11111", "00100", "00100", "00100", "00100"],
  "V": ["10001", "10001", "10001", "01010", "00100"],
  "Y": ["10001", "01010", "00100", "00100", "00100"],
  " ": ["0", "0", "0", "0", "0"]
};

function setPixelTitle(text) {
  overlayTitle.textContent = "";
  overlayTitle.classList.add("pixel-title");
  for (const line of splitPixelTitle(text)) {
    const row = document.createElement("div");
    row.className = "pixel-line";
    row.append(...buildPixelLine(line));
    overlayTitle.append(row);
  }
}

function splitPixelTitle(text) {
  if (text === "SKY FRONT 1944") return ["SKY FRONT", "1944"];
  if (text === "GAME OVER") return ["GAME", "OVER"];
  return [text];
}

function buildPixelLine(text) {
  const rows = Array.from({ length: 5 }, () => document.createElement("div"));
  for (const row of rows) row.className = "pixel-row";
  for (const char of text.toUpperCase()) {
    const glyph = PIXEL_FONT[char] || PIXEL_FONT[" "];
    for (let y = 0; y < 5; y += 1) {
      const pattern = glyph[y] || "0";
      for (const bit of pattern) {
        const cell = document.createElement("span");
        cell.className = bit === "1" ? "pixel on" : "pixel";
        rows[y].append(cell);
      }
      const spacer = document.createElement("span");
      spacer.className = "pixel";
      rows[y].append(spacer);
    }
  }
  return rows;
}

function trailSmoke(x, y, angle, amount) {
  if (Math.random() > 0.65 * amount) return;
  const speed = 24 + Math.random() * 26;
  state.particles.push({
    x,
    y,
    vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 28,
    vy: Math.sin(angle) * speed + (Math.random() - 0.5) * 28,
    life: 0.9,
    maxLife: 0.9,
    size: 5 + Math.random() * 9,
    grow: 7,
    color: "#1f2424",
    alpha: 0.45
  });
}

function pixelSparks(x, y, color, count) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 50 + Math.random() * 150;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.22 + Math.random() * 0.18,
      maxLife: 0.4,
      size: 2 + Math.random() * 3,
      color,
      alpha: 1
    });
  }
}

function flakBurst(x, y, radius) {
  state.explosions.push({ x, y, scale: radius / 18, life: 0, total: 0.34, flak: true });
  for (let i = 0; i < 34; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 35 + Math.random() * 145;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.55 + Math.random() * 0.45,
      maxLife: 1,
      size: 4 + Math.random() * 8,
      grow: 4,
      color: Math.random() > 0.35 ? "#252a2b" : "#574b3c",
      alpha: 0.72
    });
  }
  for (let i = 0; i < 14; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 95 + Math.random() * 180;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.2 + Math.random() * 0.18,
      maxLife: 0.4,
      size: 2 + Math.random() * 3,
      color: "#f6d37a",
      alpha: 1
    });
  }
}

function explosion(x, y, scale) {
  state.explosions.push({ x, y, scale, life: 0, total: 0.44 });
  for (let i = 0; i < 28 * scale; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 50 + Math.random() * 220;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.35 + Math.random() * 0.5,
      maxLife: 0.85,
      size: 3 + Math.random() * 5,
      color: Math.random() > 0.45 ? "#f6c45d" : "#d84b35",
      alpha: 1
    });
  }
}

function playerBreakup(x, y) {
  explosion(x, y, 2.2);
  explosion(x - 18, y + 8, 1.3);
  explosion(x + 16, y - 10, 1.1);
  const chunks = [
    { x: -26, y: -4, color: "#d3d9dd" },
    { x: 24, y: -3, color: "#d3d9dd" },
    { x: 0, y: -22, color: "#e3e8eb" },
    { x: -8, y: 18, color: "#30373b" },
    { x: 10, y: 22, color: "#76838a" },
    { x: 0, y: -44, color: "#2b3338" }
  ];
  for (const chunk of chunks) {
    const angle = Math.atan2(chunk.y, chunk.x) + (Math.random() - 0.5) * 0.8;
    const speed = 90 + Math.random() * 190;
    state.particles.push({
      x: x + chunk.x * 0.25,
      y: y + chunk.y * 0.25,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.9 + Math.random() * 0.55,
      maxLife: 1.4,
      size: 7 + Math.random() * 8,
      grow: -1.5,
      color: chunk.color,
      alpha: 1
    });
  }
  for (let i = 0; i < 42; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 80 + Math.random() * 310;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.4 + Math.random() * 0.7,
      maxLife: 1.1,
      size: 2 + Math.random() * 5,
      color: Math.random() > 0.45 ? "#ffd66f" : "#d84b35",
      alpha: 1
    });
  }
}

function rectCircle(rect, circle) {
  return circleRect(circle, rect);
}

function circleRect(circle, rect) {
  const x = clamp(circle.x, rect.x - rect.w / 2, rect.x + rect.w / 2);
  const y = clamp(circle.y, rect.y - rect.h / 2, rect.y + rect.h / 2);
  return Math.hypot(circle.x - x, circle.y - y) < circle.r;
}

function px(x, y, w, h) {
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function pixelCircle(x, y, r) {
  const step = 4;
  for (let yy = -r; yy <= r; yy += step) {
    const half = Math.sqrt(Math.max(0, r * r - yy * yy));
    px(x - half, y + yy, half * 2, step);
  }
}

function pixelRing(x, y, r) {
  const step = 5;
  for (let a = 0; a < Math.PI * 2; a += 0.16) {
    const px1 = x + Math.cos(a) * r;
    const py1 = y + Math.sin(a) * r;
    px(px1 - step / 2, py1 - step / 2, step, step);
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function readLeaderboard() {
  try {
    const raw = localStorage.getItem(LEADERBOARD_KEY);
    const scores = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(scores)) return [];
    return scores
      .filter((entry) => entry && typeof entry.name === "string" && Number.isFinite(entry.score))
      .map((entry) => ({
        name: entry.name.slice(0, 24),
        score: Math.max(0, Math.floor(entry.score))
      }));
  } catch {
    return [];
  }
}

function saveLeaderboard(scores) {
  try {
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(scores));
  } catch {
    // The game still runs if the browser blocks local score storage.
  }
}

function normalizePlayerName(value, score) {
  const name = (value || "").trim().replace(/\s+/g, " ").slice(0, 18);
  return name || `guest ${score}`;
}

function addLeaderboardScore(name, score) {
  const next = [...readLeaderboard(), { name, score: Math.max(0, Math.floor(score)) }]
    .sort((a, b) => b.score - a.score)
    .slice(0, LEADERBOARD_LIMIT);
  saveLeaderboard(next);
  renderLeaderboard(next);
}

function hideScoreForm() {
  if (!scoreForm) return;
  scoreForm.classList.remove("hidden");
  if (pilotNameInput) {
    pilotNameInput.value = "";
    pilotNameInput.placeholder = "guest score";
    pilotNameInput.disabled = true;
  }
  if (saveScoreButton) saveScoreButton.disabled = true;
  if (scoreMessage) scoreMessage.textContent = "Finish a sortie to save your score";
}

function showScoreForm() {
  if (state.scoreSubmitted) return;
  if (!scoreForm) {
    submitCurrentScore("");
    return;
  }
  const finalScore = Math.max(0, Math.floor(state.score));
  scoreForm.classList.remove("hidden");
  if (saveScoreButton) saveScoreButton.disabled = false;
  if (scoreMessage) scoreMessage.textContent = `Final score: ${finalScore}`;
  if (pilotNameInput) {
    pilotNameInput.value = "";
    pilotNameInput.placeholder = `guest ${finalScore}`;
    pilotNameInput.disabled = false;
    pilotNameInput.focus();
  }
}

function submitCurrentScore(name) {
  if (state.scoreSubmitted) return;
  state.scoreSubmitted = true;
  const finalScore = Math.max(0, Math.floor(state.score));
  addLeaderboardScore(normalizePlayerName(name, finalScore), finalScore);
  if (scoreMessage) scoreMessage.textContent = "Score saved";
  if (pilotNameInput) {
    pilotNameInput.value = "";
    pilotNameInput.disabled = true;
  }
  if (saveScoreButton) saveScoreButton.disabled = true;
}

function renderLeaderboard(scores = readLeaderboard()) {
  if (!leaderboardSelect) return;
  leaderboardSelect.innerHTML = "";

  if (scores.length === 0) {
    const empty = document.createElement("option");
    empty.textContent = "NO SCORES YET";
    empty.disabled = true;
    leaderboardSelect.append(empty);
    return;
  }

  scores.forEach((entry, index) => {
    const option = document.createElement("option");
    option.value = `${entry.score}`;
    option.textContent = `${String(index + 1).padStart(2, "0")}  ${entry.name}  ${entry.score}`;
    leaderboardSelect.append(option);
  });
}

function updateHud() {
  hud.score.textContent = state.score;
  hud.wave.textContent = state.stage;
  hud.lives.textContent = Math.max(0, state.lives);
  hud.power.textContent = "P-51D";
}

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  keys.add(key);
  if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) event.preventDefault();
  if (key === "p" && state.running) state.paused = !state.paused;
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
});

for (const button of document.querySelectorAll("[data-touch]")) {
  const name = button.dataset.touch;
  const set = (value) => {
    touch[name] = value;
  };
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    set(true);
  });
  button.addEventListener("pointerup", () => set(false));
  button.addEventListener("pointerleave", () => set(false));
  button.addEventListener("pointercancel", () => set(false));
}

startButton.addEventListener("click", startGame);

if (scoreForm) {
  scoreForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitCurrentScore(pilotNameInput?.value || "");
  });
}

function setPointerAim(event, firing) {
  const rect = canvas.getBoundingClientRect();
  pointerAim.x = ((event.clientX - rect.left) / rect.width) * W;
  pointerAim.y = ((event.clientY - rect.top) / rect.height) * H;
  pointerAim.active = true;
  if (firing !== undefined) pointerAim.fire = firing;
}

canvas.addEventListener("pointermove", (event) => {
  setPointerAim(event);
});

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  canvas.setPointerCapture?.(event.pointerId);
  setPointerAim(event, true);
});

canvas.addEventListener("pointerup", (event) => {
  setPointerAim(event, false);
});

canvas.addEventListener("pointercancel", () => {
  pointerAim.fire = false;
});

canvas.addEventListener("pointerleave", () => {
  pointerAim.fire = false;
});

setPixelTitle("SKY FRONT 1944");
draw();
updateHud();
renderLeaderboard();
hideScoreForm();
