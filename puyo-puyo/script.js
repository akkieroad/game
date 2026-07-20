(() => {
  const COLS = 6;
  const ROWS = 12; // visible rows
  const HIDDEN_ROWS = 1; // buffer rows above visible field for spawning
  const TOTAL_ROWS = ROWS + HIDDEN_ROWS;
  const CELL = 40;

  const COLORS = ["#ff5b6a", "#4fd67a", "#4aa8ff", "#ffd23f"]; // red, green, blue, yellow

  const boardCanvas = document.getElementById("board");
  const ctx = boardCanvas.getContext("2d");
  const nextCanvas = document.getElementById("next");
  const nextCtx = nextCanvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const overlayEl = document.getElementById("overlay");
  const overlayTitleEl = document.getElementById("overlay-title");
  const restartBtn = document.getElementById("restart-btn");
  const pauseBtn = document.getElementById("pause-btn");
  const chainPopupEl = document.getElementById("chain-popup");

  // board[row][col] = color index or null. row 0 is hidden buffer row.
  let board = [];
  let score = 0;
  let current = null; // {axis:{r,c}, child:{r,c}, colorA, colorB, orientation}
  let nextPair = null;
  let dropTimer = 0;
  let dropInterval = 700;
  let softDrop = false;
  let gameOver = false;
  let paused = false;
  let resolving = false;
  let lastTime = 0;

  function makeEmptyBoard() {
    const b = [];
    for (let r = 0; r < TOTAL_ROWS; r++) {
      b.push(new Array(COLS).fill(null));
    }
    return b;
  }

  function randColor() {
    return Math.floor(Math.random() * COLORS.length);
  }

  function makePair() {
    return {
      colorA: randColor(), // axis
      colorB: randColor(), // child
    };
  }

  function spawnPair() {
    const p = nextPair || makePair();
    nextPair = makePair();
    drawNext();

    current = {
      axisR: HIDDEN_ROWS, // row index 1 (first visible row)
      axisC: 2,
      orientation: 0, // 0=child above, 1=child right, 2=child below, 3=child left
      colorA: p.colorA,
      colorB: p.colorB,
    };

    const childPos = getChildPos(current);
    if (
      isOccupied(current.axisR, current.axisC) ||
      isOccupied(childPos.r, childPos.c)
    ) {
      triggerGameOver();
    }
  }

  function getChildPos(pair) {
    const dirs = [
      { dr: -1, dc: 0 }, // up
      { dr: 0, dc: 1 },  // right
      { dr: 1, dc: 0 },  // down
      { dr: 0, dc: -1 }, // left
    ];
    const d = dirs[pair.orientation];
    return { r: pair.axisR + d.dr, c: pair.axisC + d.dc };
  }

  function inBounds(r, c) {
    return r >= 0 && r < TOTAL_ROWS && c >= 0 && c < COLS;
  }

  function isOccupied(r, c) {
    if (!inBounds(r, c)) return true;
    return board[r][c] !== null;
  }

  function canPlace(axisR, axisC, orientation) {
    const dirs = [
      { dr: -1, dc: 0 },
      { dr: 0, dc: 1 },
      { dr: 1, dc: 0 },
      { dr: 0, dc: -1 },
    ];
    const d = dirs[orientation];
    const cr = axisR + d.dr;
    const cc = axisC + d.dc;
    if (isOccupied(axisR, axisC)) return false;
    if (isOccupied(cr, cc)) return false;
    return true;
  }

  function tryMove(dc) {
    if (!current || resolving || gameOver || paused) return;
    const newC = current.axisC + dc;
    if (canPlace(current.axisR, newC, current.orientation)) {
      current.axisC = newC;
    }
  }

  function tryRotate(dir) {
    if (!current || resolving || gameOver || paused) return;
    const newOrientation = (current.orientation + dir + 4) % 4;

    // try direct rotation
    if (canPlace(current.axisR, current.axisC, newOrientation)) {
      current.orientation = newOrientation;
      return;
    }
    // wall kicks: try shifting axis left/right/up
    const kicks = [1, -1, -2, 2];
    for (const k of kicks) {
      if (canPlace(current.axisR, current.axisC + k, newOrientation)) {
        current.axisC += k;
        current.orientation = newOrientation;
        return;
      }
    }
    // try shifting up (for down-facing rotations near floor)
    if (canPlace(current.axisR - 1, current.axisC, newOrientation)) {
      current.axisR -= 1;
      current.orientation = newOrientation;
    }
  }

  function tryDrop(hard) {
    if (!current || resolving || gameOver || paused) return;
    if (hard) {
      while (canPlace(current.axisR + 1, current.axisC, current.orientation)) {
        current.axisR += 1;
        score += 2;
      }
      lockPair();
    } else {
      if (canPlace(current.axisR + 1, current.axisC, current.orientation)) {
        current.axisR += 1;
        dropTimer = 0;
      } else {
        lockPair();
      }
    }
  }

  function lockPair() {
    const childPos = getChildPos(current);
    board[current.axisR][current.axisC] = current.colorA;
    board[childPos.r][childPos.c] = current.colorB;
    current = null;
    resolving = true;
    resolveChains();
  }

  function applyGravity() {
    let moved = false;
    for (let c = 0; c < COLS; c++) {
      const stack = [];
      for (let r = TOTAL_ROWS - 1; r >= 0; r--) {
        if (board[r][c] !== null) stack.push(board[r][c]);
      }
      for (let r = TOTAL_ROWS - 1; r >= 0; r--) {
        const val = stack.length > 0 ? stack.shift() : null;
        if (board[r][c] !== val) moved = true;
        board[r][c] = val;
      }
    }
    return moved;
  }

  function findGroups() {
    const visited = Array.from({ length: TOTAL_ROWS }, () => new Array(COLS).fill(false));
    const groups = [];
    for (let r = HIDDEN_ROWS; r < TOTAL_ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] === null || visited[r][c]) continue;
        const color = board[r][c];
        const stack = [{ r, c }];
        const group = [];
        visited[r][c] = true;
        while (stack.length) {
          const cur = stack.pop();
          group.push(cur);
          const neighbors = [
            { r: cur.r - 1, c: cur.c },
            { r: cur.r + 1, c: cur.c },
            { r: cur.r, c: cur.c - 1 },
            { r: cur.r, c: cur.c + 1 },
          ];
          for (const n of neighbors) {
            if (
              n.r >= HIDDEN_ROWS &&
              n.r < TOTAL_ROWS &&
              n.c >= 0 &&
              n.c < COLS &&
              !visited[n.r][n.c] &&
              board[n.r][n.c] === color
            ) {
              visited[n.r][n.c] = true;
              stack.push(n);
            }
          }
        }
        if (group.length >= 4) groups.push({ color, cells: group });
      }
    }
    return groups;
  }

  const CHAIN_BONUS = [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480];
  const GROUP_BONUS = [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 10, 10, 10, 10, 10, 10];
  const COLOR_BONUS = [0, 0, 3, 6, 12, 24];

  let chainCount = 0;

  function resolveChains() {
    chainCount = 0;
    step();
  }

  function step() {
    applyGravity();
    const groups = findGroups();
    if (groups.length === 0) {
      resolving = false;
      chainCount = 0;
      checkGameOverAndSpawn();
      return;
    }

    chainCount++;
    let totalCleared = 0;
    const colorsUsed = new Set();
    let groupBonusSum = 0;

    for (const g of groups) {
      totalCleared += g.cells.length;
      colorsUsed.add(g.color);
      const gbIndex = Math.min(g.cells.length, GROUP_BONUS.length - 1);
      groupBonusSum += GROUP_BONUS[gbIndex];
      for (const cell of g.cells) {
        board[cell.r][cell.c] = null;
      }
    }

    const chainBonus = CHAIN_BONUS[Math.min(chainCount - 1, CHAIN_BONUS.length - 1)];
    const colorBonus = COLOR_BONUS[Math.min(colorsUsed.size, COLOR_BONUS.length - 1)];
    let multiplier = chainBonus + colorBonus + groupBonusSum;
    if (multiplier <= 0) multiplier = 1;
    const gained = totalCleared * 10 * multiplier;
    score += gained;
    updateScore();

    if (chainCount > 1) {
      showChainPopup(chainCount);
    }

    // slight delay to let player see the pop before next gravity step
    setTimeout(() => {
      step();
    }, 260);
  }

  function showChainPopup(n) {
    chainPopupEl.textContent = `${n} れんさ!`;
    chainPopupEl.classList.remove("hidden");
    // restart animation
    chainPopupEl.style.animation = "none";
    void chainPopupEl.offsetWidth;
    chainPopupEl.style.animation = "";
    setTimeout(() => {
      chainPopupEl.classList.add("hidden");
    }, 600);
  }

  function checkGameOverAndSpawn() {
    // if any puyo occupies hidden rows, game over
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < HIDDEN_ROWS; r++) {
        if (board[r][c] !== null) {
          triggerGameOver();
          return;
        }
      }
    }
    spawnPair();
  }

  function triggerGameOver() {
    gameOver = true;
    overlayTitleEl.textContent = "GAME OVER";
    overlayEl.classList.remove("hidden");
  }

  function updateScore() {
    scoreEl.textContent = score.toString();
  }

  function resetGame() {
    board = makeEmptyBoard();
    score = 0;
    updateScore();
    gameOver = false;
    resolving = false;
    paused = false;
    pauseBtn.textContent = "一時停止";
    dropInterval = 700;
    overlayEl.classList.add("hidden");
    nextPair = makePair();
    spawnPair();
  }

  // ---------- Drawing ----------

  function drawPuyo(context, x, y, size, colorIdx) {
    const r = size / 2 - 2;
    const cx = x + size / 2;
    const cy = y + size / 2;
    const grad = context.createRadialGradient(cx - r / 3, cy - r / 3, r / 6, cx, cy, r);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.15, COLORS[colorIdx]);
    grad.addColorStop(1, COLORS[colorIdx]);
    context.beginPath();
    context.arc(cx, cy, r, 0, Math.PI * 2);
    context.fillStyle = grad;
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = "rgba(0,0,0,0.25)";
    context.stroke();

    // eyes
    context.fillStyle = "#20202a";
    context.beginPath();
    context.arc(cx - r * 0.32, cy - r * 0.1, r * 0.13, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.arc(cx + r * 0.32, cy - r * 0.1, r * 0.13, 0, Math.PI * 2);
    context.fill();
  }

  function drawBoard() {
    ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);

    // grid background
    ctx.fillStyle = "#0d0e24";
    ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);

    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * CELL, 0);
      ctx.lineTo(c * CELL, ROWS * CELL);
      ctx.stroke();
    }
    for (let r = 0; r <= ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * CELL);
      ctx.lineTo(COLS * CELL, r * CELL);
      ctx.stroke();
    }

    // settled puyos
    for (let r = HIDDEN_ROWS; r < TOTAL_ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const val = board[r][c];
        if (val !== null) {
          drawPuyo(ctx, c * CELL, (r - HIDDEN_ROWS) * CELL, CELL, val);
        }
      }
    }

    // current falling pair
    if (current) {
      const childPos = getChildPos(current);
      drawPuyo(ctx, current.axisC * CELL, (current.axisR - HIDDEN_ROWS) * CELL, CELL, current.colorA);
      if (childPos.r >= HIDDEN_ROWS) {
        drawPuyo(ctx, childPos.c * CELL, (childPos.r - HIDDEN_ROWS) * CELL, CELL, current.colorB);
      }
    }

    if (paused && !gameOver) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
      ctx.fillStyle = "#ffe066";
      ctx.font = "bold 22px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("PAUSE", boardCanvas.width / 2, boardCanvas.height / 2);
    }
  }

  function drawNext() {
    nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    nextCtx.fillStyle = "#0d0e24";
    nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (!nextPair) return;
    const size = 40;
    const x = (nextCanvas.width - size) / 2;
    drawPuyo(nextCtx, x, 70, size, nextPair.colorB);
    drawPuyo(nextCtx, x, 30, size, nextPair.colorA);
  }

  // ---------- Game loop ----------

  function loop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const dt = timestamp - lastTime;
    lastTime = timestamp;

    if (!gameOver && !paused && !resolving && current) {
      dropTimer += dt;
      const interval = softDrop ? Math.min(dropInterval, 50) : dropInterval;
      if (dropTimer >= interval) {
        dropTimer = 0;
        tryDrop(false);
      }
    }

    drawBoard();
    requestAnimationFrame(loop);
  }

  // ---------- Input ----------

  document.addEventListener("keydown", (e) => {
    if (gameOver) return;
    switch (e.key) {
      case "ArrowLeft":
        tryMove(-1);
        e.preventDefault();
        break;
      case "ArrowRight":
        tryMove(1);
        e.preventDefault();
        break;
      case "ArrowDown":
        softDrop = true;
        e.preventDefault();
        break;
      case "ArrowUp":
      case "x":
      case "X":
        if (!e.repeat) tryRotate(1);
        e.preventDefault();
        break;
      case "z":
      case "Z":
        if (!e.repeat) tryRotate(-1);
        e.preventDefault();
        break;
      case " ":
        if (!e.repeat) tryDrop(true);
        e.preventDefault();
        break;
      case "p":
      case "P":
        if (!e.repeat) togglePause();
        break;
    }
  });

  document.addEventListener("keyup", (e) => {
    if (e.key === "ArrowDown") softDrop = false;
  });

  function togglePause() {
    if (gameOver) return;
    paused = !paused;
    pauseBtn.textContent = paused ? "再開する" : "一時停止";
  }

  pauseBtn.addEventListener("click", togglePause);
  restartBtn.addEventListener("click", resetGame);

  // speed up over time
  setInterval(() => {
    if (!gameOver && dropInterval > 200) {
      dropInterval -= 15;
    }
  }, 10000);

  resetGame();
  requestAnimationFrame(loop);
})();
