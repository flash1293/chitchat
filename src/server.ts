import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PORT } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.join(__dirname, "../proto/chitchat.proto");

type Stream = grpc.ServerDuplexStream<Record<string, unknown>, Record<string, unknown>>;

// registry: session name → stream
const registry = new Map<string, Stream>();

function uniqueName(requested: string): string {
  if (!registry.has(requested)) return requested;
  let i = 2;
  while (registry.has(`${requested}-${i}`)) i++;
  return `${requested}-${i}`;
}

function handleStream(stream: Stream): void {
  let myName: string | null = null;

  stream.on("data", (msg: Record<string, unknown>) => {
    const requestId = (msg["request_id"] as string) ?? "";

    if (msg["register"]) {
      const req = msg["register"] as { name: string };
      myName = uniqueName(req.name);
      registry.set(myName, stream);

      stream.write({ request_id: requestId, registered: { name: myName } });
      return;
    }

    if (msg["list"]) {
      stream.write({
        request_id: requestId,
        sessions: { names: [...registry.keys()] },
      });
      return;
    }

    if (msg["send"]) {
      const req = msg["send"] as { to: string; message: string };
      const target = registry.get(req.to);
      if (!target) {
        stream.write({
          request_id: requestId,
          error: { message: `Session "${req.to}" not found` },
        });
        return;
      }
      target.write({ request_id: "", incoming: { from: myName ?? "unknown", message: req.message } });
      stream.write({ request_id: requestId, sent: {} });
      return;
    }

    if (msg["change"]) {
      const req = msg["change"] as { new_name: string };
      if (myName) registry.delete(myName);
      myName = uniqueName(req.new_name);
      registry.set(myName, stream);

      stream.write({ request_id: requestId, name_changed: { name: myName } });
      return;
    }
  });

  stream.on("end", () => {
    if (myName) registry.delete(myName);
    stream.end();
  });

  stream.on("error", () => {
    if (myName) registry.delete(myName);
  });
}

export function startServer(): Promise<void> {
  const pkg = protoLoader.loadSync(PROTO_PATH, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
  const proto = grpc.loadPackageDefinition(pkg) as Record<string, unknown>;
  const { ChitchatService } = (proto["chitchat"] as Record<string, unknown>);

  const server = new grpc.Server();
  (server as unknown as { addService(svc: unknown, impl: unknown): void }).addService(
    (ChitchatService as { service: unknown }).service,
    { Session: handleStream }
  );

  return new Promise((resolve, reject) => {
    server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}
