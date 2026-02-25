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
        let targetCamX = this.camX;
        let targetCamY = this.camY;
        let maxNodeSize = 0;
        let count = 0;

        const playerNodes = Array.from(this.game.nodes.values()).filter(n => {
            return this.game.ownIds.includes(n.id) || (this.game.nickname && n.name === this.game.nickname && n.size > 15);
        });

        if (playerNodes.length > 0) {
            let avgX = 0, avgY = 0;
            playerNodes.forEach(node => {
                // Use raw target positions for camera base to avoid jitter from double interpolation
                avgX += node.targetX;
                avgY += node.targetY;
                maxNodeSize = Math.max(maxNodeSize, node.targetSize);
                count++;
            });
            targetCamX = avgX / count;
            targetCamY = avgY / count;

            this.targetScale = Math.max(0.02, Math.min(2.0, Math.pow(Math.min(64 / Math.max(maxNodeSize, 10), 1), 0.4)));
            this.targetScale *= this.userZoom;
        }

        // Smoother camera follow
        this.camX += (targetCamX - this.camX) * 0.07;
        this.camY += (targetCamY - this.camY) * 0.07;
        this.scale += (this.targetScale - this.scale) * 0.03;
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
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 15;
        ctx.strokeRect(b.l, b.t, b.r - b.l, b.b - b.t);
    }

    drawNodes(ctx) {
        const sortedNodes = Array.from(this.game.nodes.values()).sort((a, b) => a.size - b.size);
        sortedNodes.forEach(node => {
            // Match movement interpolation to server update frequency
            node.x += (node.targetX - node.x) * 0.12;
            node.y += (node.targetY - node.y) * 0.12;
            node.size += (node.targetSize - node.size) * 0.1;

            if (node.size < 1) return;
            ctx.fillStyle = node.color || '#fff';
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2);
            ctx.fill();

            if (node.name && node.size > 14) {
                ctx.fillStyle = '#fff';
                ctx.font = `bold ${Math.max(12, node.size * 0.35)}px Inter`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(node.name, node.x, node.y);
            }
        });
    }
}
