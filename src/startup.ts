import { startServer } from "./server.js";
import { createClient, type ChitchatClient } from "./client.js";
import * as session from "./session.js";

export let client: ChitchatClient | null = null;

let _onMessage: ((from: string, message: string) => void) | null = null;

async function tryStartServer(): Promise<boolean> {
  try {
    await startServer();
    return true;
  } catch (err: unknown) {
    // grpc-js wraps the OS error in its message rather than exposing .code
    const isInUse =
      (err as NodeJS.ErrnoException).code === "EADDRINUSE" ||
      String(err).includes("EADDRINUSE");
    if (isInUse) return false;
    throw err;
  }
}

async function connect(): Promise<void> {
  client = createClient(handleDisconnect);
  client.events.on("message", (from: string, message: string) => {
    _onMessage?.(from, message);
  });
  const assignedName = await client.register(session.getName());
  session.setName(assignedName);
}

async function handleDisconnect(): Promise<void> {
  client = null;
  const delay = Math.floor(Math.random() * 2000);
  await new Promise<void>((r) => setTimeout(r, delay));
  await tryStartServer();
  await connect();
}

export async function init(onMessage: (from: string, message: string) => void): Promise<void> {
  _onMessage = onMessage;
  await tryStartServer();
  await connect();
}
