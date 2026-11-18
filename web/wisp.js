// A Wisp client (protocol v1, with the v2 greeting answered): many TCP streams
// carried over one WebSocket to a Wisp server, which opens the real TCP
// connections. It lets the game reach an ordinary Java server, which has no
// WebSocket of its own. A stream looks like a WebSocket (open/message/close
// events, send, close) so the game's socket code uses it unchanged.
//
// Written from the public protocol description (github.com/MercuryWorkshop/wisp-protocol).

const CONNECT = 0x01;
const DATA = 0x02;
const CONTINUE = 0x03;
const CLOSE = 0x04;
const INFO = 0x05;
const TCP = 0x01;

const REASONS = {
    0x01: "Connection closed",
    0x02: "The Wisp server had an error",
    0x03: "The Wisp server ended the connection",
    0x41: "The Wisp server refused the handshake",
    0x42: "That server can't be reached (is the address right?)",
    0x43: "That server didn't answer in time",
    0x44: "That server refused the connection",
    0x47: "That address is blocked by the Wisp server",
    0x48: "The Wisp server is limiting your connections",
    0x49: "The Wisp server rejected the request",
};

const encoder = new TextEncoder();

function packet(type, stream, payload) {
    const out = new Uint8Array(5 + payload.length);
    out[0] = type;
    new DataView(out.buffer).setUint32(1, stream, true);
    out.set(payload, 5);
    return out;
}

function connectPacket(stream, host, port) {
    const name = encoder.encode(host);
    const payload = new Uint8Array(3 + name.length);
    payload[0] = TCP;
    new DataView(payload.buffer).setUint16(1, port, true);
    payload.set(name, 3);
    return packet(CONNECT, stream, payload);
}

/** One TCP stream, shaped like a WebSocket. */
class WispStream {
    constructor(wisp, id, host, port) {
        this.wisp = wisp;
        this.id = id;
        this.host = host;
        this.port = port;
        this.readyState = 0;
        this.binaryType = "arraybuffer";
        this.onopen = this.onmessage = this.onclose = null;
        this.queue = [];
        this.credits = 0;
    }

    send(data) {
        if (this.readyState !== 1) throw new Error("The stream isn't open");
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength);
        this.queue.push(bytes);
        this.drain();
    }

    drain() {
        while (this.queue.length && this.credits > 0) {
            this.credits -= 1;
            this.wisp.socket.send(packet(DATA, this.id, this.queue.shift()));
        }
    }

    close() {
        if (this.readyState === 3) return;
        if (this.wisp.socket?.readyState === 1) this.wisp.socket.send(packet(CLOSE, this.id, Uint8Array.of(0x02)));
        this.end(1000, "");
    }

    end(code, reason) {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.wisp.streams.delete(this.id);
        this.onclose?.({ code, reason });
    }
}

export class Wisp {
    /** `url` is the Wisp server's WebSocket address (ws:// or wss://). */
    constructor(url) {
        this.url = url;
        this.socket = null;
        this.streams = new Map();
        this.next = 1;
        this.buffer = 0;
        this.ready = null;
    }

    // One WebSocket to the server, opened on first use and again after it drops.
    connection() {
        if (this.ready && this.socket && this.socket.readyState <= 1) return this.ready;
        this.buffer = 0;
        this.ready = new Promise((resolve, reject) => {
            const socket = new WebSocket(this.url);
            socket.binaryType = "arraybuffer";
            this.socket = socket;
            let settled = false;
            const settle = (fn, value) => {
                if (!settled) {
                    settled = true;
                    fn(value);
                }
            };
            socket.onmessage = ({ data }) => {
                if (!(data instanceof ArrayBuffer) || data.byteLength < 5) return;
                const bytes = new Uint8Array(data);
                const type = bytes[0];
                const id = new DataView(data).getUint32(1, true);
                const payload = bytes.subarray(5);
                if (type === CONTINUE && id === 0) {
                    this.buffer = new DataView(data).getUint32(5, true);
                    settle(resolve);
                } else if (type === INFO && id === 0) {
                    // A v2 server: answer with v2, no extensions. v2 servers send the buffer next.
                    if (payload[0] >= 2) socket.send(packet(INFO, 0, Uint8Array.of(2, 0)));
                } else if (type === CONTINUE) {
                    const stream = this.streams.get(id);
                    if (stream) {
                        stream.credits = new DataView(data).getUint32(5, true);
                        stream.drain();
                    }
                } else if (type === DATA) {
                    const stream = this.streams.get(id);
                    if (stream && stream.readyState === 1) stream.onmessage?.({ data: payload.slice().buffer });
                } else if (type === CLOSE) {
                    this.streams.get(id)?.end(payload[0] === 0x02 || payload[0] === 0x01 ? 1000 : 1006, REASONS[payload[0]] ?? `Closed by the Wisp server (${payload[0]})`);
                }
            };
            socket.onerror = () => settle(reject, new Error("Couldn't reach the Wisp server"));
            socket.onclose = () => {
                settle(reject, new Error("The Wisp server closed the connection"));
                for (const stream of [...this.streams.values()]) stream.end(1006, "The Wisp server connection dropped");
            };
        });
        // Nothing else holds this promise until a stream asks.
        this.ready.catch(() => {});
        return this.ready;
    }

    /** A stream to `host:port`, like `new WebSocket(...)`: events fire as it opens, receives and closes. */
    connect(host, port) {
        const stream = new WispStream(this, this.next++, host, port);
        this.connection().then(
            () => {
                if (stream.readyState !== 0) return;
                this.streams.set(stream.id, stream);
                stream.credits = this.buffer;
                this.socket.send(connectPacket(stream.id, host, port));
                stream.readyState = 1;
                stream.onopen?.({});
            },
            (e) => stream.end(1006, e.message),
        );
        return stream;
    }
}
