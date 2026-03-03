/**
 * 花粉駆逐 (MVP) - ゲームロジック
 */

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const stageNumEl = document.getElementById('stage-num');
const overlayStart = document.getElementById('overlay-start');
const overlayPause = document.getElementById('overlay-pause');
const overlayMessage = document.getElementById('overlay-message');
const overlayRank = document.getElementById('overlay-rank');
const resultTitle = document.getElementById('result-title');
const messageEl = document.getElementById('message');
const actionBtn = document.getElementById('action-button');
const rankBtnStart = document.getElementById('rank-button-start');
const rankBtnMessage = document.getElementById('rank-button-message');
const rankHomeBtn = document.getElementById('rank-home-button');

// ゲーム設定
const SETTINGS = {
    heroSize: 40, // 表示サイズ（ピクセル）
    playerRadiusScale: 0.45, // min(w, h) * 0.45
    pollenRadius: 4, // P0: 大幅に小型化
    treeSize: 180, // ボスの表示サイズ（現状の木と同程度から+10~20%を反映）
    treeHitbox: { rxScale: 0.22, ryScale: 0.32 }, // 当たり判定（楕円）: 縦長の見た目に合わせて左右を厳しく
    speed: {
        hero: 6,
        pollenBase: 1.8 // P0: 2.5 -> 1.8 (約72%)
    },
    spawnSafetyMargin: 180, // プレイヤーからの最低距離を拡大
    invincibleDuration: 1600, //無敵時間　 でバックように自由に設定
    maxGauge: 1, // P0: 1ヒット即死
    stages: [], // 今後は getStageConfig() を使用
    treeShakeDuration: 400, // 揺れの時間（ミリ秒）
    treeShakeAmplitude: 4,   // 揺れの強さ（ピクセル）
    pollenZigFreq: 0.035,   // ジグザグ周波数（小さいほどゆっくり切り替わる）
    pollenZigAmp: 5         // ジグザグ振幅（大きいほど左右のブレ幅が増える）

};

// ステージ個別設定（1始まりのインデックス）
const STAGE_OVERRIDES = {
    // 例: 7: { pollenCount: 28, pollenSpeed: 1.6 },
};

/**
 * ステージ番号（1始まり）に基づいて設定を生成する（決定的）
 */
function generateStageConfig(stage) {
    if (stage <= 10) {
        // Stage 1-10: 
        return {
            pollenCount: 6 + (stage - 1) * 2,
            pollenSpeed: 1.2
        };
    } else if (stage <= 20) {
        // Stage 11-20:
        return {
            pollenCount: 6 + (stage - 11) * 2,
            pollenSpeed: 2.2
        };
    } else if (stage <= 30) {
        // Stage 21-30: 
        return {
            pollenCount: 6 + (stage - 21) * 2,
            pollenSpeed: 1.4,
            zigzag: true
        };
    } else if (stage <= 40) {
        // Stage 31-40: 旋回移動
        return {
            pollenCount: 6 + (stage - 31) * 2,
            pollenSpeed: 2.2,
            curve: true
        };
    } else if (stage <= 50) {
        // Stage 41-50: ホーミング
        return {
            pollenCount: 4 + (stage - 41) * 1,
            pollenSpeed: 1.7,
            homing: true
        };
    } else {
        // Stage 50 以降は Stage 50 の設定を維持
        return generateStageConfig(50);
    }
}

/**
 * ハイブリッド方式の設定取得
 */
function getStageConfig(stage) {
    return STAGE_OVERRIDES[stage] ?? generateStageConfig(stage);
}


// 画像の読み込み
const heroImg = new Image();
heroImg.src = 'ax.png';

const treeImg = new Image();
treeImg.src = 'tree.png';

const treeDeadImg = new Image();
treeDeadImg.src = 'tree_dead.png';

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
    },
    treeShakeUntil: 0, // 木の揺れ終了時刻
    treeIsDead: false,
    clearPending: false,
    clearAt: 0,
    treeHitShakeUntil: 0
};

