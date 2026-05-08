import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PORT } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.join(__dirname, "../proto/chitchat.proto");

type GrpcStream = grpc.ClientDuplexStream<Record<string, unknown>, Record<string, unknown>>;

interface Pending {
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
}

export interface ChitchatClient {
  /** Register with the server; returns the assigned (possibly deduplicated) name. */
  register(name: string): Promise<string>;
  listSessions(): Promise<string[]>;
  sendMessage(to: string, message: string): Promise<void>;
  changeName(newName: string): Promise<string>;
  /** Emits 'message' events: (from: string, message: string) */
  events: EventEmitter;
  close(): void;
}

export function createClient(onDisconnect: () => void): ChitchatClient {
  const pkg = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(pkg) as Record<string, unknown>;
  const { ChitchatService } = proto["chitchat"] as Record<string, unknown>;

  const stub = new (ChitchatService as grpc.ServiceClientConstructor)(
    `localhost:${PORT}`,
    grpc.credentials.createInsecure()
  );

  const stream: GrpcStream = (stub as unknown as { Session(): GrpcStream }).Session();
  const pending = new Map<string, Pending>();
  const events = new EventEmitter();
  let disconnected = false;

  stream.on("data", (msg: Record<string, unknown>) => {
    const requestId = (msg["request_id"] as string) ?? "";

    if (msg["incoming"]) {
      const inc = msg["incoming"] as { from: string; message: string };
      events.emit("message", inc.from, inc.message);
      return;
    }

    const p = pending.get(requestId);
    if (p) {
      pending.delete(requestId);
      if (msg["error"]) {
        p.reject(new Error((msg["error"] as { message: string }).message));
      } else {
        p.resolve(msg);
      }
    }
  });

  function handleEnd() {
    if (disconnected) return;
    disconnected = true;
    for (const p of pending.values()) p.reject(new Error("stream closed"));
    pending.clear();
    onDisconnect();
  }

  stream.on("error", handleEnd);
  stream.on("end", handleEnd);

  function request(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      stream.write({ request_id: requestId, ...payload });
    });
  }

  return {
    async register(name: string): Promise<string> {
      const resp = await request({ register: { name } });
      return (resp["registered"] as { name: string }).name;
    },

    async listSessions(): Promise<string[]> {
      const resp = await request({ list: {} });
      return ((resp["sessions"] as { names: string[] }) ?? { names: [] }).names;
    },

    async sendMessage(to: string, message: string): Promise<void> {
      await request({ send: { to, message } });
    },

    async changeName(newName: string): Promise<string> {
      const resp = await request({ change: { new_name: newName } });
      return (resp["name_changed"] as { name: string }).name;
    },

    events,

    close() {
      disconnected = true;
      stream.end();
      stub.close();
    },
  };
}
