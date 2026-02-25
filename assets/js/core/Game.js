import Connection from '../net/Connection.js';
import Renderer from '../render/Renderer.js';
import { BinaryWriter, PROTOCOL } from '../net/Protocol.js';
import PointQuadTree from '../utils/Quadtree.js';

export const CELL_POINTS_MIN = 5;
export const CELL_POINTS_MAX = 200;
export const VIRUS_POINTS = 100;
export const QUADTREE_MAX_POINTS = 302;

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.renderer = new Renderer(this);
        this.connection = new Connection(this);

        this.nodes = new Map();
        this.ownIds = [];
        this.nickname = "";
        this.borders = { l: -5000, t: -5000, r: 5000, b: 5000 };

        this.mouseX = 0;
        this.mouseY = 0;
        this.lastMouseSend = 0;

        // Cigar2 Timestamp Sync
        this.serverTime = 0;
        this.lastSyncLocal = 0;
        this.clockOffset = 0;

        this.ui = {
            mainMenu: document.getElementById('main-menu'),
            nickname: document.getElementById('nickname'),
            serverUrl: document.getElementById('server-url'),
            playBtn: document.getElementById('play-btn'),
            spectateBtn: document.getElementById('spectate-btn'),
            leaderboard: document.getElementById('leaderboard'),
            stats: document.getElementById('stats'),
            lbList: document.getElementById('lb-list'),
            mass: document.getElementById('mass'),
            showNames: document.getElementById('show-names'),
            showMass: document.getElementById('show-mass'),
            jellyPhysics: document.getElementById('jelly-physics')
        };

        this.config = {
            showNames: true,
            showMass: true,
            jellyPhysics: true
        };

        this.init();
    }

    init() {
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.ui.playBtn.addEventListener('click', () => this.handlePlay());
        this.ui.spectateBtn.addEventListener('click', () => this.handleSpectate());

        // Config Bindings
        this.ui.showNames.addEventListener('change', (e) => this.config.showNames = e.target.checked);
        this.ui.showMass.addEventListener('change', (e) => this.config.showMass = e.target.checked);
        this.ui.jellyPhysics.addEventListener('change', (e) => this.config.jellyPhysics = e.target.checked);

        window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
        window.addEventListener('wheel', (e) => this.handleWheel(e), { passive: true });
        requestAnimationFrame((t) => this.loop(t));
    }

    handleWheel(e) {
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        this.renderer.userZoom = Math.max(0.1, Math.min(5.0, this.renderer.userZoom * delta));
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.renderer.setSize(this.canvas.width, this.canvas.height);
    }

    handlePlay() {
        const nickname = this.ui.nickname.value || 'Unnamed';
        const url = this.ui.serverUrl.value || 'ws://localhost:8080';

        // If already connected to same server, just spawn or close menu
        if (this.connection.ws && this.connection.ws.readyState === WebSocket.OPEN && this.connection.url === url) {
            this.ui.mainMenu.style.display = 'none';
            this.ui.leaderboard.style.display = 'block';
            this.ui.stats.style.display = 'block';

            if (nickname !== this.nickname || this.ownIds.length === 0) {
                this.nickname = nickname;
                this.connection.spawn(this.nickname);
            }
            return;
        }

        this.nickname = nickname;
        this.ui.mainMenu.style.display = 'none';
        this.ui.leaderboard.style.display = 'block';
        this.ui.stats.style.display = 'block';

        this.reset();
        this.connection.connect(url, this.nickname);
    }
    handleSpectate() {
        const nickname = this.ui.nickname.value || 'Unnamed';
        const url = this.ui.serverUrl.value || 'ws://localhost:8080';

        if (this.connection.ws && this.connection.ws.readyState === WebSocket.OPEN && this.connection.url === url) {
            this.ui.mainMenu.style.display = 'none';
            this.ui.leaderboard.style.display = 'block';
            this.ui.stats.style.display = 'block';
            this.connection.spectate();
            return;
        }

        this.nickname = nickname;
        this.ui.mainMenu.style.display = 'none';
        this.ui.leaderboard.style.display = 'block';
        this.ui.stats.style.display = 'block';

        this.reset();
        this.connection.connect(url, this.nickname, true);
    }
    reset() {
        this.clearAll();
        this.serverTime = 0;
        this.lastSyncLocal = 0;
        this.clockOffset = 0;
    }

    clearAll() {
        this.nodes.clear();
        this.ownIds = [];
    }

    clearOwn() {
        this.ownIds.forEach(id => this.nodes.delete(id));
        this.ownIds = [];
        this.ui.mainMenu.style.display = 'flex';
    }

    syncTime(serverTime) {
        this.serverTime = serverTime;
        this.lastSyncLocal = performance.now();
        this.clockOffset = this.serverTime - this.lastSyncLocal;
    }

    getSyncedTime() {
        return performance.now() + this.clockOffset;
    }

    addOwnId(id) {
        if (!this.ownIds.includes(id)) {
            this.ownIds.push(id);
        }
    }

    handleMouseMove(e) {
        this.mouseX = e.clientX;
        this.mouseY = e.clientY;
    }

    handleKeyDown(e) {
        if (e.code === 'Escape') {
            const isHidden = this.ui.mainMenu.style.display === 'none';
            this.ui.mainMenu.style.display = isHidden ? 'flex' : 'none';
            return;
        }

        const OPCODES = { 'Space': 17, 'KeyQ': 18, 'KeyW': 21, 'KeyE': 22, 'KeyR': 23 };
        if (OPCODES[e.code]) this.connection.send(new Uint8Array([OPCODES[e.code]]));
    }

    sendMouse() {
        if (!this.connection.ws || this.connection.ws.readyState !== WebSocket.OPEN) return;
        const scale = this.renderer.scale;
        const worldX = (this.mouseX - this.canvas.width / 2) / scale + this.renderer.camX;
        const worldY = (this.mouseY - this.canvas.height / 2) / scale + this.renderer.camY;

        const writer = new BinaryWriter();
        writer.writeUInt8(0x10); // Mouse move
        writer.writeUInt32(Math.floor(worldX));
        writer.writeUInt32(Math.floor(worldY));
        writer.writeUInt32(0); // Zero/Key
        this.connection.send(writer.build());
    }

    updateNumPoints(node) {
        // We use a simplified version of the logic based on Doblesplit
        const scale = this.renderer ? this.renderer.scale : 1;
        let numPoints = Math.min(
            Math.max((node.size * scale) | 0, CELL_POINTS_MIN),
            CELL_POINTS_MAX
        );
        if (node.jagged) numPoints = VIRUS_POINTS;

        while (node.points.length > numPoints) {
            const i = (Math.random() * node.points.length) | 0;
            node.points.splice(i, 1);
            node.pointsVel.splice(i, 1);
        }

        if (node.points.length === 0 && numPoints !== 0) {
            node.points.push({
                x: node.x,
                y: node.y,
                rl: node.size,
                parent: node
            });
            node.pointsVel.push(Math.random() - 0.5);
        }

        while (node.points.length < numPoints) {
            const i = (Math.random() * node.points.length) | 0;
            const point = node.points[i];
            const vel = node.pointsVel[i];
            node.points.splice(i, 0, {
                x: point.x,
                y: point.y,
                rl: point.rl,
                parent: node
            });
            node.pointsVel.splice(i, 0, vel);
        }
    }

    movePoints(node, quadtree, border) {
        const pointsVel = node.pointsVel.slice();
        const numPoints = node.points.length;

        for (let i = 0; i < numPoints; ++i) {
            const prevVel = pointsVel[(i - 1 + numPoints) % numPoints];
            const nextVel = pointsVel[(i + 1) % numPoints];
            const newVel = Math.max(
                Math.min((node.pointsVel[i] + Math.random() - 0.5) * 0.7, 10),
                -10
            );
            node.pointsVel[i] = (prevVel + nextVel + 8 * newVel) / 10;
        }

        for (let i = 0; i < numPoints; ++i) {
            const curP = node.points[i];
            const prevRl = node.points[(i - 1 + numPoints) % numPoints].rl;
            const nextRl = node.points[(i + 1) % numPoints].rl;
            let curRl = curP.rl;

            // Collision detection using Quadtree
            let affected = quadtree.some({
                x: curP.x - 5,
                y: curP.y - 5,
                w: 10,
                h: 10
            }, (item) => {
                if (item.parent === node) return false;
                const dx = item.x - curP.x;
                const dy = item.y - curP.y;
                return (dx * dx + dy * dy) <= 25;
            });

            if (node.size < 10) {
                // Simplified for small cells
            }

            if (!affected && (curP.x < border.l || curP.y < border.t || curP.x > border.r || curP.y > border.b)) {
                affected = true;
            }

            if (affected) {
                node.pointsVel[i] = Math.min(node.pointsVel[i], 0) - 1;
            }

            curRl += node.pointsVel[i];
            curRl = Math.max(curRl, 0);
            curRl = (9 * curRl + node.size) / 10;
            curP.rl = (prevRl + nextRl + 8 * curRl) / 10;

            const angle = (2 * Math.PI * i) / numPoints;
            let rl = curP.rl;
            if (node.jagged && i % 2 === 0) {
                rl += 5;
            }
            curP.x = node.x + Math.cos(angle) * rl;
            curP.y = node.y + Math.sin(angle) * rl;
        }
    }

    updateNode(id, x, y, size, color, name, jagged) {
        let node = this.nodes.get(id);
        const now = this.getSyncedTime();
        if (!node) {
            node = {
                id, x, y, size, color, name, jagged,
                targetX: x, targetY: y, targetSize: size,
                startX: x, startY: y, startSize: size,
                lastUpdate: now,
                points: [],
                pointsVel: []
            };
            this.updateNumPoints(node);
            this.nodes.set(id, node);
        } else {
            node.startX = node.x; // Current interpolated position becomes the new start
            node.startY = node.y;
            node.startSize = node.size;
            node.targetX = x;
            node.targetY = y;
            node.targetSize = size;
            node.lastUpdate = now;
            if (color) node.color = color;
            if (name) node.name = name;
            if (jagged !== undefined) node.jagged = jagged;
        }
    }

    removeNode(id) {
        this.nodes.delete(id);
        const idx = this.ownIds.indexOf(id);
        if (idx !== -1) this.ownIds.splice(idx, 1);
    }

    updateLeaderboard(list) {
        this.ui.lbList.innerHTML = list.map(name => `<li>${name}</li>`).join('');
    }

    loop(time) {
        this.renderer.render();
        if (this.nodes.size > 0) {
            let totalMass = 0;
            this.ownIds.forEach(id => {
                const node = this.nodes.get(id);
                if (node) totalMass += Math.floor((node.size * node.size) / 100);
            });
            if (totalMass > 0) this.ui.mass.innerText = `Mass: ${totalMass} `;
        }
        if (time - this.lastMouseSend > 40) {
            this.sendMouse();
            this.lastMouseSend = time;
        }
        requestAnimationFrame((t) => this.loop(t));
    }
}
window.game = new Game();
