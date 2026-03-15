import {
    Application,
    Container,
    Graphics,
    Sprite,
    Texture,
    Assets,
    Text,
    TextStyle
} from "pixi.js";

/**
 * PixiRenderer - GPU renderer using PixiJS v8
 * Public interface identical to Renderer.js
 */
export default class PixiRenderer {
    constructor(game) {
        this.game = game;

        // Create our OWN canvas for Pixi, don't reuse the 2D canvas
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'gameCanvasPixi';
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.display = 'none';  // Hidden by default
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        // Insert right after the 2D canvas in DOM
        const canvas2d = document.getElementById('gameCanvas');
        if (canvas2d && canvas2d.parentNode) {
            canvas2d.parentNode.insertBefore(this.canvas, canvas2d.nextSibling);
        } else {
            document.body.appendChild(this.canvas);
        }

        this.camX = 0;
        this.camY = 0;
        this.target = { x: 0, y: 0, scale: 1 };
        this.scale = 1;
        this.userZoom = 1;
        this.viewportScale = 1;
        this.serverCamera = true;
        this.spectateTargetName = "";

        this.width = this.canvas.width;
        this.height = this.canvas.height;
        this.gridSize = 40;

        this.skinCache = new Map();
        this.nodeGfxMap = new Map();

        this.app = null;
        this.world = null;
        this.ready = false;
        this.initializing = false;
        this.initError = null; // Store initialization error

        this._initPixi();
    }

    async _initPixi() {
        if (this.initializing) return;
        this.initializing = true;
        this.initError = null;

        try {
            console.log('[PixiRenderer] Initializing PixiJS v8...');

            this.app = new Application();
            const dpr = window.devicePixelRatio || 1;

            // Initialize with the existing canvas element
            // Let PixiJS auto-detect the best renderer (WebGL fallback to Canvas)
            await this.app.init({
                canvas: this.canvas,
                width: this.width,
                height: this.height,
                background: this.game.config.darkTheme ? "#111111" : "#f2fbff",
                antialias: true,
                resolution: dpr,
                autoDensity: true,
                preference: "auto"  // Auto-detect, don't force webgl
            });

            const rendererType = this.app.renderer.type === 'webgl' ? 'WebGL' : 'Canvas';
            console.log(`[PixiRenderer] PixiJS initialized successfully (${rendererType})`);

            // Create rendering layers
            this.world = new Container();
            this.app.stage.addChild(this.world);

            this.gridGfx = new Graphics();
            this.borderGfx = new Graphics();
            this.nodeLayer = new Container();

            this.world.addChild(this.gridGfx);
            this.world.addChild(this.borderGfx);
            this.world.addChild(this.nodeLayer);

            // Load virus texture
            try {
                this.virusTexture = await Assets.load("./assets/res/virus.png");
                console.log('[PixiRenderer] Virus texture loaded');
            } catch (err) {
                console.warn('[PixiRenderer] Could not load virus texture:', err.message);
            }

            this.ready = true;
            this.initializing = false;
            console.log('[PixiRenderer] Ready for rendering');
        } catch (err) {
            this.initError = err.message || String(err);
            console.error('[PixiRenderer] Initialization error:', err);
            this.ready = false;
            this.initializing = false;

            // Don't rethrow - let the caller handle it via polling
        }
    }

    setSize(w, h) {
        this.width = w;
        this.height = h;

        const dpr = window.devicePixelRatio || 1;

        // Update canvas resolution
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';

        // Resize Pixi renderer
        if (this.app && this.app.renderer) {
            try {
                this.app.renderer.resize(w * dpr, h * dpr);
                console.log(`[PixiRenderer] Resized to ${w}x${h}`);
            } catch (err) {
                console.error('[PixiRenderer] Resize error:', err);
            }
        }
    }

