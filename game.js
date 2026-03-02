/**
 * 花粉駆逐 (MVP) - ゲームロジック
 */

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const stageNumEl = document.getElementById('stage-num');
const gaugeUnits = document.querySelectorAll('.gauge-unit');
const invIndicator = document.getElementById('invincible-indicator');
const overlayStart = document.getElementById('overlay-start');
const overlayPause = document.getElementById('overlay-pause');
const overlayMessage = document.getElementById('overlay-message');
const resultTitle = document.getElementById('result-title');
const messageEl = document.getElementById('message');
const actionBtn = document.getElementById('action-button');

// ゲーム設定
const SETTINGS = {
    heroSize: 48, // 表示サイズ（ピクセル）
    playerRadiusScale: 0.45, // min(w, h) * 0.45
    pollenRadius: 4, // P0: 大幅に小型化
    treeSize: 80, // ボスの表示サイズ（現状の木と同程度から+10~20%を反映）
    treeRadiusScale: 0.38, // 当たり判定のスケール（見た目より少し小さめ）
    speed: {
        hero: 6,
        pollenBase: 1.8 // P0: 2.5 -> 1.8 (約72%)
    },
    spawnSafetyMargin: 180, // プレイヤーからの最低距離を拡大
    invincibleDuration: 1000,
    maxGauge: 1, // P0: 1ヒット即死
    stages: [
        { pollenCount: 12, pollenSpeed: 1.8 }, // ステージ1の大幅減速
        { pollenCount: 22, pollenSpeed: 2.5 }, // 段階的な上昇
        { pollenCount: 35, pollenSpeed: 3.5 }
    ]
};

// 画像の読み込み
const heroImg = new Image();
heroImg.src = 'ax.png';

const treeImg = new Image();
treeImg.src = 'tree.png';

// ゲーム状態
let state = {
    currentStage: 0,
    gauge: 0,
    isGameOver: false,
    isCleared: false,
    isPaused: false, // P1: 一時停止状態
    isInvincible: false,
    invincibleTimer: 0,
    running: false,
    hero: { x: 0, y: 0 },
    tree: { x: 0, y: 0 },
    pollens: [],
    input: {
        up: false,
        down: false,
        left: false,
        right: false,
        lastDir: null
    }
};

// プレイヤーの現在の当たり判定半径を取得
function getHeroRadius() {
    return SETTINGS.heroSize * SETTINGS.playerRadiusScale;
}

// 花粉樹（ボス）の当たり判定半径を取得
function getTreeRadius() {
    return SETTINGS.treeSize * SETTINGS.treeRadiusScale;
}

// キャンバスのリサイズ
function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // ゲーム領域がまだ設定されていない場合（初回リサイズ時など）
    if (!state.running && !state.isGameOver && !state.isCleared) {
        initPosition();
    }
}

window.addEventListener('resize', resize);
setTimeout(resize, 0);

// 初期位置設定
function initPosition() {
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);

    state.hero = {
        x: width / 2,
        y: height * 0.8
    };

    state.tree = {
        x: width / 2,
        y: height * 0.15
    };

    initPollens(width, height);
}

// 花粉の初期化
function initPollens(width, height) {
    const config = SETTINGS.stages[state.currentStage];
    state.pollens = [];

    for (let i = 0; i < config.pollenCount; i++) {
        let x, y, dist;
        do {
            x = Math.random() * (width - SETTINGS.pollenRadius * 2) + SETTINGS.pollenRadius;
            y = Math.random() * (height - SETTINGS.pollenRadius * 2) + SETTINGS.pollenRadius;
            dist = Math.hypot(x - state.hero.x, y - state.hero.y);
        } while (dist < SETTINGS.spawnSafetyMargin);

        const angle = Math.random() * Math.PI * 2;
        state.pollens.push({
            x, y,
            vx: Math.cos(angle) * config.pollenSpeed,
            vy: Math.sin(angle) * config.pollenSpeed
        });
    }
}

