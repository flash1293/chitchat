import path from "node:path";

function deriveDefaultName(): string {
  if (process.env["CHITCHAT_SESSION_NAME"]) return process.env["CHITCHAT_SESSION_NAME"];
  const base = path.basename(process.cwd());
  if (base && !base.startsWith("$") && base !== "." && base !== "tmp" && base !== "T") {
    return base;
  }
  return `agent-${process.pid}`;
}

const state = {
  name: deriveDefaultName(),
};

export function getName(): string {
  return state.name;
}

export function setName(name: string): void {
  state.name = name;
}
