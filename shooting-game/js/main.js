/* =========================================================================
 * main.js — 起動・固定タイムステップのゲームループ・画面遷移・HUD/メニュー配線
 * ========================================================================= */
(function () {
  const G = NEON.Game;
  const C = NEON.config;

  const canvas = document.getElementById("game-canvas");
  const root = document.getElementById("game-root");
  const overlay = document.getElementById("overlay");
  const touchControls = document.getElementById("touch-controls");

  // HUD要素
  const elScore = document.getElementById("score");
  const elChain = document.getElementById("chain");
  const elLives = document.getElementById("lives");
  const elBombs = document.getElementById("bombs");
  const elBoostFill = document.getElementById("boost-fill");
  const elBanner = document.getElementById("banner");

  let bannerTimer = 0;

  // ---- レスポンシブ・スケーリング（論理解像度固定＋DPR対応） ----
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const availW = root.clientWidth, availH = root.clientHeight;
    const scale = Math.min(availW / C.W, availH / C.H);
    const dispW = C.W * scale, dispH = C.H * scale;
    // Canvasの実解像度は論理解像度×DPRで高精細化
    canvas.width = C.W * dpr;
    canvas.height = C.H * dpr;
    canvas.style.width = dispW + "px";
    canvas.style.height = dispH + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 論理座標で描けるように
    // 画面中央配置のオフセット（入力座標変換に使用）
    const offsetX = (availW - dispW) / 2;
    const offsetY = (availH - dispH) / 2;
    G.setView({ scale: scale, offsetX: offsetX, offsetY: offsetY, dpr });
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);

  // ---- HUD更新 ----
  function updateHud(d) {
    elScore.textContent = String(d.score).padStart(7, "0");
    elChain.textContent = d.chain > 1 ? "x" + d.chain : "";
    elChain.style.opacity = d.chain > 1 ? 1 : 0;
    elLives.textContent = "♥".repeat(Math.max(0, d.lives));
    elBombs.textContent = "◈".repeat(d.bombs);
    elBoostFill.style.width = Math.round(d.boost * 100) + "%";
    elBoostFill.style.background = d.boostReady ? "#00e5ff" : "#446";
  }

  // ---- バナー（ステージ名 / ボス警告） ----
  function showBanner(text, dur) {
    elBanner.textContent = text;
    elBanner.classList.add("show");
    bannerTimer = dur || 2.2;
  }

  // ---- オーバーレイ（メニュー）描画 ----
  function showOverlay(html) {
    overlay.innerHTML = html;
    overlay.classList.remove("hidden");
  }
  function hideOverlay() { overlay.classList.add("hidden"); overlay.innerHTML = ""; }

  function hiScoreHtml() {
    const hs = G.getHighScores();
    if (!hs.length) return "<p class='dim'>ハイスコアなし</p>";
    return "<ol class='hiscore'>" + hs.map(h =>
      `<li><span>${String(h.score).padStart(7,"0")}</span><span class='dim'>${h.date}</span></li>`).join("") + "</ol>";
  }

  function titleScreen() {
    G.setState("title");
    NEON.Audio.stopBGM();
    showOverlay(`
      <div class="panel">
        <h1 class="logo">NEON<span>DRIFT</span></h1>
        <p class="tagline">ドリフト・ブーストで駆け抜けろ</p>
        <div class="btnrow">
          <button class="btn" data-diff="EASY">EASY</button>
          <button class="btn primary" data-diff="NORMAL">NORMAL</button>
          <button class="btn" data-diff="HARD">HARD</button>
        </div>
        <details class="howto">
          <summary>操作方法 / ルール</summary>
          <ul>
            <li><b>移動</b>：矢印/WASD・画面ドラッグ・スティック</li>
            <li><b>ショット</b>：Z/Space・画面タッチ（自動連射）</li>
            <li><b>ブースト回避</b>：Shift/右クリック/右下ボタン（残像は無敵）</li>
            <li><b>ボム</b>：X/中クリック/左下ボタン（敵弾全消去）</li>
            <li><b>チェイン</b>：連続撃破で最大x8倍。かすりで加点＆ゲージ回復</li>
            <li><b>ポーズ</b>：P / Esc</li>
          </ul>
        </details>
        <div class="hs"><h3>HIGH SCORES</h3>${hiScoreHtml()}</div>
        <label class="opt"><input type="checkbox" id="opt-flash"> フラッシュ軽減</label>
      </div>`);
    overlay.querySelectorAll("[data-diff]").forEach(b =>
      b.addEventListener("click", () => {
        NEON.Audio.unlock();
        G.setFlashReduce(document.getElementById("opt-flash").checked);
        hideOverlay();
        G.start(b.dataset.diff);
        showBanner(NEON.stages[0].name, 2.2);
      }));
  }

  function pauseScreen() {
    showOverlay(`
      <div class="panel">
        <h2>PAUSED</h2>
        <div class="btnrow vert">
          <button class="btn primary" id="resume">再開</button>
          <button class="btn" id="quit">タイトルへ</button>
        </div>
        <div class="opts">
          <label class="opt">BGM <input type="range" id="v-bgm" min="0" max="1" step="0.05"></label>
          <label class="opt">SE <input type="range" id="v-sfx" min="0" max="1" step="0.05"></label>
          <label class="opt"><input type="checkbox" id="v-mute"> ミュート</label>
        </div>
      </div>`);
    const s = NEON.Audio.getSettings();
    document.getElementById("v-bgm").value = s.bgmVol;
    document.getElementById("v-sfx").value = s.sfxVol;
    document.getElementById("v-mute").checked = s.muteAll;
    document.getElementById("v-bgm").addEventListener("input", e => NEON.Audio.setSettings({ bgmVol: +e.target.value }));
    document.getElementById("v-sfx").addEventListener("input", e => NEON.Audio.setSettings({ sfxVol: +e.target.value }));
    document.getElementById("v-mute").addEventListener("change", e => NEON.Audio.setSettings({ muteAll: e.target.checked }));
    document.getElementById("resume").addEventListener("click", () => { hideOverlay(); G.setState("playing"); });
    document.getElementById("quit").addEventListener("click", () => titleScreen());
  }

  function stageClearScreen(nextIdx, score) {
    showOverlay(`
      <div class="panel">
        <h2>STAGE CLEAR</h2>
        <p class="score">SCORE ${String(score).padStart(7,"0")}</p>
        <button class="btn primary" id="next">次のステージへ ▶</button>
      </div>`);
    document.getElementById("next").addEventListener("click", () => {
      hideOverlay(); G.nextStage();
      showBanner(NEON.stages[G.getStageIndex()].name, 2.2);
    });
  }

  function endScreen(title, score) {
    showOverlay(`
      <div class="panel">
        <h2 class="${title === 'YOU WIN' ? 'win' : 'over'}">${title}</h2>
        <p class="score">SCORE ${String(score).padStart(7,"0")}</p>
        <div class="hs"><h3>HIGH SCORES</h3>${hiScoreHtml()}</div>
        <button class="btn primary" id="retry">タイトルへ戻る</button>
      </div>`);
    document.getElementById("retry").addEventListener("click", () => titleScreen());
  }

  // ---- コールバック配線 ----
  const callbacks = {
    onHud: updateHud,
    onBoss: (name) => showBanner("⚠ WARNING\n" + name, 2.4),
    onStageClear: (idx, score) => stageClearScreen(idx, score),
    onGameOver: (score) => endScreen("GAME OVER", score),
    onWin: (score) => endScreen("YOU WIN", score),
  };

  // ---- 起動 ----
  G.init(canvas, callbacks);
  resize();
  titleScreen();

  // タッチUIは coarse pointer（指）環境で表示
  if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
    touchControls.hidden = false;
  }
  NEON.Input.attach(canvas);

  // ポーズのトグル（キー/ボタン）
  document.getElementById("btn-pause").addEventListener("click", () => togglePause());
  function togglePause() {
    const st = G.getState();
    if (st === "playing") { G.setState("paused"); pauseScreen(); }
    else if (st === "paused") { hideOverlay(); G.setState("playing"); }
  }

  // ---- 固定タイムステップ・ゲームループ ----
  const STEP = 1000 / 60;
  let last = performance.now(), acc = 0;
  let fps = 60, fpsT = 0, fpsC = 0;

  function frame(now) {
    let delta = now - last; last = now;
    if (delta > 250) delta = 250; // タブ復帰時の暴走防止
    acc += delta;

    // ポーズ入力（エッジ）
    if (NEON.Input.state.pauseEdge) { NEON.Input.clearEdges(); togglePause(); }

    while (acc >= STEP) {
      const dt = STEP / 1000;
      G.update(dt);
      G.collide();
      acc -= STEP;
      if (bannerTimer > 0) {
        bannerTimer -= dt;
        if (bannerTimer <= 0) elBanner.classList.remove("show");
      }
    }
    G.render();

    // FPS計測（デバッグHUD）
    fpsC++; fpsT += delta;
    if (fpsT >= 500) { fps = Math.round(fpsC * 1000 / fpsT); fpsC = 0; fpsT = 0;
      if (G.isDebug()) document.getElementById("fps").textContent = "FPS " + fps;
    }
    requestAnimationFrame(frame);
  }

  // タブ非表示でBGM停止（復帰で自然再開）
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && G.getState() === "playing") { G.setState("paused"); pauseScreen(); }
  });

  // グローバルエラーは画面に表示（デバッグ）
  window.addEventListener("error", (e) => {
    if (G.isDebug()) {
      const d = document.getElementById("fps");
      if (d) d.textContent = "ERR: " + e.message;
    }
  });

  if (G.isDebug()) document.getElementById("debug-hud").hidden = false;

  requestAnimationFrame(frame);
})();
