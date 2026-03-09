
export default class Renderer {
    constructor(game) {
        this.game = game;
        this.canvas = game.canvas;
        this.ctx = this.canvas.getContext('2d');
        this.width = this.canvas.width;
        this.height = this.canvas.height;
        this.textCache = new Map();
        this.skinCache = new Map();
        this.camX = 0;
        this.camY = 0;
        this.target = {
            x: 0,
            y: 0,
            scale: 1
        };
        this.scale = 1;
        this.userZoom = 1;
        this.viewportScale = 1;
        this.serverCamera = true; // true when server sends 0x11
        this.gridSize = 40;
    }

    setSize(w, h) {
        this.width = w;
        this.height = h;
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
        // If the server is NOT sending camera position, calculate from player cells
        if (!this.serverCamera) {
            const playerNodes = Array.from(this.game.nodes.values()).filter(n => {
                return this.game.ownIds.includes(n.id);
            });

            if (playerNodes.length > 0) {
                let avgX = 0, avgY = 0, sumSize = 0;
                playerNodes.forEach(node => {
                    avgX += node.x;
                    avgY += node.y;
                    sumSize += node.size;
                });

                this.target.x = avgX / playerNodes.length;
                this.target.y = avgY / playerNodes.length;

                const sizeScale = Math.pow(Math.min(64 / sumSize, 1), 0.4);
                this.target.scale = sizeScale * this.viewportScale * this.userZoom;
            }
        }

        // Smooth lerp toward target (Cigar2 style)
        const lerpFactor = 0.1;
        this.camX += (this.target.x - this.camX) * lerpFactor;
        this.camY += (this.target.y - this.camY) * lerpFactor;
        this.scale += (this.target.scale - this.scale) * 0.05;
    }

    render() {
        // 1. Interpolate ALL nodes first
        this.interpolateNodes();
        // 2. Update camera using fresh interpolated positions
        this.updateCamera();

        const ctx = this.ctx;
        const isDark = this.game.config.darkTheme;

        ctx.fillStyle = isDark ? '#111' : '#f2fbff';
        ctx.fillRect(0, 0, this.width, this.height);

        ctx.save();
        ctx.translate(this.width / 2, this.height / 2);
        ctx.scale(this.scale, this.scale);
        ctx.translate(-this.camX, -this.camY);

        this.drawGrid(ctx);
        this.drawBorders(ctx);
        this.drawNodes(ctx);

        ctx.restore();
    }

    drawGrid(ctx) {
        ctx.beginPath();
        ctx.lineWidth = 1;
        ctx.strokeStyle = this.game.config.darkTheme ? '#222' : '#d7e8f0';
        const left = this.camX - (this.width / 2) / this.scale;
        const top = this.camY - (this.height / 2) / this.scale;
        const right = this.camX + (this.width / 2) / this.scale;
        const bottom = this.camY + (this.height / 2) / this.scale;

        for (let x = Math.floor(left / this.gridSize) * this.gridSize; x < right; x += this.gridSize) {
            ctx.moveTo(x, top);
            ctx.lineTo(x, bottom);
        }
        for (let y = Math.floor(top / this.gridSize) * this.gridSize; y < bottom; y += this.gridSize) {
            ctx.moveTo(left, y);
            ctx.lineTo(right, y);
        }
        ctx.stroke();
    }

    drawBorders(ctx) {
        const b = this.game.borders;
        if (!b) return;
        ctx.strokeStyle = this.game.config.darkTheme ? '#ffffff' : '#222222';
        ctx.lineWidth = 15;
        ctx.strokeRect(b.l, b.t, b.r - b.l, b.b - b.t);
    }

