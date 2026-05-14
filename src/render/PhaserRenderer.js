import Phaser from 'phaser';

class AgarScene extends Phaser.Scene {
    constructor() {
        super('AgarScene');
        this.graphicsMap = new Map();
        this.textMap = new Map();
        this.spriteMap = new Map();
        this.maskMap = new Map();
    }

    preload() {
        // Carga de assets estáticos y base
        this.load.image('virus', './assets/res/virus.png');
        // No es necesario precargar todas las skins, las cargaremos bajo demanda dinámica
    }

    create() {
        // Camera setup
        this.cameras.main.setBackgroundColor('#0c0d10');
        
        // Generate high-quality circular textures ONCE into WebGL memory
        let shape = this.make.graphics();
        shape.fillStyle(0xffffff, 1);
        shape.fillCircle(128, 128, 120);
        shape.generateTexture('base_circle', 256, 256);
        shape.clear();
        
        shape.lineStyle(16, 0xffffff, 1);
        shape.strokeCircle(128, 128, 120);
        shape.generateTexture('outline_circle', 256, 256);
        shape.destroy();

        // Grid background
        this.grid = this.add.grid(
            0, 0,
            32000, 32000,
            150, 150,
            0x000000, 1,
            0xffffff, 0.05
        ).setOrigin(0.5);
        this.grid.setDepth(-10);
    }
}

export default class PhaserRenderer {
    constructor(game) {
        this.game = game;
        this.canvas = null;
        this.ready = false;

        this.camX = 0;
        this.camY = 0;
        this.scale = 1;
        this.target = { x: 0, y: 0, scale: 1 };

        const config = {
            type: Phaser.WEBGL,
            width: window.innerWidth,
            height: window.innerHeight,
            parent: document.body,
            scene: AgarScene,
            transparent: false,
            powerPreference: 'high-performance',
            callbacks: {
                postBoot: (phaserGame) => {
                    this.phaserGame = phaserGame;
                    this.canvas = phaserGame.canvas;
                    this.canvas.id = 'phaserCanvas';

                    // Style canvas similar to other renderers
                    this.canvas.style.position = 'absolute';
                    this.canvas.style.top = '0';
                    this.canvas.style.left = '0';
                    this.canvas.style.zIndex = '0';

                    this.scene = phaserGame.scene.keys['AgarScene'];
                    this.ready = true;
                    console.log('[PhaserRenderer] Ready!');
                }
            }
        };

        new Phaser.Game(config);
    }

    resize() {
        if (this.phaserGame && this.ready) {
            this.phaserGame.scale.resize(window.innerWidth, window.innerHeight);
        }
    }

    render() {
        if (!this.ready || !this.scene) return;

        const now = this.game.getSyncedTime();
        let myId = null;

        // Determine camera target (my cell, or spectate target)
        if (this.game.playing && this.game.ownIds.length > 0) {
            // Find largest owned cell to focus on
            let maxMass = 0;
            this.game.ownIds.forEach(id => {
                const node = this.game.nodes.get(id);
                if (node && node.size > maxMass) {
                    maxMass = node.size;
                    myId = id;
                }
            });
        }

        // Camera Update
        if (myId) {
            const me = this.game.nodes.get(myId);
            if (me) {
                this.target.x = me.x;
                this.target.y = me.y;

                // Scale factor based on total mass
                const totalMass = this.game.ownIds.reduce((sum, id) => {
                    const n = this.game.nodes.get(id);
                    return sum + (n ? (n.size * n.size) / 100 : 0);
                }, 0);
                let newScale = Math.pow(Math.min(64 / Math.max(totalMass, 100), 1), 0.4);
                this.target.scale = newScale;
            }
        }

        this.camX += (this.target.x - this.camX) * 0.1;
        this.camY += (this.target.y - this.camY) * 0.1;
        this.scale += (this.target.scale - this.scale) * 0.01;

        const cam = this.scene.cameras.main;
        cam.centerOn(this.camX, this.camY);
        cam.setZoom(this.scale);

        // 2. Node Drawing
        this.game.nodes.forEach(node => {
            if (node.destroyed) return;

            // Interpolation
            const dt = Math.max(0, Math.min(1, (now - node.lastUpdate) / this.game.config.animationDelay));
            node.x = node.startX + (node.targetX - node.startX) * dt;
            node.y = node.startY + (node.targetY - node.startY) * dt;
            node.size = node.startSize + (node.targetSize - node.startSize) * dt;

            this._drawNode(node);
        });

        // Cleanup old sprites/texts/outlines
        this.scene.spriteMap.forEach((sprite, id) => {
            if (!this.game.nodes.has(id) || this.game.nodes.get(id).destroyed) {
                sprite.destroy();
                this.scene.spriteMap.delete(id);
                
                const outline = this.scene.graphicsMap.get(id); // Using graphicsMap as outline map
                if (outline) { outline.destroy(); this.scene.graphicsMap.delete(id); }
                
                const text = this.scene.textMap.get(id);
                if (text) { text.destroy(); this.scene.textMap.delete(id); }
                
                const mask = this.scene.maskMap.get(id);
                if (mask) { mask.destroy(); this.scene.maskMap.delete(id); }
            }
        });
    }

