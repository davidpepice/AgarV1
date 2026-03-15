import Connection from '../net/Connection.js';
import Renderer from '../render/Renderer.js';
import PixiRenderer from '../render/PixiRenderer.js';
import { BinaryWriter, BinaryReader, PROTOCOL } from '../net/Protocol.js';
import { getSkinList } from '../utils/SkinLoader.js';

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.renderer = new Renderer(this);
        this.pixiRenderer = null; // Created on first toggle
        this.activeRenderer = this.renderer; // Default to 2D Canvas renderer
        this.connection = new Connection(this);

        this.nodes = new Map();
        this.ownIds = [];
        this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window);
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
            serverList: document.getElementById('server-list'),
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
            previewCanvas: document.getElementById('skin-preview-canvas'),
            ping: document.getElementById('ping'),
            hotkeyBtns: document.querySelectorAll('.key-btn'),
            connectingOverlay: document.getElementById('connecting-overlay'),
            connectingText: document.getElementById('connecting-text'),
            connectingSpinner: document.getElementById('connecting-spinner'),
            gpuBtn: document.getElementById('gpu-btn')
        };

        this.config = {
            showNames: true,
            showMass: true,
            noSkins: false,
            darkTheme: true,
            usePixi: false,
            noGrid: false,
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

        // Joystick state
        this.joystick = {
            active: false,
            touchId: null,
            originX: 0,
            originY: 0,
            x: 0,
            y: 0,
            distance: 0,
            angle: 0
        };

        // Build shop data dynamically from detected skin files
        const allSkins = getSkinList().map(s => ({ ...s, price: 0, type: 'skin' }));
        this.shopData = {
            level: allSkins,
            owner: allSkins,
            premium: allSkins,
            coins: [
                { id: 'coins_1000', name: '1000 Coins', price: 0.99, type: 'coins', amount: 1000 },
                { id: 'coins_5000', name: '5000 Coins', price: 3.99, type: 'coins', amount: 5000 }
            ]
        };

        this.currentShopCategory = 'level';
        this.previewItem = null;
        this.pingStart = 0;
        this.pingInterval = null;

        this.servers = [
            { id: 'local_ffa', name: 'Local FFA', url: this.connection.url, mode: 'FFA', players: '0' },
            { id: 'local_teams', name: 'Local Teams', url: 'ws://localhost:8081', mode: 'Teams', players: '0' },
            { id: 'public_1', name: 'Public NA', url: 'ws://127.0.0.1:8082', mode: 'FFA', players: '0' }
        ];
        this.currentServerUrl = this.servers[0].url;

        this.loadSettings();
        this.init();
        this.initServers();
    }

    loadSettings() {
        try {
            const saved = localStorage.getItem('agarv1_settings');
            if (saved) {
                const settings = JSON.parse(saved);
                if (settings.nickname) this.ui.nickname.value = settings.nickname;
                if (settings.currentServerUrl) this.currentServerUrl = settings.currentServerUrl;
                if (settings.config) {
                    this.config = { ...this.config, ...settings.config };
                    this.ui.showNames.checked = this.config.showNames;
                    this.ui.showMass.checked = this.config.showMass;
                    this.ui.noSkins.checked = this.config.noSkins || false;
                    this.ui.darkTheme.checked = this.config.darkTheme !== false;
                    
                    // Only enable GPU if WebGL is supported
                    const webglSupported = Game.supportsWebGL();
                    if (this.config.usePixi && !webglSupported) {
                        console.warn('[Game] WebGL not supported, disabling GPU mode');
                        this.config.usePixi = false;
                    }
                    
                    if (this.ui.gpuBtn) {
                        this.ui.gpuBtn.checked = this.config.usePixi || false;
                    }
                    
                    this.ui.animDelay.value = this.config.animationDelay;
                    this.ui.animDelayValue.textContent = this.config.animationDelay;

                    // Initialize PixiRenderer if saved AND WebGL is available
                    // Don't toggle here - wait for user input in menu
                    if (this.config.usePixi && webglSupported) {
                        console.log('[Game] PixiJS will be available when user activates GPU mode');
                    }

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
            currentServerUrl: this.currentServerUrl,
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

        // Fullscreen button
        const fullscreenBtn = document.getElementById('fullscreen-btn');
        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', () => {
                console.log('[Game] Fullscreen clicked');
                this.toggleFullscreen();
            });
        }

        // Toggle UI button
        const toggleUiBtn = document.getElementById('toggle-ui-btn');
        if (toggleUiBtn) {
            toggleUiBtn.addEventListener('click', () => {
                console.log('[Game] Toggle UI clicked');
                this.toggleUI();
            });
        }

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
        if (this.ui.gpuBtn) {
            // Check WebGL support and disable if not available
            const webglSupported = Game.supportsWebGL();
            //console.log(`[Game] WebGL Support: ${webglSupported}`);
            
            if (!webglSupported) {
                this.ui.gpuBtn.disabled = true;
                this.ui.gpuBtn.title = 'WebGL no está soportado en este navegador';
                this.config.usePixi = false;
            }
            
            this.ui.gpuBtn.addEventListener('change', (e) => {
                if (!webglSupported) {
                    e.target.checked = false;
                    return;
                }
                
                // Toggle GPU mode without page reload
                this.config.usePixi = e.target.checked;
                this.saveSettings();
                this.toggleRenderer(this.config.usePixi);
            });
        }
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

        // Close Modal Events handled inline in HTML via .closest('.modal').classList.remove('active')
        // However, we should refresh shop if shop tab is opened
        const openShopBtn = document.querySelector('.shop-mini-panel .btn-secondary');
        if (openShopBtn) {
            openShopBtn.addEventListener('click', () => {
                this.refreshShop();
            });
        }

        // Shop Category Buttons
        this.ui.shopCatBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.currentShopCategory = btn.dataset.cat;
                this.ui.shopCatBtns.forEach(b => b.classList.toggle('active', b === btn));
                this.refreshShop();
            });
        });

        window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
        window.addEventListener('keyup', (e) => this.handleKeyUp(e));
        window.addEventListener('wheel', (e) => this.handleWheel(e), { passive: true });
        window.addEventListener('blur', () => {
            this.heldKeys.clear();
            this.stopMacroFeed();
        });

        if (this.isMobile) {
            this.ui.touchControls = document.getElementById('touch-controls');
            this.ui.touchControls.style.display = 'block';  // Use classList instead of style
            this.initTouchControls();
            
        }

        this.autoConnect();
        requestAnimationFrame((t) => this.loop(t));
    }

    initTouchControls() {
        const joystick = document.getElementById('joystick-container');
        const nipple = document.getElementById('joystick-nipple');
        const btnSplit = document.getElementById('btn-split');
        const btnFeed = document.getElementById('btn-feed');

        const handleTouch = (e) => {
            if (!this.joystick.active) return;
            var touch = Array.from(e.touches).find(t => t.identifier === this.joystick.touchId);
            if (!touch) return;

            const rect = joystick.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            var dx = touch.clientX - centerX;
            var dy = touch.clientY - centerY;
            const distance = Math.min(Math.sqrt(dx * dx + dy * dy), rect.width / 2);
            const angle = Math.atan2(dy, dx);

            this.joystick.x = Math.cos(angle) * distance;
            this.joystick.y = Math.sin(angle) * distance;
            this.joystick.distance = distance / (rect.width / 2);
            this.joystick.angle = angle;

            nipple.style.transform = `translate(calc(-50% + ${this.joystick.x}px), calc(-50% + ${this.joystick.y}px))`;
        };

        joystick.addEventListener('touchstart', (e) => {
            if (this.joystick.active) return;
            const touch = e.changedTouches[0];
            this.joystick.active = true;
            this.joystick.touchId = touch.identifier;
            handleTouch(e);
            e.preventDefault();
        }, { passive: false });

        window.addEventListener('touchmove', (e) => {
            if (this.joystick.active) {
                handleTouch(e);
                // Solo se impedirá el comportamiento predeterminado si detectamos que el joystick toca para evitar bloquear otros elementos. 
                if (Array.from(e.changedTouches).some(t => t.identifier === this.joystick.touchId)) {
                    e.preventDefault();
                }
            }
        }, { passive: false });

        window.addEventListener('touchend', (e) => {
            if (this.joystick.active) {
                const touchEnded = Array.from(e.changedTouches).some(t => t.identifier === this.joystick.touchId);
                if (touchEnded) {
                    this.joystick.active = true; // false
                    this.joystick.touchId = touch.identifier; // null 
                    const distance = Math.min(Math.sqrt(dx * dx + dy * dy), rect.width / 2);
                    const angle = Math.atan2(dy, dx);

                    this.joystick.x = Math.cos(angle) * distance;
                    this.joystick.y = Math.sin(angle) * distance;
                    //this.joystick.x = 0;
                    //this.joystick.y = 0;
                    this.joystick.distance = 0;
                    nipple.style.transform = `translate(-50%, -50%)`;
                }
            }
        });

        // Split button
        btnSplit.addEventListener('touchstart', (e) => {
            this.connection.send(new Uint8Array([17]));
            btnSplit.classList.add('active');
            e.preventDefault();
        }, { passive: false });

        btnSplit.addEventListener('touchend', () => {
            btnSplit.classList.remove('active');
        });

        // Feed button (Macro)
        btnFeed.addEventListener('touchstart', (e) => {
            this.startMacroFeed();
            btnFeed.classList.add('active');
            e.preventDefault();
        }, { passive: false });

        btnFeed.addEventListener('touchend', () => {
            this.stopMacroFeed();
            btnFeed.classList.remove('active');
        });
    }

    autoConnect() {
        const url = this.currentServerUrl || 'ws://localhost:8080';
        //console.log("Auto-connecting to server...");
        this.showConnecting("Connecting to server...");
        this.connection.connect(url, "Spectator", true);
    }

    showConnecting(message = "Connecting...") {
        this.ui.connectingText.textContent = message;
        this.ui.connectingOverlay.classList.remove('success', 'error');
        this.ui.connectingSpinner.style.display = 'block';
        this.ui.connectingOverlay.style.display = 'flex';
    }

    showConnected() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        this.ui.connectingOverlay.classList.remove('error');
        this.ui.connectingOverlay.classList.add('success');
        this.ui.connectingText.textContent = "Connected!";
        this.ui.connectingSpinner.style.display = 'none';

        setTimeout(() => {
            this.hideConnecting();
        }, 2000);
    }

    showConnectionError(url) {
        this.ui.connectingOverlay.classList.remove('success');
        this.ui.connectingOverlay.classList.add('error');
        // Clean up URL for display
        const cleanUrl = url.replace('ws://', '').replace('wss://', '');
        const serverName = this.servers.find(s => s.url === url)?.name;
        this.ui.connectingText.textContent = `Error connecting to '${serverName}'... Retrying in 2s.`;
        this.ui.connectingSpinner.style.display = 'none';
        this.ui.connectingOverlay.style.display = 'flex';

        // Schedule auto-reconnect every 2 seconds
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = setTimeout(() => {
            const currentUrlInput = this.currentServerUrl || 'ws://192.168.0.250:8080';
            this.showConnecting("Reconnecting...");
            this.connection.connect(currentUrlInput, this.nickname, !this.playing, this.config.selectedSkin);
        }, 2000);
    }

    hideConnecting() {
        this.ui.connectingOverlay.style.display = 'none';
        this.ui.connectingOverlay.classList.remove('success', 'error');
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
    }

    handleWheel(e) {
        const delta = e.deltaY > 0 ? 0.9 : 1.1; 
        this.renderer.userZoom = Math.max(0.9, Math.min(4.5, this.renderer.userZoom * delta));
         
    }

    resize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        // Update 2D canvas
        this.canvas.width = width;
        this.canvas.height = height;
        this.renderer.setSize(width, height);
        this.renderer.viewportScale = Math.min(width, height) / 1200;
        
        // Update Pixi canvas if exists
        if (this.pixiRenderer) {
            // Update Pixi canvas dimensions
            this.pixiRenderer.canvas.width = width;
            this.pixiRenderer.canvas.height = height;
            this.pixiRenderer.canvas.style.width = width + 'px';
            this.pixiRenderer.canvas.style.height = height + 'px';
            
            // Tell PixiRenderer about size change
            this.pixiRenderer.setSize(width, height);
            this.pixiRenderer.viewportScale = Math.min(width, height) / 1200;
        }
    }

    handlePlay() {
        const nickname = this.ui.nickname.value || 'Unnamed';
        //const url = this.currentServerUrl || 'ws://192.168.0.250:8080';

        this.renderer.spectateTargetName = ""; // Clear manual spectate

        // If connection is not open, show overlay and wait
        /*if (!this.connection.ws || this.connection.ws.readyState !== WebSocket.OPEN) {
            this.showConnecting("Connecting to server...");
            this.connection.connect(url, nickname, false, this.config.selectedSkin);
            return;
        }*/

        // If already connected but as spectator or different server, update and spawn
        /*if (this.connection.url !== url) {
            this.showConnecting("Connecting to server...");
            this.connection.connect(url, nickname, false, this.config.selectedSkin);
            return;
        }*/

        this.nickname = nickname;
        this.hideMenu();
        this.playing = true;
        this.connection.spawn(this.nickname, this.config.selectedSkin);
        this.saveSettings();
    }
    handleSpectate() {
        const nickname = this.ui.nickname.value || 'Unnamed';
       /* const url = this.currentServerUrl || 'ws://localhost:8080';

        if (this.connection.ws && this.connection.ws.readyState === WebSocket.OPEN && this.connection.url === url) {
            this.hideMenu();
            this.playing = false;
            this.connection.spectate();
            return;
        }*/

        //this.showConnecting("Connecting to server...");
        this.nickname = nickname;
        this.hideMenu();
        this.playing = false;

        this.reset();
        this.saveSettings();
       // this.connection.connect(url, this.nickname, true);
    }

    toggleFullscreen() {
        const elem = document.documentElement;
        
        if (!document.fullscreenElement) {
            // Request fullscreen
            if (elem.requestFullscreen) {
                elem.requestFullscreen().catch(err => console.error('[Game] Fullscreen error:', err));
            } else if (elem.webkitRequestFullscreen) {
                elem.webkitRequestFullscreen();
            } else if (elem.mozRequestFullScreen) {
                elem.mozRequestFullScreen();
            } else if (elem.msRequestFullscreen) {
                elem.msRequestFullscreen();
            }
        } else {
            // Exit fullscreen
            if (document.exitFullscreen) {
                document.exitFullscreen().catch(err => console.error('[Game] Exit fullscreen error:', err));
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        }
    }

    toggleUI() {
        const hud = document.getElementById('hud-container');
        const mainMenu = document.getElementById('main-menu');
        
        if (hud) {
            hud.classList.toggle('hidden-ui');
        }
        if (mainMenu && mainMenu.classList.contains('menu-overlay')) {
            mainMenu.classList.toggle('hidden-ui');
        }
    }

    initServers() {
        if (!this.ui.serverList) return;
        
        this.ui.serverList.innerHTML = this.servers.map(server => `
            <div class="server-item ${server.url === this.currentServerUrl ? 'active' : ''}" data-url="${server.url}">
                <div class="server-info">
                    <span class="server-name">${server.name}</span>
                    <span class="server-mode">${server.mode}</span>
                </div>
                <span class="server-players" id="players-${server.url.replace(/\W/g, '')}">${server.players} P</span>
            </div>
        `).join('');

        this.ui.serverList.querySelectorAll('.server-item').forEach(el => {
            el.addEventListener('click', () => {
                // Update active class UI
                this.ui.serverList.querySelectorAll('.server-item').forEach(s => s.classList.remove('active'));
                el.classList.add('active');
                
                // Update internal state
                this.currentServerUrl = el.dataset.url;
                this.saveSettings();
            });
        });
    }


    updateServerStats(stats, url) {
        // Find the server object and update it
        const server = this.servers.find(s => s.url === url);
        if (server) {
            server.players = stats.playersTotal !== undefined ? stats.playersTotal : server.players;
            if (stats.mode) server.mode = stats.mode;
            
            // Update UI dynamically
            const playersSpan = document.getElementById(`players-${url.replace(/\W/g, '')}`);
            if (playersSpan) {
                playersSpan.textContent = stats.playersTotal === 'Off' ? 'Offline' : `${stats.playersTotal} P`;
                if (stats.playersTotal === 'Off') {
                    playersSpan.style.color = '#ff4757';
                } else {
                    playersSpan.style.color = '#fff';
                }
            }
        }
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
            const imgPath = item.type === 'skin' ? (item.url || `./skins/${item.id}.png`) : './assets/res/noSkin.png';

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

        const isOwned = this.config.ownedSkins.includes(item.id);
        const isSelected = this.config.selectedSkin === item.id;

        if (item.type === 'coins') {
            alert(`Mock: Redirecting to payment for ${item.name}`);
            this.config.coins += item.amount || 1000;
            this.saveSettings();
            this.refreshShop();
            return;
        }

        if (isOwned) {
            this.config.selectedSkin = item.id;
            this.saveSettings();
            this.refreshShop();
        } else {
            if (this.config.coins >= item.price) {
                this.config.coins -= item.price;
                this.config.ownedSkins.push(item.id);
                this.config.selectedSkin = item.id; // Auto-select on purchase
                this.saveSettings();
                this.refreshShop();
            } else {
                alert(`Not enough coins! You need ${item.price} coins.`);
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
        // Prevent game actions if the user is typing in an input field
        const activeElement = document.activeElement;
        const isTyping = activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA');

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
            if (isHidden) {
                this.ui.mainMenu.style.display = 'flex';
            } else {
                this.hideMenu();
            }
            return;
        }

        // If typing or menu is visible, don't execute game actions
        if (isTyping || this.ui.mainMenu.style.display !== 'none') return;

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
                this.renderer.spectateTargetName = ""; // Reset manual focus
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
        }, 35); // 35ms to avoid server tick skipping (MultiOgarII is 40ms)
    }

    startMacroFeed() {
        if (this.macroInterval) return;
        this.macroInterval = setInterval(() => {
            this.connection.send(new Uint8Array([21]));
        }, 10);
    }

    stopMacroFeed() {
        if (this.macroInterval) {
            clearInterval(this.macroInterval);
            this.macroInterval = null;
        }
    }

    sendMouse() {
        if (!this.connection.ws || this.connection.ws.readyState !== WebSocket.OPEN) return;
        if (this.isFrozen || (this.ui.mainMenu.style.display !== 'none' && !this.isMobile)) return;

        const renderer = this.activeRenderer || this.renderer;
        const scale = renderer.scale;
        let worldX, worldY;

        if (this.isMobile && this.joystick.distance > 0.1) {
            // Mobile: Position relative to cell center in world coordinates
            worldX = renderer.camX + (this.joystick.x / scale) * 5; // Amplified for responsiveness
            worldY = renderer.camY + (this.joystick.y / scale) * 5;
        } else if (!this.isMobile) {
            // Desktop: Position based on screen coordinates
            worldX = (this.mouseX - this.canvas.width / 2) / scale + renderer.camX;
            worldY = (this.mouseY - this.canvas.height / 2) / scale + renderer.camY;
        } else {
            return; // No movement on mobile if joystick is idle
        }

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

    toggleRenderer(usePixi) {
        if (usePixi && !this.activeRenderer.constructor.name.includes('Pixi')) {
            // Switch TO PixiJS
            try {
                if (!this.pixiRenderer) {
                    console.log('[Renderer] Initializing PixiJS v8...');
                    this.pixiRenderer = new PixiRenderer(this);
                    
                    // Copy camera state from Canvas renderer
                    this.pixiRenderer.camX = this.renderer.camX;
                    this.pixiRenderer.camY = this.renderer.camY;
                    this.pixiRenderer.scale = this.renderer.scale;
                    this.pixiRenderer.target = { ...this.renderer.target };
                }
                
                // Wait for initialization with timeout
                const maxAttempts = 50; // 5 seconds max (50 * 100ms)
                let attempts = 0;
                
                const checkReady = setInterval(() => {
                    attempts++;
                    
                    if (this.pixiRenderer.ready) {
                        clearInterval(checkReady);
                        console.log('[Renderer] Switching to PixiJS');
                        
                        // Show Pixi canvas, hide 2D canvas
                        document.getElementById('gameCanvas').style.display = 'none';
                        this.pixiRenderer.canvas.style.display = 'block';
                        
                        this.activeRenderer = this.pixiRenderer;
                        this.config.usePixi = true;
                        this.saveSettings();
                    } else if (this.pixiRenderer.initError) {
                        clearInterval(checkReady);
                        console.error('[Renderer] PixiJS initialization failed:', this.pixiRenderer.initError);
                        this._fallbackToCanvas();
                    } else if (attempts >= maxAttempts) {
                        clearInterval(checkReady);
                        console.warn('[Renderer] PixiJS initialization timeout');
                        this._fallbackToCanvas();
                    }
                }, 100);
            } catch (err) {
                console.error('[Renderer] Error initializing PixiJS:', err);
                this._fallbackToCanvas();
            }
        } else if (!usePixi && this.activeRenderer.constructor.name.includes('Pixi')) {
            // Switch BACK to Canvas 2D
            console.log('[Renderer] Switching back to Canvas 2D');
            
            try {
                // Hide Pixi canvas, show 2D canvas
                if (this.pixiRenderer) {
                    this.pixiRenderer.canvas.style.display = 'none';
                    this.pixiRenderer.destroy();
                }
            } catch (err) {
                console.error('[Renderer] Error destroying PixiJS:', err);
            } finally {
                this.pixiRenderer = null;
                document.getElementById('gameCanvas').style.display = 'block';
                this.activeRenderer = this.renderer;
                this.config.usePixi = false;
                this.saveSettings();
            }
        }
    }

    _fallbackToCanvas() {
        console.warn('[Renderer] Falling back to Canvas 2D renderer');
        
        // Cleanup Pixi if it exists
        if (this.pixiRenderer) {
            try {
                this.pixiRenderer.destroy();
            } catch (e) {}
            this.pixiRenderer = null;
        }
        
        // Reset to Canvas
        this.activeRenderer = this.renderer;
        this.config.usePixi = false;
        
        if (this.ui.gpuBtn) {
            this.ui.gpuBtn.checked = false;
        }
        
        this.saveSettings();
        
        // Show warning to user
        const msg = 'WebGL no soportado en tu navegador. Usando Canvas 2D.';
        console.warn(msg);
        if (this.ui.connectingText) {
            this.ui.connectingText.textContent = msg;
        }
    }

    static supportsWebGL() {
        try {
            const canvas = document.createElement('canvas');
            // Try both webgl2 and webgl with power preference
            let gl = canvas.getContext('webgl2', {
                failIfMajorPerformanceCaveat: false,
                powerPreference: 'high-performance'
            });
            
            if (!gl) {
                gl = canvas.getContext('webgl', {
                    failIfMajorPerformanceCaveat: false,
                    powerPreference: 'high-performance'
                });
            }
            
            if (!gl) {
                gl = canvas.getContext('experimental-webgl');
            }
            
            const supported = !!gl;
            
            // Get WebGL info
            if (supported && gl) {
                try {
                    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                    if (debugInfo) {
                        const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
                        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
                        //console.log(`[Game] WebGL Renderer: ${vendor} / ${renderer}`);
                    }
                } catch (e) {}
            }
            
            return supported;
        } catch (e) {
            console.error('[Game] WebGL detection error:', e.message);
            return false;
        }
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
        if (time - this.fpsLastUpdate >= 100) {
            this.fps = Math.round((this.frameCount * 1000) / (time - this.fpsLastUpdate));
            this.frameCount = 0;
            this.fpsLastUpdate = time;
            this.ui.fps.innerText = `FPS: ${this.fps}`;
        }
        
        // Use activeRenderer instead of hardcoded this.renderer
        const rendererToUse = this.activeRenderer || this.renderer;
        rendererToUse.render();

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
