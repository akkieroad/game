/* =========================================================================
 * input.js — キーボード / マウス / タッチ / ゲームパッドを共通コマンドに正規化
 * 出力: NEON.Input.state = { moveX, moveY, aimX, aimY, fire, boost, bomb, pause }
 * ========================================================================= */
window.NEON = window.NEON || {};

NEON.Input = (function () {
  const state = {
    moveX: 0, moveY: 0,      // -1..1 相対移動（キーボード/パッド用）
    pointerActive: false,     // ポインタ追従中か（マウス/タッチ）
    pointerX: 0, pointerY: 0, // 論理座標での目標位置
    fire: false,
    boostEdge: false,         // このフレームで押された（エッジ）
    bombEdge: false,
    pauseEdge: false,
  };

  const keys = new Set();
  let canvas = null, view = null; // view: {scale, offsetX, offsetY} for coord mapping

  // タッチUIボタン押下フラグ
  const touchBtn = { boost: false, bomb: false };

  function setView(v) { view = v; }

  function screenToLogical(clientX, clientY) {
    if (!canvas || !view) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left - view.offsetX) / view.scale;
    const y = (clientY - rect.top - view.offsetY) / view.scale;
    return { x, y };
  }

  function attach(canvasEl) {
    canvas = canvasEl;

    // --- キーボード ---
    window.addEventListener("keydown", (e) => {
      if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key)) e.preventDefault();
      if (keys.has(e.code)) return; // リピート無視（エッジ検出のため）
      keys.add(e.code);
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") state.boostEdge = true;
      if (e.code === "KeyX") state.bombEdge = true;
      if (e.code === "KeyP" || e.code === "Escape") state.pauseEdge = true;
    });
    window.addEventListener("keyup", (e) => keys.delete(e.code));

    // --- ポインタ（マウス＋タッチ統一） ---
    canvas.addEventListener("pointerdown", (e) => {
      NEON.Audio.unlock();
      state.pointerActive = true;
      const p = screenToLogical(e.clientX, e.clientY);
      state.pointerX = p.x; state.pointerY = p.y;
      if (e.button === 2) state.boostEdge = true; // 右クリックでブースト
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!state.pointerActive) return;
      const p = screenToLogical(e.clientX, e.clientY);
      state.pointerX = p.x; state.pointerY = p.y;
    });
    const release = () => { state.pointerActive = false; };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("pointerleave", release);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // --- タッチUIボタン ---
    bindHold("btn-boost", () => { state.boostEdge = true; touchBtn.boost = true; }, () => touchBtn.boost = false);
    bindHold("btn-bomb", () => { state.bombEdge = true; }, () => {});
  }

  function bindHold(id, onDown, onUp) {
    const el = document.getElementById(id);
    if (!el) return;
    const down = (e) => { e.preventDefault(); NEON.Audio.unlock(); onDown(); };
    const up = (e) => { e.preventDefault(); onUp(); };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  // 毎フレーム呼び出し：連続入力を state に反映
  function poll() {
    // キーボード移動
    let mx = 0, my = 0;
    if (keys.has("ArrowLeft") || keys.has("KeyA")) mx -= 1;
    if (keys.has("ArrowRight") || keys.has("KeyD")) mx += 1;
    if (keys.has("ArrowUp") || keys.has("KeyW")) my -= 1;
    if (keys.has("ArrowDown") || keys.has("KeyS")) my += 1;

    // 連射：Z / Space / ポインタ押下 / タッチ既定ON
    state.fire = keys.has("KeyZ") || keys.has("Space") || state.pointerActive;

    // ゲームパッド
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      if (Math.abs(ax) > 0.2) mx += ax;
      if (Math.abs(ay) > 0.2) my += ay;
      if (pad.buttons[12] && pad.buttons[12].pressed) my -= 1;
      if (pad.buttons[13] && pad.buttons[13].pressed) my += 1;
      if (pad.buttons[14] && pad.buttons[14].pressed) mx -= 1;
      if (pad.buttons[15] && pad.buttons[15].pressed) mx += 1;
      if (pad.buttons[0] && pad.buttons[0].pressed) state.fire = true; // A
      if (pad.buttons[5] && pad.buttons[5].pressed) state.boostEdge = true; // RB
      if (pad.buttons[1] && pad.buttons[1].pressed) state.bombEdge = true; // B
    }

    // 正規化
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    state.moveX = mx; state.moveY = my;
    return state;
  }

  // エッジフラグは消費後にクリアする
  function clearEdges() {
    state.boostEdge = false;
    state.bombEdge = false;
    state.pauseEdge = false;
  }

  return { state, attach, poll, clearEdges, setView };
})();