    _getSkin(skinName) {
        if (!skinName || !this.scene) return null;
        const key = 'skin_' + skinName;

        // Return if it's completely loaded and ready to use
        if (this.scene.textures.exists(key)) return key;

        // Track our own loading state to prevent spamming Phaser loader
        if (!this.scene._loadingSkins) this.scene._loadingSkins = new Set();
        if (this.scene._loadingSkins.has(key)) return null;

        // Start downloading dynamically!
        this.scene._loadingSkins.add(key);
        this.scene.load.image(key, `./skins/${skinName}.png`);

        // If it fails, mark it so we stop trying
        this.scene.load.once(`fileerror-image-${key}`, () => {
            if (!this.scene._missingSkins) this.scene._missingSkins = new Set();
            this.scene._missingSkins.add(key);
        });

        const wasLoading = this.scene.load.isLoading();
        if (!wasLoading) {
            this.scene.load.start();
        }
        return null;
    }

    _drawNode(node) {
        // Parse Color
        let colorHex = 0x00ff00;
        if (node.color) {
            if (node.color.startsWith('rgb')) {
                const rgb = node.color.match(/\d+/g);
                if (rgb && rgb.length >= 3) {
                    colorHex = (parseInt(rgb[0]) << 16) + (parseInt(rgb[1]) << 8) + parseInt(rgb[2]);
                }
            } else if (node.color.startsWith('#')) {
                colorHex = parseInt(node.color.replace('#', '0x'));
            }
        }        let sprite = this.scene.spriteMap.get(node.id);
        let outline = this.scene.graphicsMap.get(node.id);
        let dynamicSkin = null;
        
        // Pick texture
        if (node.jagged) {
            dynamicSkin = 'virus';
        } else if (!this.game.config.noSkins && node.skin) {
            dynamicSkin = this._getSkin(node.skin);
        }
        
        const textureToUse = dynamicSkin || 'base_circle';
        
        // Instantiate or update main sprite
        if (!sprite || sprite.texture.key !== textureToUse) {
            if (sprite) sprite.destroy();
            sprite = this.scene.add.image(node.x, node.y, textureToUse);
            this.scene.spriteMap.set(node.id, sprite);
            
            // Setup masks for skins
            if (dynamicSkin && dynamicSkin !== 'virus') {
                let maskShape = this.scene.make.graphics();
                this.scene.maskMap.set(node.id, maskShape);
                sprite.setMask(maskShape.createGeometryMask());
            }
        }
        
        // Core WebGL Transform - insanely fast!
        sprite.setPosition(node.x, node.y);
        sprite.setDisplaySize(node.size * 2, node.size * 2);
        sprite.setDepth(node.size);
        
        // Instantiate or update outline sprite
        if (!outline) {
            outline = this.scene.add.image(node.x, node.y, 'outline_circle');
            this.scene.graphicsMap.set(node.id, outline);
        }
        outline.setPosition(node.x, node.y);
        outline.setDisplaySize(node.size * 2, node.size * 2);
        outline.setDepth(node.size + 0.1); // Slightly above base sprite
        
        // Tinting and aesthetics
        const darkColor = Phaser.Display.Color.IntegerToColor(colorHex).darken(20).color;
        outline.setTint(darkColor);
        outline.setVisible(!node.jagged); // Hide outline for viruses
        
        if (textureToUse === 'base_circle' || textureToUse === 'virus') {
            sprite.setTint(colorHex);
            
            // Disable mask update if no skin
            let maskShape = this.scene.maskMap.get(node.id);
            if (maskShape) maskShape.clear();
        } else {
            sprite.clearTint();
            
            // Update mask shape (expensive, but only done for visible skins)
            let maskShape = this.scene.maskMap.get(node.id);
            if (maskShape) {
                maskShape.clear();
                maskShape.fillStyle(0xffffff, 1);
                maskShape.fillCircle(node.x, node.y, node.size);
            }
        }

        // 2. Draw Text
        const showName = this.game.config.showNames && node.name;
        if (showName) {
            let t = this.scene.textMap.get(node.id);
            if (!t) {
                t = this.scene.add.text(node.x, node.y, node.name, {
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '40px',
                    color: '#ffffff',
                    stroke: '#000000',
                    strokeThickness: 6,
                    align: 'center'
                }).setOrigin(0.5);
                this.scene.textMap.set(node.id, t);
            }

            t.setDepth(node.size + 1);
            t.setPosition(node.x, node.y);

            const targetW = node.size * 1.5;
            const textScale = Math.min(targetW / Math.max(t.width, 1), 1);
            t.setScale(textScale);
        } else {
            let t = this.scene.textMap.get(node.id);
            if (t) {
                t.destroy();
                this.scene.textMap.delete(node.id);
            }
        }
    }

    destroy() {
        if (this.phaserGame) {
            this.phaserGame.destroy(true);
        }
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
    }
}
