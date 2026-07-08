/* =========================================================================
 * game.js — ゲーム本体（ループ / エンティティ / 当たり判定 / スコア / DDA / 描画）
 * すべてプロシージャル描画（画像アセット不要）。オブジェクトプールでGC抑制。
 * ========================================================================= */
window.NEON = window.NEON || {};

NEON.Game = (function () {
  const C = NEON.config;
  const W = C.W, H = C.H;

  // ---- シード付き乱数（再現性：?debug でシード固定可能） ----
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let rng = mulberry32(Date.now() & 0xffffffff);

  // ---- オブジェクトプール ----
  function Pool(factory) {
    this.factory = factory; this.active = []; this.free = [];
  }
  Pool.prototype.spawn = function () {
    const o = this.free.pop() || this.factory();
    o.dead = false; this.active.push(o); return o;
  };
  Pool.prototype.sweep = function () {
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i].dead) {
        this.free.push(this.active[i]);
        this.active.splice(i, 1);
      }
    }
  };

  // ---- ゲーム状態 ----
  let ctx, canvas, view = { scale: 1, offsetX: 0, offsetY: 0 };
  let state = "title"; // title | playing | paused | stageclear | gameover | win
  let debug = false;

  let player, playerBullets, enemies, enemyBullets, particles;
  let stars = [];
  let stageIndex = 0, stageTime = 0, waveCursor = 0;
  let bossActive = false, boss = null;
  let score = 0, chain = 1, chainTimer = 0, highScores = [];
  let difficulty = 1.0, basePreset = 1.0;
  let ddaHitRate = 0; // 直近被弾傾向（移動平均）
  let shake = 0, flashAlpha = 0;
  let flashReduce = false;
  let callbacks = {};

  // =====================================================================
  // 初期化
  // =====================================================================
  function init(canvasEl, cbs) {
    canvas = canvasEl;
    ctx = canvas.getContext("2d");
    callbacks = cbs || {};
    canvas.width = W; canvas.height = H;

    playerBullets = new Pool(() => ({ x: 0, y: 0, vx: 0, vy: 0, r: 4, dmg: 1, dead: true }));
    enemyBullets = new Pool(() => ({ x: 0, y: 0, vx: 0, vy: 0, r: 5, dead: true }));
    enemies = new Pool(() => ({}));
    particles = new Pool(() => ({}));

    initStars();
    loadHighScores();

    const params = new URLSearchParams(location.search);
    if (params.get("debug") === "1") {
      debug = true;
      rng = mulberry32(parseInt(params.get("seed")) || 12345);
    }
  }

  function initStars() {
    stars = [];
    for (let i = 0; i < 80; i++) {
      stars.push({
        x: rng() * W, y: rng() * H,
        z: 0.3 + rng() * 1.7,     // 奥行き（パララックス）
        size: rng() * 2 + 0.5,
      });
    }
  }

  // =====================================================================
  // ゲーム開始
  // =====================================================================
  function start(presetName) {
    basePreset = C.difficulty.presets[presetName] || 1.0;
    difficulty = basePreset;
    ddaHitRate = 0;
    score = 0; chain = 1; chainTimer = 0;
    stageIndex = 0;
    player = makePlayer();
    beginStage(0);
    state = "playing";
    NEON.Audio.startBGM(0);
  }

  function makePlayer() {
    const p = C.player;
    return {
      x: W / 2, y: H - 120, r: p.radius,
      lives: p.lives, shield: p.shield, maxShield: p.shield,
      bombs: p.bombs, fireCd: 0,
      invuln: 1.0, blink: 0,
      boostTime: 0, boostCd: 0, boostGauge: 1, // 0..1
      trail: [],
    };
  }

  function beginStage(idx) {
    stageIndex = idx;
    stageTime = 0; waveCursor = 0;
    bossActive = false; boss = null;
    enemies.active.length = 0; enemies.free.length = 0;
    enemyBullets.active.length = 0;
    playerBullets.active.length = 0;
    particles.active.length = 0;
    if (callbacks.onStage) callbacks.onStage(NEON.stages[idx].name);
  }

  // =====================================================================
  // 敵生成
  // =====================================================================
  function spawnEnemy(type, relX) {
    const e = enemies.spawn();
    const x = (relX != null ? relX : rng()) * (W - 60) + 30;
    e.type = type; e.x = x; e.y = -30;
    e.t = 0; e.fireCd = rng() * 1.0 + 0.5;
    e.baseX = x; e.dead = false; e.flash = 0;
    switch (type) {
      case "straight": e.hp = 2; e.vy = 90 * difficulty; e.r = 14; e.score = 100; e.color = "#4dd0e1"; break;
      case "sine":     e.hp = 2; e.vy = 70 * difficulty; e.r = 13; e.score = 150; e.color = "#f06292"; e.amp = 60 + rng()*40; e.freq = 2 + rng(); break;
      case "homing":   e.hp = 4; e.vy = 60 * difficulty; e.r = 16; e.score = 250; e.color = "#ba68c8"; e.turn = 1.6; break;
      case "turret":   e.hp = 8; e.vy = 50; e.r = 18; e.score = 400; e.color = "#ffd54f"; e.stopY = 90 + rng()*80; e.fireInt = 1.4 / difficulty; break;
    }
  }

  function spawnBoss() {
    bossActive = true;
    const cfg = NEON.stages[stageIndex].boss;
    boss = {
      x: W / 2, y: -100, tx: W / 2, ty: 140,
      hp: cfg.hp, maxHp: cfg.hp, r: 46, name: cfg.name,
      t: 0, phase: 0, fireCd: 1.5, moveDir: 1, entering: true, flash: 0,
    };
    NEON.Audio.play("bossWarn");
    if (callbacks.onBoss) callbacks.onBoss(cfg.name);
  }

  // 敵の弾発射
  function enemyFire(x, y, angle, speed) {
    if (enemyBullets.active.length >= C.limits.enemyBullets) return;
    const b = enemyBullets.spawn();
    b.x = x; b.y = y; b.r = 5;
    b.vx = Math.cos(angle) * speed; b.vy = Math.sin(angle) * speed;
  }

  function aimAtPlayer(x, y) {
    return Math.atan2(player.y - y, player.x - x);
  }

  // =====================================================================
  // パーティクル
  // =====================================================================
  function burst(x, y, color, count, spd) {
    for (let i = 0; i < count; i++) {
      if (particles.active.length >= C.limits.particles) break;
      const p = particles.spawn();
      const a = rng() * Math.PI * 2;
      const s = (spd || 120) * (0.3 + rng());
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
      p.life = 0.4 + rng() * 0.4; p.maxLife = p.life;
      p.color = color; p.size = 1 + rng() * 3;
    }
  }

  // =====================================================================
  // 更新（固定ステップ dt 秒）
  // =====================================================================
  function update(dt) {
    if (state !== "playing") return;

    updateStars(dt);
    updatePlayer(dt);
    updatePlayerBullets(dt);
    updateSpawns(dt);
    updateEnemies(dt);
    if (bossActive) updateBoss(dt);
    updateEnemyBullets(dt);
    updateParticles(dt);
    updateScoring(dt);
    updateDDA(dt);

    if (shake > 0) shake = Math.max(0, shake - dt * 40);
    if (flashAlpha > 0) flashAlpha = Math.max(0, flashAlpha - dt * 2.5);

    playerBullets.sweep(); enemyBullets.sweep();
    enemies.sweep(); particles.sweep();

    // ステージクリア判定：ボス撃破
    if (bossActive && boss && boss.hp <= 0) {
      onStageCleared();
    }
    if (callbacks.onHud) callbacks.onHud(hudData());
  }

  function updateStars(dt) {
    for (const s of stars) {
      s.y += (30 + s.z * 40) * dt;
      if (s.y > H) { s.y = 0; s.x = rng() * W; }
    }
  }

  function updatePlayer(dt) {
    const p = player, cfg = C.player;
    // 入力処理
    const inp = NEON.Input.poll();

    // ブースト発動
    if (inp.boostEdge && p.boostCd <= 0 && p.boostGauge >= 0.9) {
      p.boostTime = cfg.boostDuration; p.boostCd = cfg.boostCooldown;
      p.boostGauge = 0; p.invuln = Math.max(p.invuln, cfg.boostDuration);
      NEON.Audio.play("powerup");
    }
    // ボム発動
    if (inp.bombEdge && p.bombs > 0) {
      p.bombs--; useBomb();
    }
    NEON.Input.clearEdges();

    if (p.boostCd > 0) p.boostCd -= dt;
    if (p.boostGauge < 1) p.boostGauge = Math.min(1, p.boostGauge + dt / cfg.boostCooldown);
    const boosting = p.boostTime > 0;
    if (boosting) p.boostTime -= dt;

    const speed = cfg.speed * (boosting ? cfg.boostSpeedMul : 1);

    // 移動：ポインタ追従 or 相対移動
    if (inp.pointerActive) {
      const dx = inp.pointerX - p.x, dy = inp.pointerY - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 1) {
        const step = Math.min(d, speed * dt);
        p.x += (dx / d) * step; p.y += (dy / d) * step;
      }
    } else {
      p.x += inp.moveX * speed * dt;
      p.y += inp.moveY * speed * dt;
    }
    p.x = Math.max(p.r, Math.min(W - p.r, p.x));
    p.y = Math.max(p.r, Math.min(H - p.r, p.y));

    // 残像トレイル（ブースト中の見た目）
    if (boosting) {
      p.trail.push({ x: p.x, y: p.y, life: 0.25 });
      NEON.Audio; // no-op
    }
    for (let i = p.trail.length - 1; i >= 0; i--) {
      p.trail[i].life -= dt;
      if (p.trail[i].life <= 0) p.trail.splice(i, 1);
    }

    // 無敵
    if (p.invuln > 0) { p.invuln -= dt; p.blink += dt; }

    // ショット
    p.fireCd -= dt;
    if (inp.fire && p.fireCd <= 0) {
      p.fireCd = cfg.fireInterval;
      shootPlayer();
      NEON.Audio.play("shot");
    }
  }

  function shootPlayer() {
    const p = player, cfg = C.player;
    // ツインショット
    for (const off of [-8, 8]) {
      const b = playerBullets.spawn();
      b.x = p.x + off; b.y = p.y - 12; b.vx = 0; b.vy = -cfg.bulletSpeed; b.r = 4; b.dmg = 1;
    }
  }

  function useBomb() {
    NEON.Audio.play("bomb");
    flashAlpha = flashReduce ? 0.3 : 0.9;
    shake = 12;
    // 敵弾を全消去
    for (const b of enemyBullets.active) { b.dead = true; burst(b.x, b.y, "#88ccff", 3, 60); }
    // 全敵にダメージ
    for (const e of enemies.active) {
      e.hp -= 4; e.flash = 0.1;
      if (e.hp <= 0) killEnemy(e);
    }
    if (boss) { boss.hp -= 8; boss.flash = 0.15; }
    if (navigator.vibrate) navigator.vibrate(60);
  }

  function updatePlayerBullets(dt) {
    for (const b of playerBullets.active) {
      b.y += b.vy * dt; b.x += b.vx * dt;
      if (b.y < -10) b.dead = true;
    }
  }

  function updateSpawns(dt) {
    stageTime += dt;
    const waves = NEON.stages[stageIndex].waves;
    // タイムラインを消化
    while (waveCursor < waves.length && stageTime >= waves[waveCursor].t) {
      const w = waves[waveCursor];
      scheduleWave(w);
      waveCursor++;
    }
    // 全ウェーブ消化 & 敵が概ね片付いたらボス
    if (!bossActive && waveCursor >= waves.length && enemies.active.length <= 1) {
      spawnBoss();
    }
  }

  // ウェーブ内の n 体を gap 間隔で撒く（setTimeout で簡易スケジュール）
  function scheduleWave(w) {
    const n = w.n || 1, gap = w.gap || 0.4;
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        if (state === "playing" && stageIndex === w._stage) spawnEnemy(w.type, w.x);
      }, i * gap * 1000);
    }
    w._stage = stageIndex;
  }

  function updateEnemies(dt) {
    for (const e of enemies.active) {
      e.t += dt;
      if (e.flash > 0) e.flash -= dt;
      switch (e.type) {
        case "straight": e.y += e.vy * dt; break;
        case "sine":
          e.y += e.vy * dt;
          e.x = e.baseX + Math.sin(e.t * e.freq) * e.amp;
          break;
        case "homing":
          e.y += e.vy * dt;
          {
            const ang = aimAtPlayer(e.x, e.y);
            e.x += Math.cos(ang) * e.turn * 40 * dt;
          }
          break;
        case "turret":
          if (e.y < e.stopY) e.y += e.vy * dt;
          else {
            e.fireCd -= dt;
            if (e.fireCd <= 0) {
              e.fireCd = e.fireInt;
              const a = aimAtPlayer(e.x, e.y);
              enemyFire(e.x, e.y, a, 160 * difficulty);
            }
          }
          break;
      }
      // sine/straight もたまに撃つ（難易度に応じ）
      if ((e.type === "sine") && e.y > 0) {
        e.fireCd -= dt;
        if (e.fireCd <= 0) {
          e.fireCd = 1.6 / difficulty;
          enemyFire(e.x, e.y, aimAtPlayer(e.x, e.y), 140 * difficulty);
        }
      }
      if (e.y > H + 40) e.dead = true; // 画面外
    }
  }

  function updateBoss(dt) {
    const b = boss;
    b.t += dt;
    if (b.flash > 0) b.flash -= dt;
    if (b.entering) {
      b.y += (b.ty - b.y) * 2 * dt;
      if (Math.abs(b.y - b.ty) < 2) b.entering = false;
      return;
    }
    // フェーズ：HP割合で攻撃変化
    const ratio = b.hp / b.maxHp;
    b.phase = ratio > 0.66 ? 0 : ratio > 0.33 ? 1 : 2;

    // 左右移動
    b.x += b.moveDir * 60 * dt;
    if (b.x < 80) { b.x = 80; b.moveDir = 1; }
    if (b.x > W - 80) { b.x = W - 80; b.moveDir = -1; }

    b.fireCd -= dt;
    if (b.fireCd <= 0) {
      if (b.phase === 0) {
        // 自機狙い3way
        b.fireCd = 1.1 / difficulty;
        const a = aimAtPlayer(b.x, b.y);
        for (const off of [-0.25, 0, 0.25]) enemyFire(b.x, b.y + 30, a + off, 150 * difficulty);
      } else if (b.phase === 1) {
        // 全方位リング
        b.fireCd = 1.4 / difficulty;
        const count = 16;
        for (let i = 0; i < count; i++) enemyFire(b.x, b.y, (i / count) * Math.PI * 2 + b.t, 130 * difficulty);
      } else {
        // 弾幕：狙い＋拡散を速射
        b.fireCd = 0.5 / difficulty;
        const a = aimAtPlayer(b.x, b.y);
        for (const off of [-0.4, -0.2, 0, 0.2, 0.4]) enemyFire(b.x, b.y + 30, a + off, 170 * difficulty);
      }
    }
  }

  function updateEnemyBullets(dt) {
    const p = player;
    for (const b of enemyBullets.active) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) { b.dead = true; continue; }
      // グレイズ（かすり）判定
      const d2 = dist2(b, p);
      if (p.invuln <= 0 && d2 < C.scoring.grazeRadius * C.scoring.grazeRadius && d2 > (p.r + b.r) * (p.r + b.r)) {
        if (!b._grazed) {
          b._grazed = true;
          score += C.scoring.grazeScore;
          p.boostGauge = Math.min(1, p.boostGauge + C.scoring.grazeBoost);
          NEON.Audio.play("graze");
        }
      }
    }
  }

  function updateParticles(dt) {
    for (const p of particles.active) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.94; p.vy *= 0.94;
      p.life -= dt;
      if (p.life <= 0) p.dead = true;
    }
  }

  // =====================================================================
  // 当たり判定（円判定・平方根回避）
  // =====================================================================
  function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }
  function hit(a, b) { const r = a.r + b.r; return dist2(a, b) < r * r; }

  function collide() {
    if (state !== "playing") return;
    const p = player;

    // 自弾 vs 敵
    for (const b of playerBullets.active) {
      if (b.dead) continue;
      for (const e of enemies.active) {
        if (e.dead) continue;
        if (hit(b, e)) {
          b.dead = true; e.hp -= b.dmg; e.flash = 0.08;
          burst(b.x, b.y, e.color, 2, 60);
          if (e.hp <= 0) killEnemy(e);
          break;
        }
      }
      // 自弾 vs ボス
      if (!b.dead && boss && !boss.entering && hit(b, boss)) {
        b.dead = true; boss.hp -= b.dmg; boss.flash = 0.06;
        burst(b.x, b.y, "#ffffff", 2, 60);
      }
    }

    if (p.invuln > 0) return; // 無敵中は被弾しない

    // 敵弾 vs 自機（食らい判定は小さく）
    const hurt = { x: p.x, y: p.y, r: C.player.hitRadius };
    for (const b of enemyBullets.active) {
      if (!b.dead && hit(b, hurt)) { b.dead = true; playerHit(); return; }
    }
    // 敵本体 vs 自機
    for (const e of enemies.active) {
      if (!e.dead && hit(e, hurt)) { playerHit(); return; }
    }
    if (boss && !boss.entering && hit(boss, hurt)) playerHit();
  }

  function killEnemy(e) {
    e.dead = true;
    burst(e.x, e.y, e.color, 12, 140);
    NEON.Audio.play("explode");
    // チェイン倍率でスコア加算
    addScore(e.score);
    bumpChain();
    ddaHitRate = Math.max(0, ddaHitRate - 0.01); // 好調評価
    shake = Math.min(shake + 2, 6);
  }

  function playerHit() {
    const p = player;
    if (p.shield > 0) {
      p.shield--; p.invuln = 0.6; p.blink = 0;
      burst(p.x, p.y, "#66ccff", 8, 100);
      NEON.Audio.play("hit");
      shake = 8;
      ddaHitRate = Math.min(1, ddaHitRate + 0.15);
      return;
    }
    // 残機減
    p.lives--;
    burst(p.x, p.y, "#ff5252", 24, 180);
    NEON.Audio.play("hit");
    flashAlpha = flashReduce ? 0.25 : 0.6;
    shake = 14;
    chain = 1; chainTimer = 0; // チェインリセット
    ddaHitRate = Math.min(1, ddaHitRate + 0.35);
    if (navigator.vibrate) navigator.vibrate([40, 30, 40]);

    if (p.lives < 0) { onGameOver(); return; }
    // 復帰
    p.shield = p.maxShield; p.invuln = C.player.invulnTime;
    p.x = W / 2; p.y = H - 120;
    // 周囲の敵弾を軽く掃除
    for (const b of enemyBullets.active) {
      if (dist2(b, p) < 120 * 120) b.dead = true;
    }
  }

  // =====================================================================
  // スコア / チェイン
  // =====================================================================
  function addScore(base) { score += Math.round(base * chain); }
  function bumpChain() {
    chainTimer = C.scoring.chainWindow;
    chain = Math.min(C.scoring.chainMax, chain + 1);
    NEON.Audio.play("chain", chain);
  }
  function updateScoring(dt) {
    if (chain > 1) {
      chainTimer -= dt;
      if (chainTimer <= 0) chain = 1;
    }
  }

  // =====================================================================
  // DDA（動的難易度調整）
  // =====================================================================
  function updateDDA(dt) {
    // ddaHitRate（0=好調, 1=苦戦）を難易度に反映
    ddaHitRate = Math.max(0, ddaHitRate - dt * 0.02); // 時間で自然回復
    const target = basePreset + (0.5 - ddaHitRate) * 0.5; // 好調で上げ、苦戦で下げ
    const clamped = Math.max(C.difficulty.min, Math.min(C.difficulty.max, target));
    // なめらかに追従
    difficulty += (clamped - difficulty) * dt * 0.5;
  }

  // =====================================================================
  // ステージ遷移
  // =====================================================================
  function onStageCleared() {
    burst(boss.x, boss.y, "#ffffff", 40, 220);
    NEON.Audio.play("stageClear");
    // ノーミスボーナス等（簡易）
    addScore(2000);
    boss = null; bossActive = false;
    if (stageIndex + 1 >= NEON.stages.length) {
      state = "win";
      NEON.Audio.stopBGM();
      saveHighScore();
      if (callbacks.onWin) callbacks.onWin(score);
    } else {
      state = "stageclear";
      if (callbacks.onStageClear) callbacks.onStageClear(stageIndex + 1, score);
    }
  }

  function nextStage() {
    NEON.Audio.startBGM(stageIndex + 1);
    beginStage(stageIndex + 1);
    // 機体を軽く回復
    player.shield = player.maxShield;
    player.invuln = 1.2;
    state = "playing";
  }

  function onGameOver() {
    state = "gameover";
    NEON.Audio.stopBGM();
    saveHighScore();
    if (callbacks.onGameOver) callbacks.onGameOver(score);
  }

  // =====================================================================
  // ハイスコア（localStorage 永続化・破損フォールバック）
  // =====================================================================
  function loadHighScores() {
    try {
      const raw = localStorage.getItem("neon_drift_hi");
      highScores = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(highScores)) highScores = [];
    } catch (e) { highScores = []; }
  }
  function saveHighScore() {
    highScores.push({ score, date: new Date().toISOString().slice(0, 10) });
    highScores.sort((a, b) => b.score - a.score);
    highScores = highScores.slice(0, 5);
    try { localStorage.setItem("neon_drift_hi", JSON.stringify(highScores)); } catch (e) {}
  }
  function getHighScores() { return highScores.slice(); }

  // =====================================================================
  // 描画
  // =====================================================================
  function render() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // 背景
    const bg = NEON.stages[Math.min(stageIndex, NEON.stages.length - 1)].bg;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // スクリーンシェイク
    if (shake > 0) ctx.translate((rng() - 0.5) * shake, (rng() - 0.5) * shake);

    drawStars();

    if (state === "title") { ctx.restore(); return; }

    drawParticles();
    drawPlayerBullets();
    drawEnemies();
    if (boss) drawBoss();
    drawEnemyBullets();
    if (player && player.lives >= 0) drawPlayer();

    // ボム/被弾フラッシュ
    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flashAlpha})`;
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }

    if (debug) drawDebug();
    ctx.restore();
  }

  function glow(color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }
  function noGlow() { ctx.shadowBlur = 0; }

  function drawStars() {
    for (const s of stars) {
      ctx.globalAlpha = 0.4 + s.z * 0.3;
      ctx.fillStyle = "#aef";
      ctx.fillRect(s.x, s.y, s.size, s.size * 2);
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayer() {
    const p = player;
    // 残像
    for (const t of p.trail) {
      ctx.globalAlpha = (t.life / 0.25) * 0.4;
      ctx.fillStyle = "#00e5ff";
      ctx.beginPath(); ctx.arc(t.x, t.y, p.r * 0.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 点滅（無敵中）
    if (p.invuln > 0 && Math.floor(p.blink * 20) % 2 === 0) return;

    glow("#00e5ff", 16);
    ctx.fillStyle = "#00e5ff";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - p.r);
    ctx.lineTo(p.x - p.r, p.y + p.r);
    ctx.lineTo(p.x, p.y + p.r * 0.4);
    ctx.lineTo(p.x + p.r, p.y + p.r);
    ctx.closePath(); ctx.fill();
    // コア
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    // シールドリング
    if (p.shield > 0) {
      ctx.strokeStyle = `rgba(100,200,255,0.6)`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 6, 0, Math.PI * 2); ctx.stroke();
    }
    noGlow();
  }

  function drawPlayerBullets() {
    glow("#a0f0ff", 8);
    ctx.fillStyle = "#e0ffff";
    for (const b of playerBullets.active) {
      ctx.fillRect(b.x - 2, b.y - 8, 4, 12);
    }
    noGlow();
  }

  function drawEnemies() {
    for (const e of enemies.active) {
      glow(e.color, 12);
      ctx.fillStyle = e.flash > 0 ? "#ffffff" : e.color;
      ctx.beginPath();
      if (e.type === "turret") {
        ctx.rect(e.x - e.r, e.y - e.r, e.r * 2, e.r * 2);
      } else {
        ctx.moveTo(e.x, e.y + e.r);
        ctx.lineTo(e.x - e.r, e.y - e.r);
        ctx.lineTo(e.x + e.r, e.y - e.r);
        ctx.closePath();
      }
      ctx.fill();
    }
    noGlow();
  }

  function drawBoss() {
    const b = boss;
    glow("#ff4081", 24);
    ctx.fillStyle = b.flash > 0 ? "#ffffff" : "#ff4081";
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#1a0620";
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.5, 0, Math.PI * 2); ctx.fill();
    noGlow();
    // HPバー
    const w = W * 0.7, x = (W - w) / 2, y = 20;
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(x, y, w, 8);
    ctx.fillStyle = "#ff4081"; ctx.fillRect(x, y, w * Math.max(0, b.hp / b.maxHp), 8);
  }

  function drawEnemyBullets() {
    glow("#ff80ab", 8);
    for (const b of enemyBullets.active) {
      ctx.fillStyle = b._grazed ? "#ffd0e0" : "#ff5c8a";
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    }
    noGlow();
  }

  function drawParticles() {
    for (const p of particles.active) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawDebug() {
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "#0f0"; ctx.lineWidth = 1;
    // 食らい判定
    ctx.beginPath(); ctx.arc(player.x, player.y, C.player.hitRadius, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "#ff0";
    ctx.beginPath(); ctx.arc(player.x, player.y, C.scoring.grazeRadius, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#0f0"; ctx.font = "10px monospace";
    ctx.fillText(`diff:${difficulty.toFixed(2)} dda:${ddaHitRate.toFixed(2)}`, 6, H - 40);
    ctx.fillText(`eBul:${enemyBullets.active.length} part:${particles.active.length}`, 6, H - 28);
    ctx.fillText(`enemies:${enemies.active.length} stageT:${stageTime.toFixed(1)}`, 6, H - 16);
  }

  // =====================================================================
  // HUD データ / 外部制御
  // =====================================================================
  function hudData() {
    return {
      score, chain,
      lives: player ? Math.max(0, player.lives) : 0,
      bombs: player ? player.bombs : 0,
      boost: player ? player.boostGauge : 0,
      boostReady: player ? (player.boostCd <= 0 && player.boostGauge >= 0.9) : false,
    };
  }

  function setView(v) { view = v; NEON.Input.setView(v); }
  function getState() { return state; }
  function setState(s) { state = s; }
  function isDebug() { return debug; }
  function setFlashReduce(v) { flashReduce = v; }
  function getScore() { return score; }
  function getStageIndex() { return stageIndex; }

  return {
    init, start, update, collide, render,
    getState, setState, nextStage,
    setView, hudData, getHighScores, isDebug,
    setFlashReduce, getScore, getStageIndex,
  };
})();