// プレイヤーの現在の当たり判定半径を取得
function getHeroRadius() {
    return SETTINGS.heroSize * SETTINGS.playerRadiusScale;
}

// 花粉樹（ボス）の当たり判定（楕円）を取得
function getTreeHitbox() {
    return {
        rx: SETTINGS.treeSize * SETTINGS.treeHitbox.rxScale,
        ry: SETTINGS.treeSize * SETTINGS.treeHitbox.ryScale
    };
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
    const stage = state.currentStage + 1;
    const config = getStageConfig(stage);
    state.pollens = [];
    const spawnRadius = Math.max(40, SETTINGS.treeSize * 0.25);

    for (let i = 0; i < config.pollenCount; i++) {
        let x, y, dist;
        do {
            // 木の周辺から座標を生成
            const r = Math.random() * spawnRadius;
            const theta = Math.random() * Math.PI * 2;
            x = state.tree.x + Math.cos(theta) * r;
            y = state.tree.y + Math.sin(theta) * r;

            // 画面内にクランプ (花粉の半径を考慮)
            x = Math.max(SETTINGS.pollenRadius, Math.min(width - SETTINGS.pollenRadius, x));
            y = Math.max(SETTINGS.pollenRadius, Math.min(height - SETTINGS.pollenRadius, y));

            // プレイヤーとの距離を確認（安全マージン）
            dist = Math.hypot(x - state.hero.x, y - state.hero.y);
        } while (dist < SETTINGS.spawnSafetyMargin);

        const angle = Math.random() * Math.PI * 2;
        const p = {
            x, y,
            vx: Math.cos(angle) * config.pollenSpeed,
            vy: Math.sin(angle) * config.pollenSpeed
        };

        if (config.zigzag) {
            p.zigPhase = Math.random() * Math.PI * 2;
            p.zigFreq = SETTINGS.pollenZigFreq;
            p.zigAmp = SETTINGS.pollenZigAmp;
        }

        if (config.curve) {
            const base = 0.012;  // 最小
            const rand = 0.010;  // ばらつき
            p.omega = (base + Math.random() * rand) * (Math.random() < 0.5 ? 1 : -1);
            p.pollenSpeed = config.pollenSpeed; // 正規化用
        }

        if (config.homing) {
            p.homing = true;
            p.homingSpeed = config.pollenSpeed;
            p.turnRate = 0.08; //どれだけ素早く向きを変えれるか
            p.reacquireMs = 60; //  小さいほど追尾の更新が多い
            p.nextReacquire = Date.now() + Math.random() * 120;
        }

        state.pollens.push(p);
    }

    // 木の揺れを開始
    state.treeShakeUntil = Date.now() + SETTINGS.treeShakeDuration;
}

// 入力設定 (Pointer Events)
function setupInputs() {
    const buttons = document.querySelectorAll('.control-btn');

    buttons.forEach(btn => {
        const dir = btn.dataset.dir;

        btn.addEventListener('pointerdown', (e) => {
            if (state.isPaused) return; // ポーズ中は無効
            e.preventDefault();
            // 他方向をリセットせず、現在の方向のみセット
            state.input[dir] = true;
            state.input.lastDir = dir;
        });

        // 共通の停止処理
        const stop = (e) => {
            state.input[dir] = false;
            if (state.input.lastDir === dir) {
                state.input.lastDir = null;
            }
        };

        btn.addEventListener('pointerup', stop);
        btn.addEventListener('pointercancel', stop);
        btn.addEventListener('pointerleave', stop); // ボタンから指が離れた場合も停止
    });

    document.getElementById('start-button').addEventListener('click', startGame);
    actionBtn.addEventListener('click', handleAction);

    // ポーズ関連 (中央ボタンに集約)
    document.getElementById('pause-btn').addEventListener('click', togglePause);

    // ランキング関連
    rankBtnStart.addEventListener('click', () => {
        overlayStart.classList.add('hidden');
        overlayRank.classList.remove('hidden');
    });

    rankBtnMessage.addEventListener('click', () => {
        overlayMessage.classList.add('hidden');
        overlayRank.classList.remove('hidden');
    });

    rankHomeBtn.addEventListener('click', () => {
        overlayRank.classList.add('hidden');
        overlayStart.classList.remove('hidden');
    });
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

function triggerClearSequence() {
    if (state.clearPending || state.isCleared || state.isGameOver) return;

    // state.running = false; // 演出中は停止（削除: ループは回し続ける）
    resetInput();

    state.treeIsDead = true;
    state.treeHitShakeUntil = Date.now() + 300;
    state.clearPending = true;
    state.clearAt = Date.now() + 350;
    // ここでは overlayMessage を出さない（演出後に出す）
}

function handleAction() {
    document.getElementById('pause-btn').textContent = 'II';
    rankBtnMessage.classList.add('hidden');
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
        // 次のステージへ（上限なし）
        state.currentStage++;
        resetInput();
        resetStage();
        state.isCleared = false;
        overlayMessage.classList.add('hidden');
        state.running = true;
        requestAnimationFrame(gameLoop);
    }
}

