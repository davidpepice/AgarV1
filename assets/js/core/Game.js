import Connection from '../net/Connection.js';
import Renderer from '../render/Renderer.js';
import { BinaryWriter, PROTOCOL } from '../net/Protocol.js';

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
        this.mapCenterSet = false;

        this.lastTime = 0;
        this.frameCount = 0;
        this.fps = 0;
        this.fpsLastUpdate = 0;

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
            fps: document.getElementById('fps'),
            showNames: document.getElementById('show-names'),
            showMass: document.getElementById('show-mass'),
            noSkins: document.getElementById('no-skins'),
            animDelay: document.getElementById('anim-delay'),
            animDelayValue: document.getElementById('anim-delay-value'),
            darkTheme: document.getElementById('dark-theme'),
            userCoins: document.getElementById('user-coins'),
            shopGrid: document.getElementById('shop-grid'),
            shopCatBtns: document.querySelectorAll('.shop-cat-btn'),
            buySelectBtn: document.getElementById('buy-select-btn'),
            previewCanvas: document.getElementById('skin-preview-canvas'),
            previewName: document.getElementById('preview-name'),
            ping: document.getElementById('ping'),
            hotkeyBtns: document.querySelectorAll('.key-btn'),
            tabs: document.querySelectorAll('.tab-btn'),
            tabContents: document.querySelectorAll('.tab-content')
        };

        this.config = {
            showNames: true,
            showMass: true,
            noSkins: false,
            darkTheme: true,
            animationDelay: 120,
            coins: 5000,
            ownedSkins: [],
            selectedSkin: '',
            hotkeys: {
                split: 'Space',
                feed: 'KeyW',
                double: 'KeyQ',
                triple: 'KeyE',
                quad: 'KeyC',
                macro: 'KeyZ',
                botSplit: 'KeyR',
                botFeed: 'KeyT',
                freeze: 'KeyF'
            }
        };

        this.macroInterval = null;
        this.bindingKey = null; // Element currently being rebound
        this.heldKeys = new Set();
        this.isFrozen = false;
        this.playing = false;

        this.shopData = {
            level: [
                { id: '3ezzy', name: '3ezzy', price: 0, type: 'skin' },
                { id: '52k', name: '52k', price: 0, type: 'skin' },
            ],
            owner: [
                { id: '3ezzy', name: '3ezzy', price: 0, type: 'skin' },
                { id: '52k', name: '52k', price: 0, type: 'skin' },
            ],
            premium: [
                { id: '3ezzy', name: '3ezzy', price: 0, type: 'skin' },
                { id: '52k', name: '52k', price: 0, type: 'skin' },
            ],
            coins: [
                { id: 'coins_1000', name: '1000 Coins', price: 0.99, type: 'coins', amount: 1000 },
                { id: 'coins_5000', name: '5000 Coins', price: 3.99, type: 'coins', amount: 5000 }
            ]
        };

        this.currentShopCategory = 'level';
        this.previewItem = null;
        this.pingStart = 0;
        this.pingInterval = null;

        this.loadSettings();
        this.init();
    }

    loadSettings() {
        try {
            const saved = localStorage.getItem('agarv1_settings');
            if (saved) {
                const settings = JSON.parse(saved);
                if (settings.nickname) this.ui.nickname.value = settings.nickname;
                if (settings.serverUrl) this.ui.serverUrl.value = settings.serverUrl;
                if (settings.config) {
                    this.config = { ...this.config, ...settings.config };
                    this.ui.showNames.checked = this.config.showNames;
                    this.ui.showMass.checked = this.config.showMass;
                    this.ui.noSkins.checked = this.config.noSkins || false;
                    this.ui.darkTheme.checked = this.config.darkTheme !== false;
                    this.ui.animDelay.value = this.config.animationDelay;
                    this.ui.animDelayValue.textContent = this.config.animationDelay;

                    // Update Hotkey Buttons
                    if (this.config.hotkeys) {
                        this.ui.hotkeyBtns.forEach(btn => {
                            const action = btn.dataset.action;
                            if (this.config.hotkeys[action]) {
                                btn.textContent = this.config.hotkeys[action].replace('Key', '').replace('Digit', '');
                            }
                        });
                    }
                }
            }
        } catch (e) {
            console.error("Failed to load settings:", e);
        }
    }

    saveSettings() {
        try {
            const settings = {
                nickname: this.ui.nickname.value,
                serverUrl: this.ui.serverUrl.value,
                config: this.config
            };
            localStorage.setItem('agarv1_settings', JSON.stringify(settings));
        } catch (e) {
            console.error("Failed to save settings:", e);
        }
    }

    init() {
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.ui.playBtn.addEventListener('click', () => this.handlePlay());
        this.ui.spectateBtn.addEventListener('click', () => this.handleSpectate());

        // Config Bindings
        this.ui.showNames.addEventListener('change', (e) => {
            this.config.showNames = e.target.checked;
            this.saveSettings();
        });
        this.ui.showMass.addEventListener('change', (e) => {
            this.config.showMass = e.target.checked;
            this.saveSettings();
        });
        this.ui.noSkins.addEventListener('change', (e) => {
            this.config.noSkins = e.target.checked;
            this.saveSettings();
        });
        this.ui.darkTheme.addEventListener('change', (e) => {
            this.config.darkTheme = e.target.checked;
            this.saveSettings();
        });
        this.ui.animDelay.addEventListener('input', (e) => {
            this.config.animationDelay = parseInt(e.target.value);
            this.ui.animDelayValue.textContent = e.target.value;
            this.saveSettings();
        });

        // Hotkey Bindings
        this.ui.hotkeyBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                if (this.bindingKey) this.bindingKey.classList.remove('waiting');
                this.bindingKey = btn;
                btn.classList.add('waiting');
                btn.textContent = '...';
            });
        });

        // Tab Switching
        this.ui.tabs.forEach(btn => {
            btn.addEventListener('click', () => {
                const tabId = btn.dataset.tab;
                this.ui.tabs.forEach(b => b.classList.toggle('active', b === btn));
                this.ui.tabContents.forEach(c => c.classList.toggle('active', c.id === tabId));
                if (tabId === 'tab-shop') {
                    this.refreshShop();
                }
            });
        });

        // Shop Category Buttons
        this.ui.shopCatBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.currentShopCategory = btn.dataset.cat;
                this.ui.shopCatBtns.forEach(b => b.classList.toggle('active', b === btn));
                this.refreshShop();
            });
        });

        // Buy/Select Button
        this.ui.buySelectBtn.addEventListener('click', () => {
            this.handleShopAction();
        });

        window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
        window.addEventListener('keyup', (e) => this.handleKeyUp(e));
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
            this.hideMenu();
            this.playing = true;

            if (nickname !== this.nickname || this.ownIds.length === 0) {
                this.nickname = nickname;
                this.connection.spawn(this.nickname, this.config.selectedSkin);
            }
            return;
        }

        this.nickname = nickname;
        this.hideMenu();
        this.playing = true;

        this.reset();
        this.saveSettings();
        this.connection.connect(url, this.nickname, false, this.config.selectedSkin);
    }
    handleSpectate() {
        const nickname = this.ui.nickname.value || 'Unnamed';
        const url = this.ui.serverUrl.value || 'ws://localhost:8080';

        if (this.connection.ws && this.connection.ws.readyState === WebSocket.OPEN && this.connection.url === url) {
            this.hideMenu();
            this.playing = false;
            this.connection.spectate();
            return;
        }

        this.nickname = nickname;
        this.hideMenu();
        this.playing = false;

        this.reset();
        this.saveSettings();
        this.connection.connect(url, this.nickname, true);
    }
    reset() {
        this.clearAll();
        this.serverTime = 0;
        this.lastSyncLocal = 0;
        this.clockOffset = 0;
        this.mapCenterSet = false;
        this.renderer.serverCamera = false;
    }

    clearAll() {
        this.nodes.clear();
        this.ownIds = [];
    }

    clearOwn() {
        this.ownIds.forEach(id => this.nodes.delete(id));
        this.ownIds = [];
        this.showMenu();
    }

    showMenu() {
        this.ui.mainMenu.style.display = 'flex';
        this.ui.leaderboard.style.display = 'none';
        this.ui.stats.style.display = 'none';
        this.playing = false;
    }

    hideMenu() {
        this.ui.mainMenu.style.display = 'none';
        this.ui.leaderboard.style.display = 'block';
        this.ui.stats.style.display = 'flex';
        this.startPing();
    }

    startPing() {
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
            if (this.connection.ws && this.connection.ws.readyState === WebSocket.OPEN) {
                this.pingStart = performance.now();
                this.connection.send(new Uint8Array([255])); // Dummy byte for ping
            }
        }, 2000);
    }

    updatePing() {
        if (this.pingStart === 0) return;
        const ping = Math.round(performance.now() - this.pingStart);
        this.ui.ping.textContent = `Ping: ${ping}ms`;
        this.ui.ping.className = ping > 150 ? 'high' : '';
        this.pingStart = 0;
    }

    refreshShop() {
        this.ui.userCoins.textContent = this.config.coins;
        const items = this.shopData[this.currentShopCategory] || [];
        this.ui.shopGrid.innerHTML = items.map(item => {
            const isOwned = this.config.ownedSkins.includes(item.id);
            const isSelected = this.config.selectedSkin === item.id;
            const imgPath = item.type === 'skin' ? `./skins/${item.id}.png` : './assets/res/noSkin.png';

            return `
                <div class="shop-item ${isSelected ? 'selected' : ''}" data-id="${item.id}">
                    <img src="${imgPath}" onerror="this.src='./assets/res/noSkin.png'">
                    <span class="item-name">${item.name}</span>
                    <span class="item-price">${isOwned ? 'OWNED' : (item.type === 'coins' ? '$' + item.price : item.price + ' Coins')}</span>
                </div>
            `;
        }).join('');

        this.ui.shopGrid.querySelectorAll('.shop-item').forEach(el => {
            el.addEventListener('click', () => {
                const item = items.find(i => i.id === el.dataset.id);
                this.selectPreview(item);
            });
        });
    }

    selectPreview(item) {
        this.previewItem = item;
        this.ui.previewName.textContent = item.name;

        const isOwned = this.config.ownedSkins.includes(item.id);
        const isSelected = this.config.selectedSkin === item.id;

        if (item.type === 'coins') {
            this.ui.buySelectBtn.textContent = `Buy for $${item.price}`;
            this.ui.buySelectBtn.disabled = false;
        } else {
            if (isOwned) {
                this.ui.buySelectBtn.textContent = isSelected ? 'Selected' : 'Select Skin';
                this.ui.buySelectBtn.disabled = isSelected;
            } else {
                this.ui.buySelectBtn.textContent = `Buy for ${item.price}`;
                this.ui.buySelectBtn.disabled = this.config.coins < item.price;
            }
        }

        this.drawPreview(item);
    }

    drawPreview(item) {
        const canvas = this.ui.previewCanvas;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const radius = 70;

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);

        if (item.type === 'skin') {
            const skinImg = this.renderer.getSkin(item.id);
            if (skinImg && skinImg.complete) {
                ctx.save();
                ctx.clip();
                ctx.drawImage(skinImg, centerX - radius, centerY - radius, radius * 2, radius * 2);
                ctx.restore();
            } else {
                ctx.fillStyle = '#3a7bd5';
                ctx.fill();
            }
        } else {
            ctx.fillStyle = '#ffd700';
            ctx.fill();
        }
    }

    handleShopAction() {
        if (!this.previewItem) return;
        const item = this.previewItem;

        if (item.type === 'coins') {
            alert(`Mock: Redirecting to payment for ${item.name}`);
            this.config.coins += item.amount;
            this.saveSettings();
            this.refreshShop();
            return;
        }

        const isOwned = this.config.ownedSkins.includes(item.id);
        if (isOwned) {
            this.config.selectedSkin = item.id;
            this.saveSettings();
            this.refreshShop();
            this.selectPreview(item);
        } else {
            if (this.config.coins >= item.price) {
                this.config.coins -= item.price;
                this.config.ownedSkins.push(item.id);
                this.config.selectedSkin = item.id; // Auto-select on purchase
                this.saveSettings();
                this.refreshShop();
                this.selectPreview(item);
            }
        }
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
        if (this.bindingKey) {
            const action = this.bindingKey.dataset.action;
            this.config.hotkeys[action] = e.code;
            this.bindingKey.textContent = e.code.replace('Key', '').replace('Digit', '');
            this.bindingKey.classList.remove('waiting');
            this.bindingKey = null;
            this.saveSettings();
            return;
        }

        if (this.heldKeys.has(e.code)) return;
        this.heldKeys.add(e.code);

        if (e.code === 'Escape') {
            const isHidden = this.ui.mainMenu.style.display === 'none';
            this.ui.mainMenu.style.display = isHidden ? 'flex' : 'none';
            return;
        }

        // Action Mapping
        const h = this.config.hotkeys;
        if (e.code === h.split) {
            this.connection.send(new Uint8Array([17]));
        } else if (e.code === h.feed) {
            this.connection.send(new Uint8Array([21]));
        } else if (e.code === h.double) {
            if (this.playing) {
                this.executeMultiSplit(2);
            } else {
                // MultiOgarII: Toggle between follow and free-roam
                this.connection.send(new Uint8Array([18]));
            }
        } else if (e.code === h.triple) {
            this.executeMultiSplit(4);
        } else if (e.code === h.quad) {
            this.executeMultiSplit(16);
        } else if (e.code === h.macro) {
            this.startMacroFeed();
        } else if (e.code === h.botSplit) {
            this.connection.send(new Uint8Array([22]));
        } else if (e.code === h.botFeed) {
            this.connection.send(new Uint8Array([23]));
        } else if (e.code === h.freeze) {
            this.isFrozen = !this.isFrozen;
        }
    }

    handleKeyUp(e) {
        this.heldKeys.delete(e.code);
        if (e.code === this.config.hotkeys.macro) {
            this.stopMacroFeed();
        }
    }

    executeMultiSplit(times) {
        let count = 0;
        const interval = setInterval(() => {
            this.connection.send(new Uint8Array([17]));
            count++;
            if (count >= times) clearInterval(interval);
        }, 40);
    }

    startMacroFeed() {
        if (this.macroInterval) return;
        this.macroInterval = setInterval(() => {
            this.connection.send(new Uint8Array([21]));
        }, 40);
    }

    stopMacroFeed() {
        if (this.macroInterval) {
            clearInterval(this.macroInterval);
            this.macroInterval = null;
        }
    }

    sendMouse() {
        if (!this.connection.ws || this.connection.ws.readyState !== WebSocket.OPEN) return;
        if (this.isFrozen) return;
        const renderer = this.renderer;
        const scale = renderer.scale;
        const worldX = (this.mouseX - this.canvas.width / 2) / scale + renderer.camX;
        const worldY = (this.mouseY - this.canvas.height / 2) / scale + renderer.camY;

        const writer = new BinaryWriter();
        writer.writeUInt8(0x10); // Mouse move
        writer.writeUInt32(Math.floor(worldX));
        writer.writeUInt32(Math.floor(worldY));
        writer.writeUInt32(0); // Zero/Key
        this.connection.send(writer.build());
    }

    updateNode(id, x, y, size, color, name, skin, jagged, ejected) {
        let node = this.nodes.get(id);
        const now = this.getSyncedTime();

        // Auto-extract skin from name if the explicit skin is missing
        let extractedSkin = skin;
        if (!extractedSkin && name) {
            extractedSkin = Game.extractSkin(name);
        }

        if (!node) {
            node = {
                id, x, y, size, color, name, skin: extractedSkin, jagged, ejected,
                targetX: x, targetY: y, targetSize: size,
                startX: x, startY: y, startSize: size,
                lastUpdate: now,
                born: Date.now(),
                destroyed: false,
                dead: 0
            };
            this.nodes.set(id, node);
        } else {
            node.startX = node.x; // Current interpolated position becomes the new start
            node.startY = node.y;
            node.startSize = node.size;
            node.targetX = x;
            node.targetY = y;
            node.targetSize = size;
            node.lastUpdate = now;
            if (color !== null) node.color = color;
            if (name !== null) {
                node.name = name;
                // Update skin if it wasn't explicitly provided but can be extracted from the new name
                if (!skin) {
                    const s = Game.extractSkin(name);
                    if (s) node.skin = s;
                }
            }
            if (skin !== null) node.skin = skin;
            if (jagged !== undefined) node.jagged = jagged;
            if (ejected !== undefined) node.ejected = ejected;
        }
    }

    removeNode(id) {
        const node = this.nodes.get(id);
        if (node) {
            node.destroyed = true;
            node.dead = Date.now();
        }
        const idx = this.ownIds.indexOf(id);
        if (idx !== -1) {
            this.ownIds.splice(idx, 1);
            if (this.ownIds.length === 0 && this.playing) {
                setTimeout(() => {
                    if (this.ownIds.length === 0) this.showMenu();
                }, 500); // Small delay to let the death animation play out
            }
        }
    }

    static parseName(name) {
        if (!name) return "";
        // Removes all combinations of {skin} and <level/rank/skin> tags at the start recursively
        return name.replace(/^(\{[^}]*\}|<[^>]*>)+/, '').trim();
    }

    static extractSkin(name) {
        if (!name) return "";
        // Prioritize <skin> format, fall back to {skin}
        const match = name.match(/^<([^>]*)>/) || name.match(/^\{([^}]*)\}/);
        return match ? match[1].toLowerCase().trim() : "";
    }

    updateLeaderboard(list) {
        this.ui.lbList.innerHTML = list.map((item, index) => {
            const cleanName = Game.parseName(item.name);
            const isMe = this.ownIds.some(id => {
                const node = this.nodes.get(id);
                return node && node.name === item.name;
            });
            return `
                <li class="${isMe ? 'me' : ''}" data-id="${item.id}" data-name="${item.name}">
                    <span class="rank">${index + 1}</span>
                    <span class="name">${cleanName || 'An un-named cell'}</span>
                </li>`;
        }).join('');

        this.ui.lbList.querySelectorAll('li').forEach(el => {
            el.addEventListener('click', () => {
                const id = parseInt(el.dataset.id);
                const name = el.dataset.name;
                this.handleLeaderboardClick(id, name);
            });
        });
    }

    handleLeaderboardClick(id, name) {
        if (this.playing || !this.connection.ws || this.connection.ws.readyState !== WebSocket.OPEN) {
            this.handleSpectate();
        }

        // Update renderer for manual tracking if server ID fails
        this.renderer.spectateTargetName = name;
        this.renderer.serverCamera = false; // Briefly take over to find the target

        // Protocol 6 Spectate Targeted (supported by Ogar v6 variants)
        const writer = new BinaryWriter();
        writer.writeUInt8(1); // SPECTATE
        if (id) {
            writer.writeUInt32(id);
        }
        this.connection.send(writer.build());
    }

    loop(time) {
        if (!this.lastTime) {
            this.lastTime = time;
            this.fpsLastUpdate = time;
        }

        const delta = time - this.lastTime;
        this.lastTime = time;

        // Contador de frames
        this.frameCount++;

        // Actualizar FPS cada 500ms (más estable)
        if (time - this.fpsLastUpdate >= 500) {
            this.fps = Math.round((this.frameCount * 1000) / (time - this.fpsLastUpdate));
            this.frameCount = 0;
            this.fpsLastUpdate = time;
            this.ui.fps.innerText = `FPS: ${this.fps}`;
        }
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
