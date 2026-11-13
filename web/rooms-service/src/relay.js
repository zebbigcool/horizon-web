// An EaglerSPRelay-compatible relay for shared worlds: it hands out join codes
// and passes the WebRTC handshake between a host and the players who join, then
// steps aside (the game's bytes go over the WebRTC data channel, not through
// here). The packets are the ones the game's page speaks (crates/horizon-os
// src/net.rs): an id byte, then fields; strings are a u8 length + ASCII,
// descriptions a u16 length + bytes.
//
//   0x00 handshake  client -> relay: [0x00, kind (1 host, 2 player), 1, str8]  (host: the
//                   world's name; player: the code). Host's answer: [0x00, 0, 1, str8 code].
//   0x01 ICE servers relay -> either, right after the handshake.
//   0x02 new player relay -> host: str8 player id.
//   0x04 description  player -> relay -> host (with the player's id) and back.
//   0x03 candidate    the same way.
//   0x05 success      player -> relay: its channel is open; the relay lets go of it.
//   0x06 / 0xFE       relay -> host: this player went away before it finished.
//   0xFF error        relay -> player: [0xFF, 5] unknown code, [0xFF, 4, bytes16 message] otherwise.

const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const CODE_LENGTH = 5;
const MAX_PEERS_PER_HOST = 64;
const MAX_HOSTS = 500;
const MAX_PACKET = 16 * 1024;

export const DEFAULT_STUN = ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"];

const enc = new TextEncoder();
const str8 = (s) => {
    const b = enc.encode(s).subarray(0, 255);
    return [b.length, ...b];
};
const bytes16 = (b) => [b.length >> 8, b.length & 255, ...b];
const ascii = (bytes) => String.fromCharCode(...bytes);
const readStr8 = (b, o) => {
    if (o >= b.length || o + 1 + b[o] > b.length) throw new Error("short packet");
    return [ascii(b.subarray(o + 1, o + 1 + b[o])), o + 1 + b[o]];
};
const readBytes16 = (b, o) => {
    if (o + 2 > b.length) throw new Error("short packet");
    const n = (b[o] << 8) | b[o + 1];
    if (o + 2 + n > b.length) throw new Error("short packet");
    return [b.subarray(o + 2, o + 2 + n), o + 2 + n];
};

// servers: [{ url, username?, credential? }]; a username makes it a TURN server.
export function iceServersPacket(servers) {
    const out = [0x01, servers.length >> 8, servers.length & 255];
    for (const s of servers) {
        out.push(s.username ? 84 : 83, ...bytes16(enc.encode(s.url)), ...str8(s.username ?? ""), ...str8(s.credential ?? ""));
    }
    return new Uint8Array(out);
}

export class Relay {
    constructor({ iceServers = DEFAULT_STUN.map((url) => ({ url })), random = Math.random } = {}) {
        this.iceServers = iceServers;
        this.random = random;
        this.hosts = new Map(); // code -> { socket, name, peers: Map<id, peer> }
        this.nextPeer = 0;
    }

    newCode() {
        for (let tries = 0; tries < 100; tries++) {
            let code = "";
            for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(this.random() * CODE_ALPHABET.length)];
            if (!this.hosts.has(code)) return code;
        }
        return null;
    }

    // A new WebSocket: `socket` has send(Uint8Array) and close(). Returns the
    // two functions the transport calls for its messages and its closing.
    connect(socket) {
        const me = { role: null, code: null, peerId: null, done: false };
        const send = (bytes) => {
            try {
                socket.send(bytes);
            } catch {
                // Already closing.
            }
        };
        const fail = (reason, code = 4) => {
            send(new Uint8Array(code === 5 ? [0xff, 5] : [0xff, code, ...bytes16(enc.encode(reason))]));
            socket.close(1008, reason.slice(0, 100));
        };

        const onMessage = (data) => {
            const b = data instanceof Uint8Array ? data : new Uint8Array(data);
            if (b.length === 0 || b.length > MAX_PACKET) return fail("bad packet");
            try {
                if (me.role === null) return this.handshake(me, b, send, fail, socket);
                if (me.role === "host") return this.fromHost(me, b);
                return this.fromPeer(me, b, fail);
            } catch {
                fail("bad packet");
            }
        };

        const onClose = () => {
            if (me.role === "host") {
                const host = this.hosts.get(me.code);
                if (host && host.socket === socket) {
                    this.hosts.delete(me.code);
                    for (const peer of host.peers.values()) peer.socket.close(1001, "The host left");
                }
            } else if (me.role === "peer") {
                const host = this.hosts.get(me.code);
                if (host?.peers.get(me.peerId) === me) {
                    host.peers.delete(me.peerId);
                    // Left before finishing: tell the host to drop the half-made link.
                    if (!me.done) host.send(new Uint8Array([0xfe, ...str8(me.peerId), 0, 0, 0]));
                }
            }
        };
        return { onMessage, onClose };
    }

    handshake(me, b, send, fail, socket) {
        if (b[0] !== 0x00 || b.length < 4) return fail("expected a handshake");
        const [text] = readStr8(b, 3);
        if (b[1] === 1) {
            if (this.hosts.size >= MAX_HOSTS) return fail("The relay is full");
            const code = this.newCode();
            if (!code) return fail("The relay is full");
            me.role = "host";
            me.code = code;
            this.hosts.set(code, { socket, send, name: text, peers: new Map() });
            send(new Uint8Array([0x00, 0, 1, ...str8(code)]));
            send(iceServersPacket(this.iceServers));
        } else if (b[1] === 2) {
            const host = this.hosts.get(text.toLowerCase());
            if (!host) return fail("No shared world has that code", 5);
            if (host.peers.size >= MAX_PEERS_PER_HOST) return fail("That shared world is full");
            me.role = "peer";
            me.code = text.toLowerCase();
            me.peerId = `p${++this.nextPeer}`;
            me.send = send;
            me.socket = socket;
            host.peers.set(me.peerId, me);
            send(iceServersPacket(this.iceServers));
            host.send(new Uint8Array([0x02, ...str8(me.peerId)]));
        } else {
            fail("unknown connection type");
        }
    }

    // Host -> a player: the packet names the player; the player gets it with the
    // field emptied (it has only the one host).
    fromHost(me, b) {
        const host = this.hosts.get(me.code);
        if (!host || (b[0] !== 0x03 && b[0] !== 0x04)) return;
        const [peerId, o] = readStr8(b, 1);
        const peer = host.peers.get(peerId);
        if (!peer) return;
        const [body] = readBytes16(b, o);
        peer.send(new Uint8Array([b[0], ...str8(""), ...bytes16(body)]));
    }

    // A player -> its host, tagged with the player's id.
    fromPeer(me, b, fail) {
        const host = this.hosts.get(me.code);
        if (!host) return fail("The host left");
        if (b[0] === 0x05) {
            me.done = true;
            return;
        }
        if (b[0] !== 0x03 && b[0] !== 0x04) return;
        const [, o] = readStr8(b, 1);
        const [body] = readBytes16(b, o);
        host.send(new Uint8Array([b[0], ...str8(me.peerId), ...bytes16(body)]));
    }
}
