import {
    Application,
    Container,
    Graphics,
    Sprite,
    Texture,
    Assets,
    Text,
    TextStyle,
    Color
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
        this.userZoom = 2.5; // Sync with Renderer.js
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
        this.initError = null;

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

            await this.app.init({
                canvas: this.canvas,
                width: this.width,
                height: this.height,
                background: this.game.config.darkTheme ? "#111111" : "#f2fbff",
                antialias: true,
                resolution: dpr,
                autoDensity: true,
                autoStart: false, // We control rendering in Game.loop
                preference: "webgpu"  // Try WebGPU first, fall back to WebGL
            });

            console.log(`[PixiRenderer] PixiJS initialized (${this.app.renderer.constructor.name})`);

            // Layers
            this.world = new Container();
            this.app.stage.addChild(this.world);

            this.gridGfx = new Graphics();
            this.borderGfx = new Graphics();
            this.nodeLayer = new Container();
            this.uiLayer = new Container(); // For arrow, etc.

            this.world.addChild(this.gridGfx);
            this.world.addChild(this.borderGfx);
            this.world.addChild(this.nodeLayer);
            this.world.addChild(this.uiLayer);

            // Pre-load virus texture
            try {
                this.virusTexture = await Assets.load("./assets/res/virus.png");
            } catch (err) {
                console.warn('[PixiRenderer] Virus texture load failed:', err);
            }

            this.ready = true;
            this.initializing = false;
        } catch (err) {
            this.initError = err.message || String(err);
            console.error('[PixiRenderer] Init error:', err);
            this.ready = false;
            this.initializing = false;
        }
    }

    setSize(w, h) {
        this.width = w;
        this.height = h;

        if (this.app && this.app.renderer) {
            this.app.renderer.resize(w, h);
        }
    }

    destroy() {
        this.ready = false;
        if (this.app) {
            this.app.destroy(true, { children: true, texture: false, baseTexture: false });
            this.app = null;
        }
        this.nodeGfxMap.clear();
        this.skinCache.clear();
        if (this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
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
        const playerNodes = Array.from(this.game.nodes.values()).filter(n =>
            this.game.ownIds.includes(n.id) && !n.destroyed
        );

        if (playerNodes.length > 0) {
            let avgX = 0, avgY = 0, sumSize = 0;
            playerNodes.forEach(n => {
                avgX += n.x; avgY += n.y; sumSize += n.size;
            });
            this.target.x = avgX / playerNodes.length;
            this.target.y = avgY / playerNodes.length;
            const sizeScale = Math.pow(Math.min(64 / sumSize, 1), 0.4);
            this.target.scale = sizeScale * this.viewportScale * this.userZoom;
        } else if (this.spectateTargetName) {
            const targets = Array.from(this.game.nodes.values()).filter(n => n.name === this.spectateTargetName && !n.destroyed);
            if (targets.length > 0) {
                let avgX = 0, avgY = 0, sumSize = 0;
                targets.forEach(n => { avgX += n.x; avgY += n.y; sumSize += n.size; });
                this.target.x = avgX / targets.length;
                this.target.y = avgY / targets.length;
                const sizeScale = Math.pow(Math.min(64 / sumSize, 1), 0.4);
                this.target.scale = sizeScale * this.viewportScale * this.userZoom;
            }
        }

        const lerpFactor = 0.05;
        this.camX += (this.target.x - this.camX) * lerpFactor;
        this.camY += (this.target.y - this.camY) * lerpFactor;
        this.scale += (this.target.scale - this.scale) * 0.05;

        if (this.world) {
            this.world.x = this.width / 2;
            this.world.y = this.height / 2;
            this.world.scale.set(this.scale);
            this.world.pivot.set(this.camX, this.camY);
        }
    }

    render() {
        if (!this.ready || !this.app) return;

        this.interpolateNodes();
        this.updateCamera();

        const isDark = this.game.config.darkTheme;
        this.app.renderer.background.color = isDark ? 0x111111 : 0xf2fbff;

        this._drawGrid(isDark);
        this._drawBorders(isDark);
        this._drawNodes();
        
        if (this.game.isMobile || this.game.joystick.active) {
            this._drawDirectionArrow();
        } else if (this.uiLayer) {
            this.uiLayer.removeChildren();
        }

        this.app.render();
    }

    _drawGrid(isDark) {
        const g = this.gridGfx;
        g.clear();
        g.setStrokeStyle({
            width: 1,
            color: isDark ? 0x222222 : 0xd7e8f0
        });

        const margin = 100 / this.scale;
        const halfW = (this.width / 2) / this.scale;
        const halfH = (this.height / 2) / this.scale;
        const left = this.camX - halfW - margin;
        const right = this.camX + halfW + margin;
        const top = this.camY - halfH - margin;
        const bot = this.camY + halfH + margin;

        const gs = this.gridSize;
        for (let x = Math.floor(left / gs) * gs; x < right; x += gs) {
            g.moveTo(x, top).lineTo(x, bot);
        }
        for (let y = Math.floor(top / gs) * gs; y < bot; y += gs) {
            g.moveTo(left, y).lineTo(right, y);
        }
        g.stroke();
    }

    _drawBorders(isDark) {
        const b = this.game.borders;
        if (!b) return;
        const g = this.borderGfx;
        g.clear();
        g.setStrokeStyle({
            width: 15,
            color: isDark ? 0xffffff : 0x222222
        });
        g.rect(b.l, b.t, b.r - b.l, b.b - b.t);
        g.stroke();
    }

    _drawNodes() {
        const nodes = Array.from(this.game.nodes.values()).sort((a, b) => a.size - b.size);
        const margin = 100 / this.scale;
        const halfW = (this.width / 2) / this.scale;
        const halfH = (this.height / 2) / this.scale;
        const viewL = this.camX - halfW - margin;
        const viewR = this.camX + halfW + margin;
        const viewT = this.camY - halfH - margin;
        const viewB = this.camY + halfH + margin;

        const noSkins = this.game.config.noSkins;
        const now = Date.now();
        const liveIds = new Set();

        for (const node of nodes) {
            // Viewport Culling
            if (node.x + node.size < viewL || node.x - node.size > viewR ||
                node.y + node.size < viewT || node.y - node.size > viewB) {
                // If offscreen, we might want to hide existing gfx
                const existing = this.nodeGfxMap.get(node.id);
                if (existing) existing.visible = false;
                continue;
            }

            if (node.size < 1 && !node.destroyed) continue;

            liveIds.add(node.id);
            this._drawNode(node, now, noSkins);
        }

        // Cleanup
        for (const [id, container] of this.nodeGfxMap) {
            if (!liveIds.has(id)) {
                const node = this.game.nodes.get(id);
                if (!node || (now - node.dead > 120)) {
                    this._removeNodeGfx(id);
                } else {
                    // Fade out destroyed node
                    const alpha = Math.max(120 - (now - node.dead), 0) / 100;
                    container.alpha = alpha;
                }
            }
        }
    }

    _drawNode(node, now, noSkins) {
        let container = this.nodeGfxMap.get(node.id);
        if (!container) {
            container = new Container();
            this.nodeLayer.addChild(container);
            this.nodeGfxMap.set(node.id, container);
        }

        container.visible = true;
        container.x = node.x;
        container.y = node.y;

        // Alpha logic
        if (node.destroyed) {
            const alpha = Math.max(120 - (now - node.dead), 0) / 100;
            container.alpha = alpha;
        } else {
            const bornDiff = now - node.born;
            container.alpha = bornDiff < 100 ? bornDiff / 100 : 1;
        }

        // 1. Body Graphics (Solid Color)
        let body = container.getChildByName("body");
        if (!body) {
            body = new Graphics();
            body.name = "body";
            container.addChildAt(body, 0);
        }
        
        // 2. Skin Sprite
        let skin = container.getChildByName("skin");
        const skinName = noSkins ? null : node.skin;

        if (node.jagged) {
            // Virus logic
            if (skin) skin.visible = false;
            body.clear();
            if (this.virusTexture) {
                if (!skin || skin.name !== "virus") {
                    if (skin) container.removeChild(skin);
                    skin = new Sprite(this.virusTexture);
                    skin.name = "virus";
                    skin.anchor.set(0.5);
                    container.addChildAt(skin, 1);
                }
                skin.visible = true;
                skin.width = skin.height = node.size * 2.1;
            } else {
                body.circle(0, 0, node.size).fill(0x33ff33);
                body.setStrokeStyle({ width: node.size * 0.1, color: 0x33ff33 }).stroke();
            }
        } else {
            // Normal Cell logic
            if (skin && skin.name === "virus") {
                container.removeChild(skin);
                skin = null;
            }

            body.clear();
            const color = new Color(node.color || "#00ff22").toNumber();
            body.circle(0, 0, node.size).fill(color);

            if (skinName) {
                this._applySkin(container, skinName, node.size);
            } else if (skin) {
                skin.visible = false;
            }
        }

        // 3. Text
        if (node.size > 20 && !node.jagged && !node.ejected) {
            this._drawNodeText(container, node);
        } else {
            const label = container.getChildByName("label");
            if (label) label.visible = false;
        }
    }

    async _applySkin(container, name, size) {
        let skin = container.getChildByName("skin");
        const texture = await this._getSkinTexture(name);
        
        if (texture) {
            if (!skin) {
                skin = new Sprite(texture);
                skin.name = "skin";
                skin.anchor.set(0.5);
                container.addChildAt(skin, 1);
            } else {
                skin.texture = texture;
            }
            skin.visible = true;
            skin.width = skin.height = size * 2;
            
            // Mask skin to circle
            let mask = container.getChildByName("skinMask");
            if (!mask) {
                mask = new Graphics();
                mask.name = "skinMask";
                container.addChild(mask);
                skin.mask = mask;
            }
            mask.clear().circle(0, 0, size).fill(0xffffff);
        } else if (skin) {
            skin.visible = false;
        }
    }

    async _getSkinTexture(name) {
        if (!name) return null;
        name = name.toLowerCase().trim();
        if (this.skinCache.has(name)) return this.skinCache.get(name);

        try {
            const tex = await Assets.load(`./skins/${name}.png`);
            this.skinCache.set(name, tex);
            return tex;
        } catch (e) {
            // Fallback to error skin if needed, or just return null
            return null;
        }
    }

    _drawNodeText(container, node) {
        const showName = this.game.config.showNames && node.name;
        const showMass = this.game.config.showMass;
        if (!showName && !showMass) {
            const label = container.getChildByName("label");
            if (label) label.visible = false;
            return;
        }

        let label = container.getChildByName("label");
        let textContent = "";
        if (showName) textContent += Game_parseName(node.name);
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
                    stroke: { color: "#000000", width: 4 },
                    align: "center",
                    fontSize: 40
                }
            });
            label.name = "label";
            label.anchor.set(0.5);
            container.addChild(label);
        } else {
            label.text = textContent;
            label.visible = true;
        }

        const targetW = node.size * 1.2;
        const scale = targetW / label.width;
        label.scale.set(Math.min(scale, 1));
    }

    _removeNodeGfx(id) {
        const container = this.nodeGfxMap.get(id);
        if (container) {
            container.destroy({ children: true });
            this.nodeGfxMap.delete(id);
        }
    }

    _drawDirectionArrow() {
        if (!this.uiLayer) return;

        const playerNodes = Array.from(this.game.nodes.values()).filter(n =>
            this.game.ownIds.includes(n.id) && !n.destroyed
        );

        if (playerNodes.length === 0) {
            this.uiLayer.removeChildren();
            return;
        }

        let avgX = 0, avgY = 0, maxDist = 0;
        playerNodes.forEach(n => {
            avgX += n.x; avgY += n.y;
        });
        avgX /= playerNodes.length;
        avgY /= playerNodes.length;

        playerNodes.forEach(n => {
            const d = Math.sqrt((n.x - avgX) ** 2 + (n.y - avgY) ** 2) + n.size;
            if (d > maxDist) maxDist = d;
        });

        let arrow = this.uiLayer.getChildByName("arrow");
        if (!arrow) {
            arrow = new Graphics();
            arrow.name = "arrow";
            this.uiLayer.addChild(arrow);
        }

        arrow.clear();
        const baseArrowSize = 18;
        const arrowSize = baseArrowSize / this.scale;
        const dist = maxDist + (15 / this.scale);

        arrow.setStrokeStyle({ width: 0, color: 0xffffff });
        arrow.moveTo(dist + arrowSize, 0)
             .lineTo(dist, arrowSize / 1.5)
             .lineTo(dist, -arrowSize / 1.5)
             .closePath()
             .fill({ color: 0xffffff, alpha: 0.45 });

        arrow.x = avgX;
        arrow.y = avgY;
        arrow.rotation = this.game.joystick.angle;
    }
}

function Game_parseName(name) {
    if (!name) return "";
    return name.replace(/^(\{[^}]*\}|<[^>]*>)+/, '').trim();
}