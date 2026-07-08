/* =========================================================================
 * audio.js — Web Audio によるプロシージャルSE/BGM（アセットファイル不要）
 * すべての効果音を実行時に合成するため、外部音声ファイルへの依存が無い。
 * = file:// でも即動作し、プリロードも不要。
 * ========================================================================= */
window.NEON = window.NEON || {};

NEON.Audio = (function () {
  let ctx = null;
  let master = null, bgmGain = null, sfxGain = null;
  let bgmTimer = null;
  let settings = { muteAll: false, bgmVol: 0.35, sfxVol: 0.5 };

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    bgmGain = ctx.createGain();
    sfxGain = ctx.createGain();
    bgmGain.connect(master);
    sfxGain.connect(master);
    master.connect(ctx.destination);
    applyVolumes();
  }

  // モバイル等の自動再生制限対策：ユーザー操作後に呼ぶ
  function unlock() {
    init();
    if (ctx.state === "suspended") ctx.resume();
  }

  function applyVolumes() {
    if (!ctx) return;
    master.gain.value = settings.muteAll ? 0 : 1;
    bgmGain.gain.value = settings.bgmVol;
    sfxGain.gain.value = settings.sfxVol;
  }

  function setSettings(s) {
    Object.assign(settings, s);
    applyVolumes();
  }
  function getSettings() { return Object.assign({}, settings); }

  // 汎用トーン合成
  function tone(freq, dur, type, vol, slideTo) {
    if (!ctx || settings.muteAll) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // ノイズバースト（爆発・被弾に使用）
  function noise(dur, vol, filterFreq) {
    if (!ctx || settings.muteAll) return;
    const t0 = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const flt = ctx.createBiquadFilter();
    flt.type = "lowpass";
    flt.frequency.setValueAtTime(filterFreq || 1200, t0);
    flt.frequency.exponentialRampToValueAtTime(200, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.4, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt).connect(g).connect(sfxGain);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // ---- 効果音プリセット ----
  const sfx = {
    shot: () => tone(880, 0.06, "square", 0.08, 620),
    explode: () => { noise(0.35, 0.5, 1600); tone(140, 0.3, "sawtooth", 0.2, 40); },
    hit: () => { noise(0.4, 0.6, 800); tone(90, 0.4, "square", 0.3, 30); },
    chain: (level) => tone(520 + level * 60, 0.09, "triangle", 0.15),
    graze: () => tone(1400, 0.04, "sine", 0.06),
    bomb: () => { noise(0.8, 0.7, 3000); tone(200, 0.7, "sawtooth", 0.3, 30); },
    bossWarn: () => { tone(320, 0.5, "sawtooth", 0.25, 320); },
    powerup: () => { tone(660, 0.1, "triangle", 0.2); setTimeout(() => tone(990, 0.12, "triangle", 0.2), 90); },
    stageClear: () => {
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.18, "triangle", 0.2), i * 120));
    },
  };
  function play(name, arg) { if (sfx[name]) sfx[name](arg); }

  // ---- シンプルなアルペジオBGM（プロシージャル） ----
  const scales = [
    [220, 277, 330, 440, 330, 277],   // stage1
    [246, 311, 370, 493, 370, 311],   // stage2
    [196, 261, 329, 392, 329, 261],   // stage3
  ];
  function startBGM(stageIndex) {
    stopBGM();
    if (!ctx) return;
    const notes = scales[stageIndex % scales.length];
    let i = 0;
    bgmTimer = setInterval(() => {
      if (settings.muteAll) return;
      const t0 = ctx.currentTime;
      const f = notes[i % notes.length];
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      osc.connect(g).connect(bgmGain);
      osc.start(t0); osc.stop(t0 + 0.25);
      // ベース
      if (i % 2 === 0) {
        const b = ctx.createOscillator(), bg = ctx.createGain();
        b.type = "sawtooth"; b.frequency.value = f / 2;
        bg.gain.setValueAtTime(0.12, t0);
        bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
        b.connect(bg).connect(bgmGain);
        b.start(t0); b.stop(t0 + 0.42);
      }
      i++;
    }, 200);
  }
  function stopBGM() { if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; } }

  return { init, unlock, play, startBGM, stopBGM, setSettings, getSettings };
})();