    destroy() {
        try {
            console.log('[PixiRenderer] Destroying PixiJS instance...');

            // Clear caches first
            this.skinCache.clear();
            this.nodeGfxMap.clear();

            // Safely destroy children
            if (this.world) {
                try {
                    this.world.removeChildren();
                    this.world.destroy({ children: true });
                } catch (err) {
                    console.warn('[PixiRenderer] Error destroying world:', err);
                }
                this.world = null;
            }

            // Safely destroy graphics
            [this.gridGfx, this.borderGfx, this.nodeLayer].forEach(gfx => {
                if (gfx) {
                    try {
                        gfx.destroy({ children: true });
                    } catch (err) {
                        console.warn('[PixiRenderer] Error destroying graphics:', err);
                    }
                }
            });

            // Safely destroy app last
            if (this.app) {
                try {
                    // Minimal destroy - avoid internal issues
                    if (this.app.stage) {
                        this.app.stage.removeChildren();
                    }
                    if (this.app.renderer) {
                        this.app.renderer.destroy(false);
                    }
                } catch (err) {
                    console.warn('[PixiRenderer] Warning during app cleanup:', err.message);
                }
                this.app = null;
            }

            // Remove canvas from DOM
            if (this.canvas && this.canvas.parentNode) {
                try {
                    this.canvas.parentNode.removeChild(this.canvas);
                } catch (err) {
                    console.warn('[PixiRenderer] Error removing canvas from DOM:', err);
                }
            }

            this.ready = false;
            console.log('[PixiRenderer] Destroyed successfully');
        } catch (err) {
            console.error('[PixiRenderer] Error during destroy:', err);
            // Force cleanup
            this.app = null;
            this.world = null;
            this.ready = false;
        }
    }

    interpolateNodes() {
        const now = this.game.getSyncedTime();
        const animDelay = this.game.config.animationDelay;

        this.game.nodes.forEach(node => {
            const dt = Math.min((now - node.lastUpdate) / animDelay, 1);

            node.x = node.startX + (node.targetX - node.startX) * dt;
            node.y = node.startY + (node.targetY - node.startY) * dt;
            node.size = node.startSize + (node.targetSize - node.startSize) * dt;
        });
    }

    updateCamera() {
        if (!this.app || !this.world) return;

        const playerNodes = Array.from(this.game.nodes.values()).filter(n =>
            this.game.ownIds.includes(n.id) && !n.destroyed
        );

        if (playerNodes.length > 0) {
            let avgX = 0;
            let avgY = 0;
            let sumSize = 0;

            playerNodes.forEach(n => {
                avgX += n.x;
                avgY += n.y;
                sumSize += n.size;
            });

            this.target.x = avgX / playerNodes.length;
            this.target.y = avgY / playerNodes.length;

            const sizeScale = Math.pow(Math.min(64 / sumSize, 1), 0.4);
            this.target.scale = sizeScale * this.viewportScale * this.userZoom;
        }

        const lerpFactor = 0.1;
        const w = this.app.renderer.width || this.width;
        const h = this.app.renderer.height || this.height;

        this.camX += (this.target.x - this.camX) * lerpFactor;
        this.camY += (this.target.y - this.camY) * lerpFactor;
        this.scale += (this.target.scale - this.scale) * 0.05;

        this.world.x = w / 2 - this.camX * this.scale;
        this.world.y = h / 2 - this.camY * this.scale;
        this.world.scale.set(this.scale);
    }

    render() {
        if (!this.ready || !this.app) {
            return;
        }

        try {
            this.interpolateNodes();
            this.updateCamera();

            const isDark = this.game.config.darkTheme;
            this.app.renderer.background.color = isDark ? 0x111111 : 0xf2fbff;

            this._drawGrid(isDark);
            this._drawBorders();
            this._drawNodes();

            this.app.render();
        } catch (err) {
            console.error('[PixiRenderer] Render error:', err);
        }
    }

    _drawGrid(isDark) {
        if (!this.gridGfx) return;

        const g = this.gridGfx;
        g.clear();

        g.setStrokeStyle({
            width: 1 / this.scale,
            color: isDark ? 0x222222 : 0xd7e8f0
        });

        const halfW = (this.width / 2) / this.scale;
        const halfH = (this.height / 2) / this.scale;

        const left = this.camX - halfW;
        const top = this.camY - halfH;
        const right = this.camX + halfW;
        const bot = this.camY + halfH;

        const gs = this.gridSize;

        for (let x = Math.floor(left / gs) * gs; x < right; x += gs) {
            g.moveTo(x, top);
            g.lineTo(x, bot);
        }

        for (let y = Math.floor(top / gs) * gs; y < bot; y += gs) {
            g.moveTo(left, y);
            g.lineTo(right, y);
        }
    }

    _drawBorders() {
        if (!this.borderGfx) return;

        const b = this.game.borders;
        if (!b) return;

        const g = this.borderGfx;
        g.clear();

        const isDark = this.game.config.darkTheme;

        g.setStrokeStyle({
            width: 15 / this.scale,
            color: isDark ? 0xffffff : 0x222222
        });

        g.rect(b.l, b.t, b.r - b.l, b.b - b.t);
        g.stroke();
    }

