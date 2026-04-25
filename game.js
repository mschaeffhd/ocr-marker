// ============== TETRIS MULTIPLAYER ==============

const COLS = 10;
const ROWS = 20;
let BLOCK = 30;

const COLORS = {
    I: '#00f', O: '#ff0', T: '#a0f', S: '#0f0', Z: '#f00', L: '#fa0', J: '#00aaff'
};

const SHAPES = {
    I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    O: [[1,1,0,0],[1,1,0,0],[0,0,0,0],[0,0,0,0]],
    T: [[0,1,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
    S: [[0,1,1,0],[1,1,0,0],[0,0,0,0],[0,0,0,0]],
    Z: [[1,1,0,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]],
    L: [[1,0,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
    J: [[0,0,1,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]]
};

const KEYS = ['I','O','T','S','Z','L','J'];

let canvas, ctx, nextC, nextCtx;
let board = [];
let piece, next;
let score = 0, level = 1, lines = 0;
let gameOver = false;
let dropInterval = 1000;
let dropTimer = 0;
let lastTime = 0;
let lastSpaceTime = 0;

let socket, myId;
let players = {};
let remotePieces = {};

// ============== INIT ==============
function init() {
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');
    nextC = document.getElementById('next');
    nextCtx = nextC.getContext('2d');
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 100));
    
    // ResizeObserver for dynamic container changes
    const observer = new ResizeObserver(() => resizeCanvas());
    observer.observe(document.getElementById('game-area'));
    
    // Load saved zoom
    const savedZoom = localStorage.getItem('tetris-zoom');
    if (savedZoom) zoomLevel = parseFloat(savedZoom);
    updateZoomUI();
    
    // Pinch-to-zoom
    let lastPinchDist = 0;
    canvas.addEventListener('touchstart', e => {
        if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            lastPinchDist = Math.sqrt(dx*dx + dy*dy);
        }
    }, { passive: true });
    canvas.addEventListener('touchmove', e => {
        if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (lastPinchDist > 0) {
                const delta = dist / lastPinchDist;
                zoomLevel = Math.max(0.5, Math.min(2, zoomLevel * delta));
                lastPinchDist = dist;
                localStorage.setItem('tetris-zoom', zoomLevel.toFixed(2));
                updateZoomUI();
            }
            e.preventDefault();
        }
    }, { passive: false });
    canvas.addEventListener('touchend', e => {
        if (e.touches.length < 2) lastPinchDist = 0;
    });
    
    resetGame();
    setupControls();
    setupSocket();
    requestAnimationFrame(loop);
}

function resetGame() {
    for (let y = 0; y < ROWS; y++) board[y] = new Array(COLS).fill(0);
    score = 0; level = 1; lines = 0;
    gameOver = false; dropInterval = 1000; dropTimer = 0;
    piece = newPiece();
    next = newPiece();
    updateUI();
}

function newPiece() {
    const key = KEYS[Math.floor(Math.random() * KEYS.length)];
    return { key, shape: SHAPES[key].map(r => [...r]), x: 3, y: 0 };
}

function resizeCanvas() {
    const area = document.getElementById('game-area');
    if (!area) return;
    
    const rect = area.getBoundingClientRect();
    const availW = rect.width;
    const availH = rect.height;
    
    let maxBlock = 32;
    if (window.innerWidth > 768) maxBlock = 30;
    if (window.innerWidth > 1200) maxBlock = 32;
    
    const blockFromW = Math.floor(availW / COLS);
    const blockFromH = Math.floor(availH / ROWS);
    
    // Base size, then apply zoom
    let baseBlock = Math.min(blockFromW, blockFromH);
    baseBlock = Math.max(18, Math.min(baseBlock, maxBlock));
    
    // Apply zoom
    BLOCK = Math.round(baseBlock * zoomLevel);
    BLOCK = Math.max(16, Math.min(BLOCK, 55));
    
    canvas.width = COLS * BLOCK;
    canvas.height = ROWS * BLOCK;
    
    nextC.width = 4 * BLOCK;
    nextC.height = 4 * BLOCK;
}

function updateZoomUI() {
    const zoomEl = document.getElementById('zoom-display');
    if (zoomEl) zoomEl.textContent = Math.round(zoomLevel * 100) + '%';
}

// ============== GAME ==============
function hit(shape, px, py) {
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
            if (shape[r][c]) {
                let nx = px + c, ny = py + r;
                if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
                if (ny >= 0 && board[ny][nx]) return true;
            }
        }
    }
    return false;
}

