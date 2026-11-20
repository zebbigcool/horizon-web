import assert from "node:assert/strict";
import { test } from "node:test";
import { levelOf, summarize } from "./chat-notify.js";

const text = (id, last, server = "s1") => [id, { _id: id, channel_type: "TextChannel", server, last_message_id: last }];
const dm = (id, last) => [id, { _id: id, channel_type: "DirectMessage", last_message_id: last }];
const ack = (last_id, ...mentions) => ({ last_id, mentions: new Set(mentions) });

test("a channel with a message newer than what you read is unread; a read one isn't", () => {
    const channels = new Map([text("a", "05"), text("b", "05"), text("c", null)]);
    const acks = new Map([["a", ack("05")], ["b", ack("03")]]);
    assert.deepEqual(summarize({ channels, acks, settings: {} }), { unread: 1, pinged: false });
});

test("a channel you never opened counts as unread once it has messages", () => {
    const channels = new Map([text("a", "01")]);
    assert.deepEqual(summarize({ channels, acks: new Map(), settings: {} }), { unread: 1, pinged: false });
});

test("a mention pings, and wins even in a channel set to mentions only", () => {
    const channels = new Map([text("a", "09"), dm("d", "07")]);
    const acks = new Map([["a", ack("05", "09")], ["d", ack("07")]]);
    const settings = { channel: { a: "mention" } };
    assert.deepEqual(summarize({ channels, acks, settings }), { unread: 0, pinged: true });
});

test("muted channels and servers show nothing, a channel setting beats its server's", () => {
    const channels = new Map([text("a", "09", "s1"), text("b", "09", "s1"), text("c", "09", "s2")]);
    const acks = new Map([["a", ack("01", "09")], ["b", ack("01")], ["c", ack("01")]]);
    const settings = { server: { s1: "muted" }, channel: { b: "all" } };
    assert.equal(levelOf(settings, channels.get("a")), "none");
    assert.equal(levelOf(settings, channels.get("b")), "all");
    assert.deepEqual(summarize({ channels, acks, settings }), { unread: 2, pinged: false });
});
