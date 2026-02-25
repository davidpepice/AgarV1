import Connection from '../net/Connection.js';
import Renderer from '../render/Renderer.js';
import { BinaryWriter } from '../net/Protocol.js';

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

        this.ui = {
            mainMenu: document.getElementById('main-menu'),
            playBtn: document.getElementById('play-btn'),
            nickname: document.getElementById('nickname'),
            serverUrl: document.getElementById('server-url'),
            leaderboard: document.getElementById('leaderboard'),
            stats: document.getElementById('stats'),
            lbList: document.getElementById('lb-list'),
            mass: document.getElementById('mass')
        };

        this.init();
    }

    init() {
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.ui.playBtn.addEventListener('click', () => this.handlePlay());
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
        this.nickname = this.ui.nickname.value || 'Unnamed';
        const url = this.ui.serverUrl.value || 'ws://localhost:8080';

        this.ui.mainMenu.style.display = 'none';
        this.ui.leaderboard.style.display = 'block';
        this.ui.stats.style.display = 'block';

        this.reset();
        this.connection.connect(url, this.nickname);
    }

    reset() {
        this.nodes.clear();
        this.ownIds = [];
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

    updateNode(id, x, y, size, color, name) {
        let node = this.nodes.get(id);
        if (!node) {
            node = { id, x, y, size, color, name, targetX: x, targetY: y, targetSize: size };
            this.nodes.set(id, node);
        } else {
            node.targetX = x;
            node.targetY = y;
            node.targetSize = size;
            if (color) node.color = color;
            if (name) node.name = name;
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
            if (totalMass > 0) this.ui.mass.innerText = `Mass: ${totalMass}`;
        }
        if (time - this.lastMouseSend > 40) {
            this.sendMouse();
            this.lastMouseSend = time;
        }
        requestAnimationFrame((t) => this.loop(t));
    }
}
window.game = new Game();
