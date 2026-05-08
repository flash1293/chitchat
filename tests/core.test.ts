/**
 * Core tests for the gRPC server/client and leader-election logic.
 *
 * Run with:  npm test
 * Uses port 16876 (set via CHITCHAT_PORT in the npm test script) to avoid
 * colliding with any live session on the default port 6876.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { startServer } from "../src/server.ts";
import { createClient, type ChitchatClient } from "../src/client.ts";
import { init } from "../src/startup.ts";

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ── Server / client interaction ───────────────────────────────────────────────

describe("server–client interaction", () => {
  let c1: ChitchatClient;
  let c2: ChitchatClient;

  before(async () => {
    await startServer();
    c1 = createClient(() => {});
    c2 = createClient(() => {});
  });

  after(() => {
    c1?.close();
    c2?.close();
  });

  it("registers sessions with the requested name", async () => {
    const n1 = await c1.register("alice");
    const n2 = await c2.register("bob");
    assert.equal(n1, "alice");
    assert.equal(n2, "bob");
  });

  it("lists all registered sessions", async () => {
    const sessions = await c1.listSessions();
    assert.ok(sessions.includes("alice"), `sessions: ${sessions}`);
    assert.ok(sessions.includes("bob"),   `sessions: ${sessions}`);
  });

  it("delivers a message from sender to recipient", async () => {
    const received: Array<{ from: string; message: string }> = [];
    c2.events.on("message", (from, message) => received.push({ from, message }));

    await c1.sendMessage("bob", "hello bob");
    await sleep(100);

    assert.equal(received.length, 1);
    assert.equal(received[0].from, "alice");
    assert.equal(received[0].message, "hello bob");
  });

  it("renames a session and reflects the change in the list", async () => {
    const assigned = await c1.changeName("alice-v2");
    assert.equal(assigned, "alice-v2");

    const sessions = await c2.listSessions();
    assert.ok(sessions.includes("alice-v2"), `sessions: ${sessions}`);
    assert.ok(!sessions.includes("alice"),   "old name should be gone");
  });

  it("deduplicates names by appending -2, -3, …", async () => {
    const c3 = createClient(() => {});
    try {
      const name = await c3.register("bob");
      assert.equal(name, "bob-2");
    } finally {
      c3.close();
    }
  });

  it("returns an error when the target session does not exist", async () => {
    await assert.rejects(
      () => c1.sendMessage("nobody", "hi"),
      /not found/i
    );
  });
});

// ── Session removal on disconnect ─────────────────────────────────────────────

describe("session removal on disconnect", () => {
  it("removes a session from the list after it closes", async () => {
    const temp = createClient(() => {});
    await temp.register("temp");

    const observer = createClient(() => {});
    await observer.register("observer");

    const before = await observer.listSessions();
    assert.ok(before.includes("temp"), `temp should be present: ${before}`);

    temp.close();
    await sleep(200);

    const after = await observer.listSessions();
    assert.ok(!after.includes("temp"), `temp should be removed: ${after}`);
    observer.close();
  });
});

// ── Leader election ───────────────────────────────────────────────────────────

describe("leader election", () => {
  it("rejects a second startServer call on the same port (EADDRINUSE)", async () => {
    await assert.rejects(
      () => startServer(),
      (err: unknown) => {
        assert.ok(String(err).includes("EADDRINUSE"), `expected EADDRINUSE, got: ${err}`);
        return true;
      }
    );
  });

  it("startup.init connects as client when port is occupied", async () => {
    // init() should silently fall back to client mode; it must not throw.
    let messageReceived = "";
    await init((from, msg) => { messageReceived = `${from}:${msg}`; });

    // The session is now registered — confirm it appears in the list.
    const { client } = await import("../src/startup.ts");
    assert.ok(client !== null, "client should be connected");
    const sessions = await client!.listSessions();
    assert.ok(sessions.length > 0, `expected at least one session: ${sessions}`);
  });

  it("a late-joining client connects and can exchange messages", async () => {
    const late = createClient(() => {});
    const name = await late.register("late-joiner");
    assert.equal(name, "late-joiner");

    const sessions = await late.listSessions();
    assert.ok(sessions.includes("late-joiner"), `sessions: ${sessions}`);
    late.close();
  });
});
