/**
 * Pi native extension for chitchat.
 *
 * This is a pi TypeScript extension — NOT an MCP server. It runs inside pi's
 * process and gets true push injection via pi.sendUserMessage().
 *
 * Installation: add to pi's settings.json:
 *   { "extensions": ["/path/to/chitchat/src/plugins/pi-extension.ts"] }
 *
 * Or symlink into auto-discovery:
 *   ln -s /path/to/chitchat/src/plugins/pi-extension.ts ~/.pi/agent/extensions/chitchat.ts
 */

import { init, client } from "../startup.js";
import { getName, setName } from "../session.js";

// Minimal interface for the pi API — the real type is from @earendil-works/pi-coding-agent
// which pi provides at runtime. We inline what we use here to avoid an install-time dep.
interface PiTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(
    toolCallId: string,
    params: Record<string, string>,
    signal: AbortSignal
  ): Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

interface PiAPI {
  sendUserMessage(text: string): void;
  registerTool(tool: PiTool): void;
  registerCommand(name: string, def: { description: string; handler(args: string): Promise<void> }): void;
}

export default async function (pi: PiAPI) {
  // ── gRPC init ────────────────────────────────────────────────────────────────

  await init((from, message) => {
    pi.sendUserMessage(
      `[chitchat — incoming message from agent "${from}"]\n\n` +
      `${message}\n\n` +
      `---\n` +
      `You are running as a headless agent. There is no human watching this conversation directly. ` +
      `chitchat is your only communication channel with other agents and the outside world. ` +
      `Use chitchat_send_message to reply to "${from}" — that is how your response reaches them.`
    );
  });

  // ── Tools ────────────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "chitchat_list_sessions",
    description:
      "List all connected chitchat sessions and your own session name. " +
      "This session is headless — no human is watching directly. " +
      "chitchat is the only way to send output to other agents or receive input from them. " +
      "Use this tool to find out your own name and who else is connected.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    async execute() {
      if (!client) return { content: [{ type: "text", text: "chitchat not connected." }] };
      const sessions = await client.listSessions();
      const me = getName();
      const others = sessions.filter((s) => s !== me);
      const lines = [
        `Your session name: ${me}`,
        others.length === 0 ? "No other sessions connected." : `Other sessions: ${others.join(", ")}`,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  });

  pi.registerTool({
    name: "chitchat_send_message",
    description:
      "Send a message to another agent session. " +
      "This is your primary output channel — since this session is headless, " +
      "chitchat_send_message is how your work and responses reach other agents. " +
      "The message is injected as a user message in the recipient's conversation; " +
      "they will respond on their own. Any reply comes back to you the same way, " +
      "as an injected user message — no polling needed.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Session name of the recipient (from chitchat_list_sessions)." },
        message: { type: "string", description: "The message or result to send." },
      },
      required: ["to", "message"],
    },
    async execute(_id, { to, message }) {
      if (!client) return { content: [{ type: "text", text: "chitchat not connected." }] };
      await client.sendMessage(to, message);
      return { content: [{ type: "text", text: `Sent to "${to}". Their reply will arrive as a user message.` }] };
    },
  });

  // ── /chitchat rename command ──────────────────────────────────────────────────

  pi.registerCommand("chitchat", {
    description: "Change your chitchat session name: /chitchat <new-name>",
    async handler(args) {
      const newName = args.trim();
      if (!newName || !client) return;
      const assigned = await client.changeName(newName);
      setName(assigned);
    },
  });
}