function lock() {
    piece.shape.forEach((row, r) => {
        row.forEach((v, c) => {
            if (v && piece.y + r < ROWS && piece.x + c < COLS) {
                board[piece.y + r][piece.x + c] = piece.key;
            }
        });
    });
    
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
        if (board[y].every(v => v)) {
            board.splice(y, 1);
            board.unshift(new Array(COLS).fill(0));
            cleared++;
            y++;
        }
    }
    
    if (cleared > 0) {
        score += [0, 100, 300, 500, 800][cleared] * level;
        lines += cleared;
        level = Math.floor(lines / 10) + 1;
        dropInterval = Math.max(100, 1000 - level * 80);
        updateUI();
    }
    
    piece = next;
    next = newPiece();
    if (hit(piece.shape, piece.x, piece.y)) {
        gameOver = true;
        socket.emit('scoreUpdate', { score });
    }
    sync();
}

function move(dir) {
    if (!hit(piece.shape, piece.x + dir, piece.y)) {
        piece.x += dir;
        sync();
    }
}

function rotate(dir) {
    const old = piece.shape.map(r => [...r]);
    const neo = Array.from({ length: 4 }, () => new Array(4).fill(0));
    
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
            if (old[r][c]) {
                if (dir > 0) neo[c][3-r] = old[r][c];
                else neo[3-c][r] = old[r][c];
            }
        }
    }
    
    for (let k of [0, -1, 1, -2, 2]) {
        if (!hit(neo, piece.x + k, piece.y)) {
            piece.shape = neo;
            piece.x += k;
            sync();
            return;
        }
    }
}

function drop() {
    while (!hit(piece.shape, piece.x, piece.y + 1)) piece.y++;
    lock();
}

function softDrop() {
    if (!hit(piece.shape, piece.x, piece.y + 1)) {
        piece.y++;
        score += 1;
        sync();
    }
}

// ============== DRAW ==============
function loop(time = 0) {
    const dt = time - lastTime;
    lastTime = time;
    
    if (!gameOver) {
        dropTimer += dt;
        if (dropTimer >= dropInterval) {
            dropTimer = 0;
            if (!hit(piece.shape, piece.x, piece.y + 1)) piece.y++;
            else lock();
            sync();
        }
    }
    
    draw();
    requestAnimationFrame(loop);
}

function draw() {
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
        ctx.beginPath(); ctx.moveTo(x*BLOCK, 0); ctx.lineTo(x*BLOCK, canvas.height); ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
        ctx.beginPath(); ctx.moveTo(0, y*BLOCK); ctx.lineTo(canvas.width, y*BLOCK); ctx.stroke();
    }
    
    for (let y = 0; y < ROWS; y++)
        for (let x = 0; x < COLS; x++)
            if (board[y][x]) drawBlock(x, y, COLORS[board[y][x]]);
    
    if (!gameOver) {
        // Ghost
        let gy = piece.y;
        while (!hit(piece.shape, piece.x, gy + 1)) gy++;
        if (gy !== piece.y) {
            piece.shape.forEach((row, r) => {
                row.forEach((v, c) => {
                    if (v) {
                        ctx.fillStyle = COLORS[piece.key] + '25';
                        ctx.fillRect((piece.x+c)*BLOCK+2, (gy+r)*BLOCK+2, BLOCK-4, BLOCK-4);
                    }
                });
            });
        }
        // Piece
        piece.shape.forEach((row, r) => {
            row.forEach((v, c) => {
                if (v) drawBlock(piece.x + c, piece.y + r, COLORS[piece.key]);
            });
        });
    }
    
    // Remote
    for (let id in remotePieces) {
        const rp = remotePieces[id];
        ctx.globalAlpha = 0.4;
        rp.shape.forEach((row, r) => {
            row.forEach((v, c) => {
                if (v) drawBlock(rp.x + c, rp.y + r, COLORS[rp.key] || '#888');
            });
        });
        ctx.globalAlpha = 1;
    }
    
    // Next
    nextCtx.fillStyle = '#0a0a14';
    nextCtx.fillRect(0, 0, nextC.width, nextC.height);
    if (next) {
        nextCtx.fillStyle = COLORS[next.key];
        next.shape.forEach((row, r) => {
            row.forEach((v, c) => {
                if (v) nextCtx.fillRect(c*BLOCK+4, r*BLOCK+4, BLOCK-4, BLOCK-4);
            });
        });
    }
    
    if (gameOver) {
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.font = 'bold 28px system-ui';
        ctx.fillText('GAME OVER', canvas.width/2, canvas.height/2 - 15);
        ctx.font = '16px system-ui';
        ctx.fillText('Score: ' + score, canvas.width/2, canvas.height/2 + 15);
        ctx.font = '13px system-ui';
        ctx.fillStyle = '#888';
        ctx.fillText('ENTER oder Restart-Button', canvas.width/2, canvas.height/2 + 40);
    }
}

function drawBlock(x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x*BLOCK+1, y*BLOCK+1, BLOCK-2, BLOCK-2);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x*BLOCK+1, y*BLOCK+1, BLOCK-2, 3);
}

// ============== ZOOM ==============
let zoomLevel = 1;