function resetStage() {
    initPosition();
    state.isInvincible = true;
    state.invincibleTimer = Date.now();
    state.treeIsDead = false;
    state.clearPending = false;
    updateUI();
}

// ウィンドウフォーカス喪失時などのリセット
window.addEventListener('blur', resetInput);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) resetInput();
});

function updateUI() {
    stageNumEl.textContent = state.currentStage + 1;
}

// メインループ
function gameLoop() {
    if (!state.running) return;

    update();
    draw();

    requestAnimationFrame(gameLoop);
}

function update() {
    // クリア演出の監視
    if (state.clearPending && Date.now() >= state.clearAt) {
        state.clearPending = false;
        clearStage(); // ここで初めて MISSION COMPLETE 表示
        return;
    }
    // クリア演出中はゲーム進行（移動・花粉更新）を止める。ただし draw() は回す
    if (state.clearPending) {
        return;
    }

    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);
    const heroRadius = getHeroRadius();

    // 無敵タイマー
    if (state.isInvincible && Date.now() - state.invincibleTimer > SETTINGS.invincibleDuration) {
        state.isInvincible = false;
    }

    // 主人公移動（斜め対応・正規化）
    let dx = 0;
    let dy = 0;
    if (state.input.up) dy -= 1;
    if (state.input.down) dy += 1;
    if (state.input.left) dx -= 1;
    if (state.input.right) dx += 1;

    if (dx !== 0 || dy !== 0) {
        // 斜め移動時の正規化
        const length = Math.hypot(dx, dy);
        const nx = dx / length;
        const ny = dy / length;

        state.hero.x += nx * SETTINGS.speed.hero;
        state.hero.y += ny * SETTINGS.speed.hero;
    }

    // 画面外ブロック（見た目の端ではなく、中心座標の制限として heroRadius を使用）
    state.hero.x = Math.max(heroRadius, Math.min(width - heroRadius, state.hero.x));
    state.hero.y = Math.max(heroRadius, Math.min(height - heroRadius, state.hero.y));

    // 花粉移動と反射
    state.pollens.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;

        // 特殊移動の適用 (排他的)
        if (p.homing) {
            // ホーミング（ゆる追尾）移動
            if (Date.now() >= p.nextReacquire) {
                const tx = state.hero.x - p.x;
                const ty = state.hero.y - p.y;
                const targetAngle = Math.atan2(ty, tx);
                const currentAngle = Math.atan2(p.vy, p.vx);

                // 角度差を [-PI, PI] に正規化
                let d = targetAngle - currentAngle;
                while (d > Math.PI) d -= Math.PI * 2;
                while (d < -Math.PI) d += Math.PI * 2;

                // ゆるく曲げる
                const turn = Math.max(-p.turnRate, Math.min(p.turnRate, d));
                const newAngle = currentAngle + turn;

                p.vx = Math.cos(newAngle) * p.homingSpeed;
                p.vy = Math.sin(newAngle) * p.homingSpeed;
                p.nextReacquire = Date.now() + p.reacquireMs;
            }
        } else if (p.omega) {
            // 旋回（曲線）移動
            const cosO = Math.cos(p.omega);
            const sinO = Math.sin(p.omega);
            const vx2 = p.vx * cosO - p.vy * sinO;
            const vy2 = p.vx * sinO + p.vy * cosO;

            // 速度の正規化（重要）
            const length = Math.hypot(vx2, vy2);
            if (length > 0) {
                p.vx = (vx2 / length) * p.pollenSpeed;
                p.vy = (vy2 / length) * p.pollenSpeed;
            }
        } else if (p.zigAmp) {
            // ジグザグ移動
            const speed = Math.hypot(p.vx, p.vy);
            if (speed > 0) {
                // 進行方向に直交する方向 (perp)
                const px = -p.vy / speed;
                const py = p.vx / speed;
                // オフセット計算
                const t = Date.now() * p.zigFreq + p.zigPhase;
                const z = Math.sign(Math.sin(t)) * p.zigAmp;
                // オフセット適用
                p.x += px * z;
                p.y += py * z;
            }
        }

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

    // 衝突判定: 主人公 vs 花粉樹（楕円）
    // ボスは縦長なので、左右の空白で当たらないよう楕円判定にする
    const dxT = state.hero.x - state.tree.x;
    const dyT = state.hero.y - state.tree.y;
    const hb = getTreeHitbox();
    const rx = hb.rx + heroRadius;
    const ry = hb.ry + heroRadius;
    const norm = (dxT * dxT) / (rx * rx) + (dyT * dyT) / (ry * ry);
    if (norm < 1) {
        triggerClearSequence();
    }
}

