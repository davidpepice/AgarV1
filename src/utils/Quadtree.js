export default class PointQuadTree {
    constructor(x, y, w, h, maxPoints) {
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
        this.maxPoints = maxPoints;
        this.points = [];
        this.children = null;
    }

    insert(point) {
        if (!this.containsPoint(point)) return;

        if (this.children !== null) {
            const col = point.x > this.x + this.w / 2;
            const row = point.y > this.y + this.h / 2;
            this.children[col + (row ? 2 : 0)].insert(point);
        } else {
            this.points.push(point);
            if (this.points.length > this.maxPoints && this.w > 1) {
                this.split();
            }
        }
    }

    split() {
        this.children = [];
        const halfW = this.w / 2;
        const halfH = this.h / 2;
        for (let y = 0; y < 2; ++y) {
            for (let x = 0; x < 2; ++x) {
                const px = this.x + x * halfW;
                const py = this.y + y * halfH;
                this.children.push(new PointQuadTree(px, py, halfW, halfH, this.maxPoints));
            }
        }
        const oldPoints = this.points;
        this.points = [];
        for (let i = 0; i < oldPoints.length; ++i) {
            this.insert(oldPoints[i]);
        }
    }

    containsPoint(point) {
        return point.x >= this.x && point.x <= this.x + this.w &&
            point.y >= this.y && point.y <= this.y + this.h;
    }

    overlaps(aabb) {
        return aabb.x < this.x + this.w && aabb.x + aabb.w > this.x &&
            aabb.y < this.y + this.h && aabb.y + aabb.h > this.y;
    }

    some(aabb, test) {
        if (this.children !== null) {
            for (let i = 0; i < this.children.length; ++i) {
                const child = this.children[i];
                if (child.overlaps(aabb) && child.some(aabb, test)) {
                    return true;
                }
            }
        } else {
            for (let i = 0; i < this.points.length; ++i) {
                const point = this.points[i];
                if (point.x >= aabb.x && point.x <= aabb.x + aabb.w &&
                    point.y >= aabb.y && point.y <= aabb.y + aabb.h &&
                    test(point)) {
                    return true;
                }
            }
        }
        return false;
    }
}