    drawNodes(ctx) {
        const sortedNodes = Array.from(this.game.nodes.values()).sort((a, b) => a.size - b.size);

        // 1. Calculate Viewport Bounds with Margin (prevents flickering at edges)
        const margin = 100;
        const halfW = (this.width / 2) / this.scale;
        const halfH = (this.height / 2) / this.scale;
        const viewL = this.camX - halfW - margin;
        const viewR = this.camX + halfW + margin;
        const viewT = this.camY - halfH - margin;
        const viewB = this.camY + halfH + margin;

        const toRemove = [];
        const noSkins = this.game.config.noSkins;
        const now = Date.now();

        for (let i = 0; i < sortedNodes.length; i++) {
            const node = sortedNodes[i];

            // Viewport Culling
            if (node.x + node.size < viewL || node.x - node.size > viewR ||
                node.y + node.size < viewT || node.y - node.size > viewB) {
                continue;
            }

            if (node.size < 1 && !node.destroyed) continue;

            // Transparency Logic
            if (node.destroyed) {
                const alpha = Math.max(120 - (now - node.dead), 0) / 100;
                if (alpha <= 0) {
                    toRemove.push(node.id);
                    continue;
                }
                ctx.globalAlpha = Math.min(alpha, 1);
            } else {
                // Quick fade-in to prevent flickering perception
                const bornDiff = now - node.born;
                ctx.globalAlpha = bornDiff < 100 ? bornDiff / 100 : 1;
            }

            ctx.fillStyle = node.color || '#00ff22';
            ctx.strokeStyle = node.color || '#00ff22';

            // Draw Body
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2);

            const skinImage = noSkins ? null : this.getSkin(node.skin);
            if (skinImage && skinImage.complete && skinImage.naturalWidth !== 0) {
                ctx.save();
                ctx.clip();
                ctx.drawImage(skinImage, node.x - node.size, node.y - node.size, node.size * 2, node.size * 2);
                ctx.restore();
            } else {
                ctx.fill();
            }

            // Draw Virus Stroke
            if (node.jagged) {
                ctx.lineWidth = 10;
                ctx.lineJoin = "miter";
                ctx.stroke();
            }

            // Draw Text (Names/Mass)
            if (node.size > 20 && !node.jagged && !node.ejected) {
                const showName = this.game.config.showNames && node.name;
                const showMass = this.game.config.showMass;

                if (showName) {
                    const texture = this.getTextTexture(node.name);
                    const targetW = node.size * 1.5;
                    const targetH = targetW * (texture.height / texture.width);
                    const yOffset = showMass ? node.size * 0.2 : 0;
                    ctx.drawImage(texture, node.x - targetW / 2, node.y - yOffset - targetH / 2, targetW, targetH);
                }

                if (showMass) {
                    const mass = Math.floor((node.size * node.size) / 100);
                    const texture = this.getTextTexture(mass.toString());
                    const targetW = node.size * 0.8;
                    const targetH = targetW * (texture.height / texture.width);
                    const yOffset = showName ? node.size * 0.35 : 0;
                    ctx.drawImage(texture, node.x - targetW / 2, node.y + yOffset - targetH / 2, targetW, targetH);
                }
            }
        }
        ctx.globalAlpha = 1;

        for (let i = 0; i < toRemove.length; i++) this.game.nodes.delete(toRemove[i]);
    }

    /*drawText(ctx, node) {
        if (node.size > 20 && !node.jagged && !node.ejected) {
            const config = this.game.config;
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 5;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const showName = config.showNames && node.name;
            const showMass = config.showMass;

            if (showName) {
                ctx.font = `bold ${Math.max(12, node.size * 0.35)}px Inter`;
                ctx.strokeText(node.name, node.x, node.y - (showMass ? node.size * 0.1 : 0));
                ctx.fillText(node.name, node.x, node.y - (showMass ? node.size * 0.1 : 0));
            }

            if (showMass) {
                ctx.font = `bold ${Math.max(10, node.size * 0.25)}px Inter`;
                const mass = Math.floor((node.size * node.size) / 100);
                const yOffset = showName ? (node.size * 0.25) : 0;
                ctx.strokeText(mass, node.x, node.y + yOffset);
                ctx.fillText(mass, node.x, node.y + yOffset);
            }
        }
    }*/
    getTextTexture(text) {
        const key = `${text}`;
        if (this.textCache.has(key)) return this.textCache.get(key);

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const baseSize = 120; // Fixed high-res size for the texture

        const font = `bold ${baseSize}px Inter`;
        ctx.font = font;

        const metrics = ctx.measureText(text);
        const padding = baseSize * 0.2;

        canvas.width = Math.ceil(metrics.width + padding);
        canvas.height = Math.ceil(baseSize + padding);

        ctx.font = font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = baseSize * 0.2;
        ctx.strokeStyle = '#000';
        ctx.fillStyle = '#fff';

        ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);

        this.textCache.set(key, canvas);
        return canvas;
    }
    getSkin(name) {

        if (!name) return null;
        name = name.toLowerCase().trim();
        if (this.skinCache.has(name)) {
            return this.skinCache.get(name);
        }

        const img = new Image();
        img.onload = () => {
            img.loaded = true;
        };

        img.onerror = () => {
            console.warn("Skin not found:", name);
            img.src = "assets/res/noSkin.png"; // imagen por defecto para skins no encontrados
            img.loaded = false;
        };
        img.src = `./skins/${name}.png`; // carpeta skins

        this.skinCache.set(name, img);

        return img;
    }
}