// 入力設定 (Pointer Events)
function setupInputs() {
    const buttons = document.querySelectorAll('.control-btn');

    buttons.forEach(btn => {
        const dir = btn.dataset.dir;

        btn.addEventListener('pointerdown', (e) => {
            if (state.isPaused) return; // ポーズ中は無効
            e.preventDefault();
            // 一旦すべての入力をリセットしてから最新をセット（最後押し優先）
            // 仕様に合わせて "最後に押した方向を優先" するため
            state.input.up = false;
            state.input.down = false;
            state.input.left = false;
            state.input.right = false;

            state.input[dir] = true;
            state.input.lastDir = dir;
        });

        // 共通の停止処理
        const stop = (e) => {
            if (state.input.lastDir === dir) {
                state.input[dir] = false;
                state.input.lastDir = null;
            }
        };

        btn.addEventListener('pointerup', stop);
        btn.addEventListener('pointercancel', stop);
        // pointerleave は明示的に要件により除外（ボタンからズレても継続）
    });

    document.getElementById('start-button').addEventListener('click', startGame);
    actionBtn.addEventListener('click', handleAction);

    // ポーズ関連 (中央ボタンに集約)
    document.getElementById('pause-btn').addEventListener('click', togglePause);
}

function togglePause() {
    // 実行中またはポーズ中のみ切り替え可能
    if (!state.running && !state.isPaused) return;

    // 入力の完全リセット (P0: 勝手に動く問題の防止)
    resetInput();

    const pauseBtn = document.getElementById('pause-btn');
    state.isPaused = !state.isPaused;

    if (state.isPaused) {
        state.running = false;
        pauseBtn.textContent = '▶'; // ポーズ時は再開ボタンに
        overlayPause.classList.remove('hidden');
    } else {
        state.running = true;
        pauseBtn.textContent = 'II'; // 通常時はポーズボタンに
        overlayPause.classList.add('hidden');
        requestAnimationFrame(gameLoop);
    }
}

// 入力リセット
function resetInput() {
    state.input.up = false;
    state.input.down = false;
    state.input.left = false;
    state.input.right = false;
    state.input.lastDir = null;
}

function startGame() {
    overlayStart.classList.add('hidden');
    state.running = true;
    state.gauge = 0;
    state.currentStage = 0;
    document.getElementById('pause-btn').textContent = 'II';
    resetInput();
    updateUI();
    resetStage();
    requestAnimationFrame(gameLoop);
}

function handleAction() {
    document.getElementById('pause-btn').textContent = 'II';
    if (state.isGameOver) {
        // リトライ
        state.currentStage = 0;
        state.gauge = 0;
        resetInput();
        resetStage();
        state.isGameOver = false;
        overlayMessage.classList.add('hidden');
        state.running = true;
        requestAnimationFrame(gameLoop);
    } else if (state.isCleared) {
        if (state.currentStage < SETTINGS.stages.length - 1) {
            // 次のステージ
            state.currentStage++;
            resetInput();
            resetStage();
            state.isCleared = false;
            overlayMessage.classList.add('hidden');
            state.running = true;
            requestAnimationFrame(gameLoop);
        } else {
            // 全クリア
            startGame(); // 最初から
        }
    }
}

function resetStage() {
    initPosition();
    state.isInvincible = true;
    state.invincibleTimer = Date.now();
    invIndicator.style.opacity = '1';
    updateUI();
}

// ウィンドウフォーカス喪失時などのリセット
window.addEventListener('blur', resetInput);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) resetInput();
});

function updateUI() {
    stageNumEl.textContent = state.currentStage + 1;
    gaugeUnits.forEach((unit, idx) => {
        unit.classList.toggle('active', idx < state.gauge);
    });
}

// メインループ
function gameLoop() {
    if (!state.running) return;

    update();
    draw();

    requestAnimationFrame(gameLoop);
}

function update() {
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);
    const heroRadius = getHeroRadius();

    // 無敵タイマー
    if (state.isInvincible && Date.now() - state.invincibleTimer > SETTINGS.invincibleDuration) {
        state.isInvincible = false;
        invIndicator.style.opacity = '0';
    }

    // 主人公移動
    if (state.input.up) state.hero.y -= SETTINGS.speed.hero;
    if (state.input.down) state.hero.y += SETTINGS.speed.hero;
    if (state.input.left) state.hero.x -= SETTINGS.speed.hero;
    if (state.input.right) state.hero.x += SETTINGS.speed.hero;

    // 画面外ブロック（見た目の端ではなく、中心座標の制限として heroRadius を使用）
    state.hero.x = Math.max(heroRadius, Math.min(width - heroRadius, state.hero.x));
    state.hero.y = Math.max(heroRadius, Math.min(height - heroRadius, state.hero.y));

    // 花粉移動と反射
    state.pollens.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < SETTINGS.pollenRadius || p.x > width - SETTINGS.pollenRadius) {
            p.vx *= -1;
            p.x = p.x < SETTINGS.pollenRadius ? SETTINGS.pollenRadius : width - SETTINGS.pollenRadius;
        }
        if (p.y < SETTINGS.pollenRadius || p.y > height - SETTINGS.pollenRadius) {
            p.vy *= -1;
            p.y = p.y < SETTINGS.pollenRadius ? SETTINGS.pollenRadius : height - SETTINGS.pollenRadius;
        }

        // 衝突判定: 主人公 vs 花粉 (円形当たり判定)
        if (!state.isInvincible) {
            const dist = Math.hypot(p.x - state.hero.x, p.y - state.hero.y);
            if (dist < SETTINGS.pollenRadius + heroRadius) {
                hitPollen();
            }
        }
    });

    // 衝突判定: 主人公 vs 花粉樹
    const distToTree = Math.hypot(state.tree.x - state.hero.x, state.tree.y - state.hero.y);
    if (distToTree < getTreeRadius() + heroRadius) {
        clearStage();
    }
}