function hitPollen() {
    state.gauge++;
    updateUI();

    // 短い無敵時間付与（連続ダメージ防止）
    state.isInvincible = true;
    state.invincibleTimer = Date.now();

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

    const cleared = state.currentStage + 1;

    // 伐採成功表示（2行）
    resultTitle.innerHTML = `伐採成功<br>${cleared}株目`;
    resultTitle.style.color = "var(--safe-color)";
    messageEl.textContent = "「駆逐完了。」";

    actionBtn.textContent = "次の伐採へ";

    overlayMessage.classList.remove('hidden');
    rankBtnMessage.classList.add('hidden');
}

function gameOver() {
    state.running = false;
    state.isGameOver = true;
    resetInput();

    // 特大くしゃみ
    document.body.classList.remove('sneezing');
    void document.body.offsetWidth; // reflow: アニメを毎回再発火させる
    document.body.classList.add('sneezing');

    // 伐採失敗表示（2行）: 記録＝クリアした数
    const record = state.currentStage;
    resultTitle.innerHTML = `伐採失敗<br>記録 ${record}株`;
    resultTitle.style.color = "var(--danger-color)";
    messageEl.textContent = "「目が、目がぁぁ・・・。」";
    actionBtn.textContent = "リトライ";

    overlayMessage.classList.remove('hidden');
    rankBtnMessage.classList.remove('hidden');
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 花粉樹（ボス）
    let treeX = state.tree.x;
    let treeY = state.tree.y;

    // 揺れ演出の計算
    if (Date.now() < state.treeShakeUntil) {
        treeX += (Math.random() * 2 - 1) * SETTINGS.treeShakeAmplitude;
        treeY += (Math.random() * 2 - 1) * SETTINGS.treeShakeAmplitude;
    }

    // 撃破時の揺れ（左右のみガクガク揺らす）
    if (Date.now() < state.treeHitShakeUntil) {
        const shakeAmp = 8; // 6〜10の間
        treeX += (Math.random() * 2 - 1) * shakeAmp;
    }

    const img = state.treeIsDead ? treeDeadImg : treeImg;

    if (img.complete) {
        const size = SETTINGS.treeSize;
        // 画像は中心座標を中心に出力
        ctx.drawImage(img, treeX - size / 2, treeY - size / 2, size, size);
    } else {
        // 画像読み込み前、またはエラー時の代替表示
        ctx.beginPath();
        ctx.arc(treeX, treeY, SETTINGS.treeSize / 2, 0, Math.PI * 2);
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