function setZoom(z) {
    zoomLevel = Math.max(0.5, Math.min(2, z));
    localStorage.setItem('tetris-zoom', zoomLevel.toFixed(2));
    updateZoomUI();
    resizeCanvas();
}

function updateZoomUI() {
    const zoomEl = document.getElementById('zoom-display');
    if (zoomEl) zoomEl.textContent = Math.round(zoomLevel * 100) + '%';
}

// ============== CONTROLS ==============
function setupControls() {
    // Keyboard
    document.addEventListener('keydown', e => {
        if (gameOver && e.code !== 'Space' && e.code !== 'Enter') return;
        const now = Date.now();
        
        switch (e.code) {
            case 'ArrowLeft': e.preventDefault(); move(-1); break;
            case 'ArrowRight': e.preventDefault(); move(1); break;
            case 'ArrowDown': e.preventDefault(); softDrop(); break;
            case 'ArrowUp': e.preventDefault(); rotate(-1); break;
            case 'KeyQ': rotate(-1); break;
            case 'KeyE': rotate(1); break;
            case 'Space':
                e.preventDefault();
                if (now - lastSpaceTime < 250) drop();
                else softDrop();
                lastSpaceTime = now;
                break;
            case 'Enter':
                if (gameOver) resetGame();
                break;
        }
    });
    
    // === TOUCH GESTURES ON CANVAS ===
    let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
    
    canvas.addEventListener('touchstart', e => {
        if (gameOver) return;
        e.preventDefault();
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
    }, { passive: false });
    
    canvas.addEventListener('touchend', e => {
        if (gameOver) return;
        e.preventDefault();
        
        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;
        const dx = endX - touchStartX;
        const dy = endY - touchStartY;
        const dt = Date.now() - touchStartTime;
        
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        
        // Short tap = move
        if (dt < 200 && absDx < 20 && absDy < 20) {
            if (dx > 5) move(1);
            else if (dx < -5) move(-1);
            return;
        }
        
        // Swipe gestures
        if (dt < 300) {
            if (absDy > absDx) {
                if (dy < -30) rotate(-1);       // Swipe UP = rotate CCW
                else if (dy > 30) softDrop();   // Swipe DOWN = soft drop
            } else {
                if (dx > 30) move(1);           // Swipe RIGHT = move right
                else if (dx < -30) move(-1);    // Swipe LEFT = move left
            }
        }
    }, { passive: false });
    
    // === DOUBLE TAP LEFT/RIGHT OF CANVAS ===
    let lastTapLeft = 0, lastTapRight = 0;
    
    document.addEventListener('touchend', e => {
        if (gameOver) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.changedTouches[0].clientX;
        const y = e.changedTouches[0].clientY;
        const now = Date.now();
        
        // Only if tap is outside canvas
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return;
        
        // Double tap LEFT = drop
        if (x < rect.left) {
            if (now - lastTapLeft < 350) { drop(); lastTapLeft = 0; }
            else lastTapLeft = now;
        }
        
        // Double tap RIGHT = soft drop
        if (x > rect.right) {
            if (now - lastTapRight < 350) { softDrop(); lastTapRight = 0; }
            else lastTapRight = now;
        }
    }, { passive: false });
    
    // Buttons
    const btnMap = {
        'btn-left': () => move(-1),
        'btn-right': () => move(1),
        'btn-down': () => softDrop(),
        'btn-rot-l': () => rotate(-1),
        'btn-rot-r': () => rotate(1),
        'btn-drop': () => drop(),
        'btn-restart': () => resetGame()
    };
    
    for (const id in btnMap) {
        const btn = document.getElementById(id);
        if (!btn) continue;
        const fn = btnMap[id];
        btn.addEventListener('mousedown', fn);
        btn.addEventListener('touchstart', e => { e.preventDefault(); fn(); }, { passive: false });
    }
}

// ============== SOCKET ==============
function setupSocket() {
    socket = io();
    socket.on('connect', () => { myId = socket.id; });
    socket.on('players', pls => { players = pls; renderPlayers(); });
    socket.on('remotePiece', d => { if (d.id !== myId) remotePieces[d.id] = d; });
    socket.on('playerLeft', id => { delete remotePieces[id]; delete players[id]; renderPlayers(); });
}

function sync() {
    if (socket?.connected) {
        socket.emit('piece', { key: piece.key, shape: piece.shape, x: piece.x, y: piece.y });
    }
}

function renderPlayers() {
    const el = document.getElementById('players');
    el.innerHTML = '';
    for (const id in players) {
        const p = players[id];
        const div = document.createElement('div');
        div.className = 'player' + (id === myId ? ' me' : '');
        div.innerHTML = `<span class="player-color" style="background:${p.color}"></span>${p.score}`;
        el.appendChild(div);
    }
}

function updateUI() {
    document.getElementById('score').textContent = score;
    document.getElementById('level').textContent = level;
    document.getElementById('lines').textContent = lines;
    document.title = `Tetris - ${score}`;
}

init();
