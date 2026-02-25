import PointQuadTree from '../utils/Quadtree.js';
import { QUADTREE_MAX_POINTS } from '../core/Game.js';

export default class Renderer {
    constructor(game) {
        this.game = game;
        this.canvas = game.canvas;
        this.ctx = this.canvas.getContext('2d');
        this.width = this.canvas.width;
        this.height = this.canvas.height;

        this.camX = 0;
        this.camY = 0;
        this.scale = 1;
        this.targetScale = 1;
        this.userZoom = 1; // Manual zoom level
        this.gridSize = 50;
    }

    setSize(w, h) {
        this.width = w;
        this.height = h;
    }

    updateCamera() {
        const playerNodes = Array.from(this.game.nodes.values()).filter(n => {
            return this.game.ownIds.includes(n.id) || (this.game.nickname && n.name === this.game.nickname && n.size > 15);
        });

        if (playerNodes.length > 0) {
            let avgX = 0, avgY = 0, sumSize = 0;
            playerNodes.forEach(node => {
                avgX += node.targetX;
                avgY += node.targetY;
                sumSize += node.targetSize;
            });

            const targetCamX = avgX / playerNodes.length;
            const targetCamY = avgY / playerNodes.length;

            this.camX += (targetCamX - this.camX) * 0.15;
            this.camY += (targetCamY - this.camY) * 0.15;

            const sizeScale = Math.pow(Math.min(64 / sumSize, 1), 0.4);
            this.targetScale = sizeScale * this.userZoom;
        } else {
            this.camX += (0 - this.camX) * 0.05;
            this.camY += (0 - this.camY) * 0.05;
        }

        this.scale += (this.targetScale - this.scale) * 0.05;
    }

    render() {
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
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 15;
        ctx.strokeRect(b.l, b.t, b.r - b.l, b.b - b.t);
    }

    drawNodes(ctx) {
        const sortedNodes = Array.from(this.game.nodes.values()).sort((a, b) => a.size - b.size);
        const now = this.game.getSyncedTime();

        // 1. Rebuild Quadtree for point-based collisions (Jelly Physics)
        const b = this.game.borders || { l: -10000, t: -10000, r: 10000, b: 10000 };
        const quadtree = new PointQuadTree(b.l, b.t, b.r - b.l, b.b - b.t, QUADTREE_MAX_POINTS);

        // 2. Interpolate node positions and insert points into quadtree
        sortedNodes.forEach(node => {
            const dt = Math.min((now - node.lastUpdate) / 100, 1);
            node.x = node.startX + (node.targetX - node.startX) * dt;
            node.y = node.startY + (node.targetY - node.startY) * dt;
            node.size = node.startSize + (node.targetSize - node.startSize) * dt;

            if (node.size < 1) return;

            // Initialize/Update point count
            this.game.updateNumPoints(node);

            // Insert each point into the quadtree for collision checks
            for (const point of node.points) {
                quadtree.insert(point);
            }
        });

        // 3. Update physics and Draw
        sortedNodes.forEach(node => {
            if (node.size < 1) return;

            // Apply Doblesplit movePoints logic
            this.game.movePoints(node, quadtree, b);

            ctx.fillStyle = node.color || '#fff';
            ctx.strokeStyle = node.color || '#fff';
            ctx.lineWidth = node.jagged ? 10 : 0;
            if (node.jagged) ctx.lineJoin = "miter";

            ctx.beginPath();

            const numPoints = node.points.length;
            if (numPoints > 0) {
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

            ctx.closePath();
            ctx.fill();
            if (node.jagged) ctx.stroke();

            // Nickname and Mass
            if (node.size > 14) {
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                if (node.name) {
                    ctx.font = `bold ${Math.max(12, node.size * 0.35)}px Inter`;
                    ctx.fillText(node.name, node.x, node.y - (node.size * 0.1));

                    ctx.font = `bold ${Math.max(10, node.size * 0.25)}px Inter`;
                    const mass = Math.floor((node.size * node.size) / 100);
                    ctx.fillText(mass, node.x, node.y + (node.size * 0.25));
                } else {
                    ctx.font = `bold ${Math.max(12, node.size * 0.35)}px Inter`;
                    const mass = Math.floor((node.size * node.size) / 100);
                    ctx.fillText(mass, node.x, node.y);
                }
            }
        });
    }
}
