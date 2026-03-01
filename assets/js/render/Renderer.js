import PointQuadTree from '../utils/Quadtree.js';
import { QUADTREE_MAX_POINTS } from '../core/Game.js';

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
        this.gridSize = 0;
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

        ctx.fillStyle = '#111';
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
        ctx.strokeStyle = '#222';
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
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 15;
        ctx.strokeRect(b.l, b.t, b.r - b.l, b.b - b.t);
    }

    drawNodes(ctx) {
        const sortedNodes = Array.from(this.game.nodes.values()).sort((a, b) => a.size - b.size);
        const useJelly = this.game.config.jellyPhysics;

        // 1. Rebuild Quadtree for point-based collisions (Jelly Physics)
        const b = this.game.borders || { l: -10000, t: -10000, r: 10000, b: 10000 };
        const quadtree = new PointQuadTree(b.l, b.t, b.r - b.l, b.b - b.t, QUADTREE_MAX_POINTS);

        // 2. Update jelly points and insert into quadtree
        sortedNodes.forEach(node => {
            if (node.size < 1) return;

            if (useJelly) {
                this.game.updateNumPoints(node);
                for (const point of node.points) {
                    quadtree.insert(point);
                }
            }
        });

        // 3. Update physics and Draw
        const toRemove = [];
        sortedNodes.forEach(node => {
            if (node.size < 1 && !node.destroyed) return;

            // Fade-in / Fade-out alpha (Cigar2 style)
            if (node.destroyed) {
                const alpha = Math.max(120 - (Date.now() - node.dead), 0) / 50;
                if (alpha <= 0) {
                    toRemove.push(node.id);
                    return;
                }
                ctx.globalAlpha = alpha;
            } else {
                ctx.globalAlpha = Math.min(Date.now() - node.born, 120) / 50;
            }

            if (useJelly) {
                this.game.movePoints(node, quadtree, b);
            }

            ctx.fillStyle = node.color || '#00ff22';
            ctx.strokeStyle = node.color || '#00ff22';
            ctx.lineWidth = node.jagged ? 10 : 0;
            if (node.jagged) ctx.lineJoin = "miter";

            ctx.beginPath();

            const numPoints = node.points.length;
            if (useJelly && numPoints > 0) {
                const points = node.points;
                let p0 = points[0];
                if (p0) {
                    ctx.moveTo(p0.x, p0.y);
                    for (let i = 1; i < numPoints; i++) {
                        ctx.lineTo(points[i].x, points[i].y);
                    }
                }
            } else {
                ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2);
            }
            // ===== SKIN LOGIC =====

            const skinImage = this.getSkin(node.skin);

            if (skinImage && skinImage.complete && skinImage.naturalWidth !== 0) {

                ctx.save();
                ctx.clip();

                ctx.drawImage(
                    skinImage,
                    node.x - node.size,
                    node.y - node.size,
                    node.size * 2,
                    node.size * 2
                );

                ctx.restore();

            } else {

                ctx.fillStyle = node.color || '#00ff22';
                ctx.fill();
            }
            ctx.closePath();
            //ctx.fill();
            if (node.jagged) ctx.stroke();

            //this.drawText(ctx, node);
            if (node.size > 20 && !node.jagged && !node.ejected) {

                const showName = this.game.config.showNames && node.name;
                const showMass = this.game.config.showMass;

                // ===== NOMBRE =====
                if (showName) {
                    const fontSize = node.size * 0.35;
                    const texture = this.getTextTexture(node.name, fontSize, false);

                    const yOffset = showMass ? node.size * 0.15 : 0;

                    ctx.drawImage(
                        texture,
                        node.x - texture.width / 2,
                        node.y - yOffset - texture.height / 2
                    );
                }

                // ===== MASA =====
                if (showMass) {
                    const mass = Math.floor((node.size * node.size) / 100);
                    const fontSize = node.size * 0.25;

                    const texture = this.getTextTexture(mass.toString(), fontSize, true);

                    const yOffset = showName ? node.size * 0.25 : 0;

                    ctx.drawImage(
                        texture,
                        node.x - texture.width / 2,
                        node.y + yOffset - texture.height / 2
                    );
                }
            }
            ctx.globalAlpha = 1;
        });

        // Cleanup fully faded-out nodes
        toRemove.forEach(id => this.game.nodes.delete(id));
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
    getTextTexture(text, fontSize, isMass = false) {

        const sizeStep = 8; // evita infinitas variaciones
        fontSize = Math.max(10, Math.floor(fontSize / sizeStep) * sizeStep);

        const key = `${text}_${fontSize}_${isMass}`;

        if (this.textCache.has(key)) {
            return this.textCache.get(key);
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const font = `bold ${fontSize}px Inter`;
        ctx.font = font;

        const metrics = ctx.measureText(text);
        const padding = fontSize * 0.4;

        canvas.width = Math.ceil(metrics.width + padding);
        canvas.height = Math.ceil(fontSize + padding);

        ctx.font = font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(2, fontSize * 0.08);
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
