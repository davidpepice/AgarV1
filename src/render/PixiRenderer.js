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
        this.jellyData = new Map();

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
        this.jellyData.clear();
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
            container.label = "node_" + node.id;
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

        const jelly = this._updateJelly(node);

        // 1. Body Graphics (Solid Color)
        let body = container.getChildByLabel("body");
        if (!body) {
            body = new Graphics();
            body.label = "body";
            container.addChildAt(body, 0);
        }
        
        // 2. Skin Sprite
        let skin = container.getChildByLabel("skin");
        const skinName = noSkins ? null : node.skin;

        if (node.jagged) {
            // Virus logic
            if (skin) skin.visible = false;
            body.clear();
            if (this.virusTexture) {
                if (!skin || skin.label !== "virus") {
                    if (skin) container.removeChild(skin);
                    skin = new Sprite(this.virusTexture);
                    skin.label = "virus";
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
            if (skin && skin.label === "virus") {
                container.removeChild(skin);
                skin = null;
            }

            if (skinName) {
                this._applySkin(container, skinName, node.size, jelly);
            } else {
                if (skin) skin.visible = false;
                
                // Only show solid color if no skin is intended
                this._drawBody(container, body, node.size, jelly);
            }
        }

        // 3. Text
        if (node.size > 20 && !node.jagged && !node.ejected) {
            this._drawNodeText(container, node);
        } else {
            const label = container.getChildByLabel("label");
            if (label) label.visible = false;
        }
    }

    _applySkin(container, name, size, jelly) {
        let skin = container.getChildByLabel("skin");
        let body = container.getChildByLabel("body");
        
        // 1. Get Texture (Sync or Async)
        const texture = this._getSkinTexture(name);
        
        if (texture instanceof Texture) {
            // Texture is already in cache
            this._setupSkinSprite(container, skin, texture, size, jelly);
            if (body) body.visible = false; // Hide body if skin is ready
        } else if (texture instanceof Promise) {
            // Texture is loading
            this._drawBody(container, body, size, jelly);
            
            texture.then(tex => {
                if (tex && container.visible) {
                    this._setupSkinSprite(container, skin, tex, size, jelly);
                    if (body) body.visible = false;
                } else if (!tex) {
                    this._drawBody(container, body, size, jelly);
                }
            });
        } else {
            // Texture is null or failed
            this._drawBody(container, body, size, jelly);
            if (skin) skin.visible = false;
        }
    }

    _drawBody(container, body, size, jelly) {
        if (!body) return;
        const id = parseInt(container.label.replace('node_', ''));
        const node = this.game.nodes.get(id) || {};
        const color = new Color(node.color || "#00ff22").toNumber();
        
        if (jelly && jelly.points && !node.jagged) {
            body.clear();
            const pts = jelly.points;
            if (pts.length > 0) {
                body.moveTo(
                    (pts[0].x + pts[pts.length - 1].x) / 2,
                    (pts[0].y + pts[pts.length - 1].y) / 2
                );
                for (let i = 0; i < pts.length; i++) {
                    const p1 = pts[i];
                    const p2 = pts[(i + 1) % pts.length];
                    const midX = (p1.x + p2.x) / 2;
                    const midY = (p1.y + p2.y) / 2;
                    body.quadraticCurveTo(p1.x, p1.y, midX, midY);
                }
                body.fill(color);
            }
            body.scale.set(1);
            body._wasJelly = true;
        } else {
            // Optimization: If it's just a circle, draw it once and scale it
            if (body._lastColor !== color || body._wasJelly || !body._hasCircle) {
                body.clear();
                body.circle(0, 0, 100).fill(color);
                body._lastColor = color;
                body._wasJelly = false;
                body._hasCircle = true;
            }
            body.scale.set(size / 100);
        }
        body.visible = true;
    }

    _setupSkinSprite(container, skin, texture, size, jelly) {
        if (!skin) {
            skin = new Sprite(texture);
            skin.label = "skin";
            skin.anchor.set(0.5);
            container.addChildAt(skin, 1);
        } else {
            skin.texture = texture;
        }

        skin.visible = true;
        skin.width = skin.height = size * 2;

        let mask = container.getChildByLabel("skinMask");
        if (!mask) {
            mask = new Graphics();
            mask.label = "skinMask";
            container.addChild(mask);
            skin.mask = mask;
        }
        
        if (jelly && jelly.points) {
            mask.clear();
            const pts = jelly.points;
            if (pts.length > 0) {
                mask.moveTo(
                    (pts[0].x + pts[pts.length - 1].x) / 2,
                    (pts[0].y + pts[pts.length - 1].y) / 2
                );
                for (let i = 0; i < pts.length; i++) {
                    const p1 = pts[i];
                    const p2 = pts[(i + 1) % pts.length];
                    const midX = (p1.x + p2.x) / 2;
                    const midY = (p1.y + p2.y) / 2;
                    mask.quadraticCurveTo(p1.x, p1.y, midX, midY);
                }
                mask.fill(0xffffff);
            }
            mask.scale.set(1);
            mask._wasJelly = true;
        } else {
            // Optimization: If it's a circle, draw it once and scale it
            if (mask._wasJelly || !mask._hasCircle) {
                mask.clear();
                mask.circle(0, 0, 100).fill(0xffffff);
                mask._wasJelly = false;
                mask._hasCircle = true;
            }
            mask.scale.set(size / 100);
        }
    }

    _getSkinTexture(name) {
        if (!name) return null;
        name = name.toLowerCase().trim();
        if (this.skinCache.has(name)) return this.skinCache.get(name);

        // Not in cache, start loading and return the promise
        const promise = Assets.load(`./skins/${name}.png`)
            .then(tex => {
                this.skinCache.set(name, tex);
                return tex;
            })
            .catch(() => {
                this.skinCache.set(name, null); // Don't try again for this item
                return null;
            });
            
        this.skinCache.set(name, promise);
        return promise;
    }

    _drawNodeText(container, node) {
        const showName = this.game.config.showNames && node.name;
        const showMass = this.game.config.showMass;

        let nameLabel = container.getChildByLabel("nameLabel");
        let massLabel = container.getChildByLabel("massLabel");

        if (!showName && !showMass) {
            if (nameLabel) nameLabel.visible = false;
            if (massLabel) massLabel.visible = false;
            return;
        }

        const nameText = showName ? Game_parseName(node.name) : "";
        const massText = showMass ? Math.floor((node.size * node.size) / 100).toString() : "";

        // Render Name Layer
        if (showName) {
            if (!nameLabel) {
                nameLabel = new Text({
                    text: nameText,
                    style: {
                        fontFamily: "Inter, sans-serif",
                        fontWeight: "bold",
                        fill: "#ffffff",
                        stroke: { color: "#000000", width: 5 },
                        align: "center",
                        fontSize: 48
                    }
                });
                nameLabel.label = "nameLabel";
                nameLabel.anchor.set(0.5);
                container.addChild(nameLabel);
            } else {
                // VERY IMPORTANT FOR FPS: Only update text if it actually changed!
                if (nameLabel.text !== nameText) nameLabel.text = nameText;
                nameLabel.visible = true;
            }
        } else if (nameLabel) {
            nameLabel.visible = false;
        }

        // Render Mass Layer
        if (showMass) {
            if (!massLabel) {
                massLabel = new Text({
                    text: massText,
                    style: {
                        fontFamily: "Inter, sans-serif",
                        fontWeight: "bold",
                        fill: "#ffffff",
                        stroke: { color: "#000000", width: 4 },
                        align: "center",
                        fontSize: 32
                    }
                });
                massLabel.label = "massLabel";
                massLabel.anchor.set(0.5);
                container.addChild(massLabel);
            } else {
                if (massLabel.text !== massText) massLabel.text = massText;
                massLabel.visible = true;
            }
        } else if (massLabel) {
            massLabel.visible = false;
        }

        // Positioning and Scaling
        const targetW = node.size * 1.5;

        // Clean up legacy label from previous version if it exists
        const oldLabel = container.getChildByLabel("label");
        if (oldLabel) container.removeChild(oldLabel);

        if (showName && showMass) {
            const nScale = Math.min(targetW / (nameLabel.width || 1), 1);
            const mScale = Math.min((targetW * 0.7) / (massLabel.width || 1), 1);
            nameLabel.scale.set(nScale);
            massLabel.scale.set(mScale);
            
            const totalH = nameLabel.height + massLabel.height;
            nameLabel.y = -(totalH * 0.15);
            massLabel.y = (totalH * 0.35);
        } else if (showName) {
            const nScale = Math.min(targetW / Math.max(nameLabel.width, 1), 1);
            nameLabel.scale.set(nScale);
            nameLabel.y = 0;
        } else if (showMass) {
            const mScale = Math.min(targetW / Math.max(massLabel.width, 1), 1);
            massLabel.scale.set(mScale);
            massLabel.y = 0;
        }
    }

    _removeNodeGfx(id) {
        const container = this.nodeGfxMap.get(id);
        if (container) {
            container.destroy({ children: true });
            this.nodeGfxMap.delete(id);
            this.jellyData.delete(id);
        }
    }

    _updateJelly(node) {
        if (node.jagged || node.size < 15) return null;

        let jelly = this.jellyData.get(node.id);
        const count = 40; // Reduced from 60 to 40 for optimal CPU performance

        if (!jelly) {
            jelly = {
                points: [],
                lastX: node.x,
                lastY: node.y,
                lastSize: node.size
            };
            for(let i = 0; i < count; i++) {
                const angle = (i / count) * Math.PI * 2;
                jelly.points.push({
                    x: Math.cos(angle) * node.size,
                    y: Math.sin(angle) * node.size,
                    vx: 0,
                    vy: 0,
                    angle: angle
                });
            }
            this.jellyData.set(node.id, jelly);
        }

        let diffX = node.x - jelly.lastX;
        let diffY = node.y - jelly.lastY;
        const maxDelta = node.size * 1.5; 
        if (diffX > maxDelta) diffX = maxDelta;
        if (diffX < -maxDelta) diffX = -maxDelta;
        if (diffY > maxDelta) diffY = maxDelta;
        if (diffY < -maxDelta) diffY = -maxDelta;

        const dSize = node.size - jelly.lastSize;

        jelly.lastX = node.x;
        jelly.lastY = node.y;
        jelly.lastSize = node.size;

        const inertia = 0.45;  
        const stiffness = 0.35; 
        const damping = 0.65; 

        const borders = this.game.borders;

        for (let i = 0; i < jelly.points.length; i++) {
            const p = jelly.points[i];
            
            const targetX = Math.cos(p.angle) * node.size;
            const targetY = Math.sin(p.angle) * node.size;
            
            p.vx -= diffX * inertia;
            p.vy -= diffY * inertia;
            
            if (dSize !== 0) {
                p.vx += Math.cos(p.angle) * dSize;
                p.vy += Math.sin(p.angle) * dSize;
            }

            p.vx += (targetX - p.x) * stiffness;
            p.vy += (targetY - p.y) * stiffness;
            
            // Limit max velocity to prevent polygon inversion (the "square" bug)
            const maxV = node.size * 0.8;
            if (p.vx > maxV) p.vx = maxV;
            if (p.vx < -maxV) p.vx = -maxV;
            if (p.vy > maxV) p.vy = maxV;
            if (p.vy < -maxV) p.vy = -maxV;

            p.vx *= damping;
            p.vy *= damping;
            
            p.x += p.vx;
            p.y += p.vy;

            const worldX = node.x + p.x;
            const worldY = node.y + p.y;

            // Border Collision (Squish against map bounds)
            if (borders) {
                if (worldX < borders.l) { p.x = borders.l - node.x; p.vx *= -0.8; }
                else if (worldX > borders.r) { p.x = borders.r - node.x; p.vx *= -0.8; }
                
                if (worldY < borders.t) { p.y = borders.t - node.y; p.vy *= -0.8; }
                else if (worldY > borders.b) { p.y = borders.b - node.y; p.vy *= -0.8; }
            }
        }

        return jelly;
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

        let arrow = this.uiLayer.getChildByLabel("arrow");
        if (!arrow) {
            arrow = new Graphics();
            arrow.label = "arrow";
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