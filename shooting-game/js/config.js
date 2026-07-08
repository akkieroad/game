/* =========================================================================
 * config.js — ゲーム定数・難易度プリセット・ステージデータ
 * すべてグローバル NEON.config に格納（クラシックスクリプト構成）
 * ここを書き換えるだけでバランス調整が可能（コード変更不要）
 * ========================================================================= */
window.NEON = window.NEON || {};

NEON.config = {
  // 論理解像度（内部座標系）。表示はこの比率を保ったままスケールする
  W: 480,
  H: 800,

  player: {
    speed: 320,          // px/秒
    radius: 12,          // 描画半径
    hitRadius: 5,        // 食らい判定（機体より小さく＝理不尽さ軽減）
    fireInterval: 0.13,  // 連射間隔（秒）
    bulletSpeed: 640,
    lives: 3,
    shield: 2,           // 各機のシールド（吸収ヒット数）
    invulnTime: 1.6,     // 被弾後の無敵時間（秒）
    bombs: 2,
    boostDuration: 0.35, // ドリフト・ブースト持続
    boostCooldown: 2.0,
    boostSpeedMul: 2.4,
  },

  scoring: {
    chainWindow: 1.5,    // この秒数撃破が途切れると倍率リセット
    chainMax: 8,         // 最大倍率
    grazeRadius: 26,     // かすり判定距離
    grazeScore: 15,
    grazeBoost: 0.18,    // グレイズ時のブーストゲージ回復量
  },

  difficulty: {
    // DDA: 直近パフォーマンスに応じて 0.75〜1.5 の係数で敵密度/弾速を調整
    min: 0.75,
    max: 1.5,
    adjustUp: 0.06,      // 好調時に上げる量
    adjustDown: 0.12,    // 被弾時に下げる量
    presets: { EASY: 0.8, NORMAL: 1.0, HARD: 1.25 },
  },

  limits: {
    enemyBullets: 400,
    particles: 500,
  },
};

/* -------------------------------------------------------------------------
 * ステージ・タイムライン（データ駆動）
 * t   : ステージ開始からの経過秒（この時刻に湧く）
 * type: 敵種別 straight | sine | homing | turret
 * x   : 出現X（0〜1 の相対値。省略時ランダム）
 * n   : 出現数（省略時1）
 * gap : n体を撒く間隔（秒, 省略0.4）
 * ------------------------------------------------------------------------- */
NEON.stages = [
  {
    name: "STAGE 1 — AWAKENING",
    bg: "#0a0e27",
    boss: { hp: 60, name: "GATEKEEPER" },
    waves: [
      { t: 1.0, type: "straight", x: 0.5, n: 5, gap: 0.35 },
      { t: 4.0, type: "straight", x: 0.2, n: 4, gap: 0.3 },
      { t: 4.5, type: "straight", x: 0.8, n: 4, gap: 0.3 },
      { t: 8.0, type: "sine", n: 6, gap: 0.4 },
      { t: 13.0, type: "turret", x: 0.15, n: 1 },
      { t: 13.0, type: "turret", x: 0.85, n: 1 },
      { t: 15.0, type: "straight", n: 8, gap: 0.25 },
    ],
  },
  {
    name: "STAGE 2 — SURGE",
    bg: "#12082a",
    boss: { hp: 90, name: "PRISM CORE" },
    waves: [
      { t: 1.0, type: "sine", n: 6, gap: 0.3 },
      { t: 5.0, type: "homing", n: 2, gap: 0.6 },
      { t: 7.0, type: "straight", x: 0.5, n: 6, gap: 0.25 },
      { t: 10.0, type: "turret", x: 0.5, n: 1 },
      { t: 11.0, type: "sine", n: 8, gap: 0.3 },
      { t: 16.0, type: "homing", n: 3, gap: 0.5 },
    ],
  },
  {
    name: "STAGE 3 — OVERDRIVE",
    bg: "#1a0620",
    boss: { hp: 130, name: "NOVA WARDEN" },
    waves: [
      { t: 1.0, type: "straight", n: 10, gap: 0.2 },
      { t: 4.0, type: "turret", x: 0.2, n: 1 },
      { t: 4.0, type: "turret", x: 0.8, n: 1 },
      { t: 6.0, type: "homing", n: 3, gap: 0.4 },
      { t: 9.0, type: "sine", n: 10, gap: 0.25 },
      { t: 14.0, type: "homing", n: 4, gap: 0.4 },
      { t: 16.0, type: "turret", x: 0.5, n: 1 },
    ],
  },
];