    _drawNodes() {
        if (!this.nodeLayer) return;

        try {
            const nodes = Array.from(this.game.nodes.values()).sort((a, b) => a.size - b.size);
            const noSkins = this.game.config.noSkins;

            const liveIds = new Set();

            for (const node of nodes) {
                liveIds.add(node.id);
                this._drawNode(node, 1, noSkins);
            }

            // Cleanup removed nodes
            for (const [id] of this.nodeGfxMap) {
                if (!liveIds.has(id)) {
                    this._removeNodeGfx(id);
                }
            }
        } catch (err) {
            console.error('[PixiRenderer] Error drawing nodes:', err);
        }
    }

    _removeNodeGfx(id) {
        try {
            const container = this.nodeGfxMap.get(id);

            if (!container || !this.nodeLayer) return;

            this.nodeLayer.removeChild(container);
            container.destroy({ children: true });

            this.nodeGfxMap.delete(id);
        } catch (err) {
            console.warn('[PixiRenderer] Error removing node:', id, err);
            this.nodeGfxMap.delete(id);
        }
    }

    _drawNode(node, alpha, noSkins) {
        if (!this.nodeLayer) return;

        try {
            let container = this.nodeGfxMap.get(node.id);

            if (!container) {
                container = new Container();
                this.nodeLayer.addChild(container);
                this.nodeGfxMap.set(node.id, container);
            }

            container.x = node.x;
            container.y = node.y;
            container.alpha = alpha;

            let gfx = container.children[0];

            if (!(gfx instanceof Graphics)) {
                container.removeChildren();
                gfx = new Graphics();
                container.addChild(gfx);
            }

            gfx.clear();

            const colorHex = this._cssColorToHex(node.color || "#00ff22");

            gfx.circle(0, 0, node.size);
            gfx.fill(colorHex);

            if (node.size > 20 && !node.jagged && !node.ejected) {
                this._drawNodeText(container, node);
            }
        } catch (err) {
            console.warn('[PixiRenderer] Error drawing node:', node.id, err);
        }
    }

    _drawNodeText(container, node) {
        try {
            const showName = this.game.config.showNames && node.name;
            const showMass = this.game.config.showMass;

            if (!showName && !showMass) return;

            let label = container.getChildByName("label");

            let textContent = "";

            if (showName) {
                const cleanName = Game_parseName(node.name);
                textContent += cleanName;
            }

            if (showMass) {
                const mass = Math.floor((node.size * node.size) / 100);
                if (textContent) textContent += "\n";
                textContent += mass;
            }

            if (!label) {
                label = new Text({
                    text: textContent,
                    style: {
                        fontFamily: "Inter, sans-serif",
                        fontWeight: "bold",
                        fill: "#ffffff",
                        stroke: "#000000",
                        strokeThickness: 3,
                        align: "center"
                    }
                });

                label.name = "label";
                label.anchor.set(0.5);

                container.addChild(label);
            }
            else {
                label.text = textContent;
            }

            const targetW = node.size;
            const scale = targetW / Math.max(label.width, 1);

            label.scale.set(Math.min(scale, 1));
        } catch (err) {
            console.warn('[PixiRenderer] Error drawing node text:', node.id, err);
        }
    }

    _getSkinTexture(name) {
        try {
            if (!name) return null;

            name = name.toLowerCase().trim();

            if (this.skinCache.has(name))
                return this.skinCache.get(name);

            const texture = Texture.from(`./skins/${name}.png`);
            this.skinCache.set(name, texture);

            return texture;
        } catch (err) {
            console.warn('[PixiRenderer] Error loading skin texture:', name, err);
            return null;
        }
    }

    getSkin(name) {
        if (!name) return null;

        name = name.toLowerCase().trim();

        if (this._imgCache) {
            if (this._imgCache.has(name))
                return this._imgCache.get(name);
        } else {
            this._imgCache = new Map();
        }

        const img = new Image();
        img.src = `./skins/${name}.png`;

        this._imgCache.set(name, img);

        return img;
    }

    _cssColorToHex(css) {
        try {
            if (!css) return 0x00ff22;

            if (css.startsWith("#"))
                return parseInt(css.slice(1), 16);

            const m = css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);

            if (m)
                return (parseInt(m[1]) << 16) |
                    (parseInt(m[2]) << 8) |
                    parseInt(m[3]);

            return 0x00ff22;
        } catch (err) {
            console.warn('[PixiRenderer] Error parsing color:', css, err);
            return 0x00ff22;
        }
    }
}

function Game_parseName(name) {
    if (!name) return "";

    const match = name.match(/^<[^>]*>(.*)/);

    return match ? match[1] : name;
}