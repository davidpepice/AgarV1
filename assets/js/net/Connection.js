import { PROTOCOL, BinaryReader, BinaryWriter } from './Protocol.js';

export default class Connection {
    constructor(game) {
        this.game = game;
        this.ws = null;
        this.url = '';
    }

    connect(url, nickname, spectate = false) {
        this.url = url;
        console.log(`Connecting to ${url}...`);

        if (this.ws) {
            this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror = null;
            this.ws.close();
        }

        try {
            this.ws = new WebSocket(url);
            this.ws.binaryType = 'arraybuffer';

            this.ws.onopen = () => this.onOpen(nickname, spectate);
            this.ws.onmessage = (msg) => this.onMessage(msg);
            this.ws.onclose = () => this.onClose();
            this.ws.onerror = (err) => this.onError(err);
        } catch (e) {
            console.error("Connection failed:", e);
        }
    }

    onOpen(nickname, spectate) {
        console.log("Connected to Ogar v6!");

        // Protocol 6 Handshake
        this.send(new Uint8Array([254, 6, 0, 0, 0])); // Version 6
        this.send(new Uint8Array([255, 1, 0, 0, 0])); // Key 1

        if (spectate) {
            this.spectate();
        } else {
            this.spawn(nickname);
        }
    }

    spectate() {
        const writer = new BinaryWriter();
        writer.writeUInt8(PROTOCOL.SEND.SPECTATE);
        this.send(writer.build());
    }

    spawn(nickname) {
        const writer = new BinaryWriter();
        writer.writeUInt8(PROTOCOL.SEND.SPAWN);
        writer.writeStringUTF8(nickname);
        this.send(writer.build());
    }

    onMessage(msg) {
        const reader = new BinaryReader(new DataView(msg.data));
        const packetId = reader.readUInt8();
        try {
            switch (packetId) {
                case 0x10: // UPDATE_NODES
                    this.handleUpdateNodes(reader);
                    break;
                case 0x11: // UPDATE_CAMERA
                    this.game.renderer.camX = reader.readFloat32();
                    this.game.renderer.camY = reader.readFloat32();
                    this.game.renderer.targetScale = reader.readFloat32();
                    break;
                case 0x12: // CLEAR_ALL
                    this.game.clearAll();
                    break;
                case 0x14: // CLEAR_OWN
                    this.game.clearOwn();
                    break;
                case 0x20: // NEW_CELL (Own ID)
                    this.game.addOwnId(reader.readUInt32());
                    break;
                case 0x21: // Draw line (Unsupported)
                    break;
                case 0x30: // LB Text
                case 0x31: // LB FFA
                    this.handleLeaderboard(packetId, reader);
                    break;
                case 0x41: // BORDERS (Cigar2 style)
                case 0x40:
                    this.handleBorders(reader);
                    break;
                case 0x63: // CHAT
                    // Handle chat if needed
                    break;
            }
        } catch (e) {
            // console.error("Parse error packet", packetId, e);
        }
    }

    handleUpdateNodes(reader) {
        // 1. Eating records
        const eatCount = reader.readUInt16();
        for (let i = 0; i < eatCount; i++) {
            const hunter = reader.readUInt32();
            const prey = reader.readUInt32();
            this.game.removeNode(prey);
        }

        // 2. Node Update records
        while (true) {
            const id = reader.readUInt32();
            if (id === 0) break;

            const x = reader.readInt32();
            const y = reader.readInt32();
            const size = reader.readUInt16();

            const flagMask = reader.readUInt8();
            const flags = {
                updColor: !!(flagMask & 0x02),
                updSkin: !!(flagMask & 0x04),
                updName: !!(flagMask & 0x08),
                jagged: !!(flagMask & 0x01) || !!(flagMask & 0x10),
                ejected: !!(flagMask & 0x20),
            };

            let color = null;
            if (flags.updColor) {
                const r = reader.readUInt8();
                const g = reader.readUInt8();
                const b = reader.readUInt8();
                color = `rgb(${r},${g},${b})`;
            }

            let skin = flags.updSkin ? reader.readStringUTF8() : null;
            let name = flags.updName ? reader.readStringUTF8() : null;

            this.game.updateNode(id, x, y, size, color, name, flags.jagged);
        }

        // 3. Disappear records
        const removeCount = reader.readUInt16();
        for (let i = 0; i < removeCount; i++) {
            this.game.removeNode(reader.readUInt32());
        }

        // Cigar2: Check for timestamp at the end of the packet (4 bytes)
        if (reader.has(4)) {
            const serverTime = reader.readUInt32();
            this.game.syncTime(serverTime);
        }
    }

    handleLeaderboard(type, reader) {
        const count = reader.readUInt32();
        const list = [];
        for (let i = 0; i < count; i++) {
            if (type === 0x31) reader.readUInt32(); // skip "isMe" or ID
            list.push(reader.readStringUTF8() || "Unnamed");
        }
        this.game.updateLeaderboard(list);
    }

    handleBorders(reader) {
        const l = reader.readFloat64();
        const t = reader.readFloat64();
        const r = reader.readFloat64();
        const b = reader.readFloat64();
        this.game.borders = { l, t, r, b };
    }

    onClose() {
        console.log("Disconnected.");
        this.game.ui.mainMenu.style.display = 'flex';
    }

    onError(err) {
        console.error("WebSocket error:", err);
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(data);
        }
    }
}