function hitPollen() {
    state.gauge++;
    updateUI();

    // 短い無敵時間付与（連続ダメージ防止）
    state.isInvincible = true;
    state.invincibleTimer = Date.now();
    invIndicator.style.opacity = '0.5';

    if (state.gauge >= SETTINGS.maxGauge) {
        gameOver();
    } else {
        // くしゃみ演出（画面揺らし等）
        document.body.classList.add('sneezing');
        setTimeout(() => document.body.classList.remove('sneezing'), 500);
    }
}

function clearStage() {
    state.running = false;
    state.isCleared = true;
    resetInput();

    resultTitle.textContent = "MISSION COMPLETE";
    resultTitle.style.color = "var(--safe-color)";
    messageEl.textContent = "「駆逐完了。奴らは全滅した。」";

    if (state.currentStage < SETTINGS.stages.length - 1) {
        actionBtn.textContent = "次の戦場へ";
    } else {
        resultTitle.textContent = "TOTAL CLEAR";
        messageEl.textContent = "「この世界から、一粒残らず駆逐した。」";
        actionBtn.textContent = "最初から駆逐する";
    }

    overlayMessage.classList.remove('hidden');
}

function gameOver() {
    state.running = false;
    state.isGameOver = true;
    resetInput();

    // 特大くしゃみ
    document.body.classList.add('sneezing');

    resultTitle.textContent = "MISSION FAILED";
    resultTitle.style.color = "var(--danger-color)";
    messageEl.textContent = "「くしゅん！ ...奴らは、まだ残っている。」";
    actionBtn.textContent = "リトライ";

    overlayMessage.classList.remove('hidden');
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 花粉樹（ボス）
    if (treeImg.complete) {
        const size = SETTINGS.treeSize;
        // 画像は中心座標 (state.tree.x, state.tree.y) を中心に描画
        // トリム済み正方形(1:1)を維持
        ctx.drawImage(treeImg, state.tree.x - size / 2, state.tree.y - size / 2, size, size);
    } else {
        // 画像読み込み前、またはエラー時の代替表示 (旧木描画に近いもの)
        ctx.beginPath();
        ctx.arc(state.tree.x, state.tree.y, SETTINGS.treeSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = '#1b3a1a';
        ctx.fill();
        ctx.strokeStyle = varToHex('--tree-color');
        ctx.lineWidth = 4;
        ctx.stroke();
    }

    // 花粉
    state.pollens.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, SETTINGS.pollenRadius, 0, Math.PI * 2);
        ctx.fillStyle = varToHex('--pollen-color');
        ctx.fill();

        // 小型化に合わせてギザギザを簡略化
        ctx.strokeStyle = varToHex('--pollen-color');
        ctx.lineWidth = 1;
        ctx.stroke();
    });

    // 主人公 (斧画像)
    if (heroImg.complete) {
        const size = SETTINGS.heroSize;
        ctx.save();
        if (state.isInvincible) {
            ctx.globalAlpha = 0.6;
            ctx.shadowBlur = 20;
            ctx.shadowColor = '#fff';
        }
        // 画像は中心座標 (state.hero.x, state.hero.y) を中心に描画
        ctx.drawImage(heroImg, state.hero.x - size / 2, state.hero.y - size / 2, size, size);
        ctx.restore();
    } else {
        // 画像読み込み前、またはエラー時の代替表示
        ctx.beginPath();
        ctx.arc(state.hero.x, state.hero.y, getHeroRadius(), 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
    }
}

function varToHex(varName) {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

// 実行
setupInputs();
resize();
