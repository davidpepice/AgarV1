export const PROTOCOL = {
    VERSION: 6,
    SEND: {
        VERSION: 254,
        KEY: 255,
        SPAWN: 0,
        MOUSE: 16,
        SPLIT: 17,
        Q: 18,
        FEED: 21,
        CHAT: 99
    },
    RECEIVE: {
        UPDATE_NODES: 16,
        UPDATE_CAMERA: 17,
        CLEAR_ALL: 18,
        CLEAR_OWN: 20,
        OWN_ID: 32,
        LEADERBOARD_TEXT: 48,
        LEADERBOARD_FFA: 49,
        LEADERBOARD_PIE: 50,
        BORDERS: 65, // Note: Cigar2 uses 0x41
        CHAT: 99,
        STATS: 254
    }
};

export class BinaryReader {
    constructor(view) {
        this.view = view;
        this.offset = 0;
        this.length = view.byteLength;
    }

    has(bytes) {
        return this.offset + bytes <= this.length;
    }

    readUInt8() {
        if (!this.has(1)) return 0;
        return this.view.getUint8(this.offset++);
    }

    readUInt16() {
        if (!this.has(2)) return 0;
        const val = this.view.getUint16(this.offset, true);
        this.offset += 2;
        return val;
    }

    readUInt32() {
        if (!this.has(4)) return 0;
        const val = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return val;
    }

    readInt32() {
        if (!this.has(4)) return 0;
        const val = this.view.getInt32(this.offset, true);
        this.offset += 4;
        return val;
    }

    readFloat32() {
        if (!this.has(4)) return 0;
        const val = this.view.getFloat32(this.offset, true);
        this.offset += 4;
        return val;
    }

    readFloat64() {
        if (!this.has(8)) return 0;
        const val = this.view.getFloat64(this.offset, true);
        this.offset += 8;
        return val;
    }

    readStringUTF8() {
        let s = '', b;
        while (this.has(1) && (b = this.readUInt8()) !== 0) s += String.fromCharCode(b);
        try {
            return decodeURIComponent(escape(s));
        } catch (e) {
            return s;
        }
    }
}

export class BinaryWriter {
    constructor(size = 1) {
        this.buffer = new ArrayBuffer(size);
        this.view = new DataView(this.buffer);
        this._bytes = [];
    }

    writeUInt8(val) {
        this._bytes.push(val);
        return this;
    }

    writeUInt32(val) {
        const temp = new ArrayBuffer(4);
        const view = new DataView(temp);
        view.setUint32(0, val, true);
        for (let i = 0; i < 4; i++) this._bytes.push(view.getUint8(i));
        return this;
    }

    writeStringUTF8(s) {
        const bytesStr = unescape(encodeURIComponent(s));
        for (let i = 0; i < bytesStr.length; i++) this._bytes.push(bytesStr.charCodeAt(i));
        this._bytes.push(0);
        return this;
    }

    build() {
        return new Uint8Array(this._bytes);
    }
}
