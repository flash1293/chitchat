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
      `[chitchat — message from agent "${from}"]\n\n` +
      `${message}\n\n` +
      `---\n` +
      `If this requires a response or clarification, send it back to "${from}" ` +
      `using chitchat_send_message — your direct output is not visible to them.`
    );
  });

  // ── Tools ────────────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "chitchat_list_sessions",
    description:
      "List all connected chitchat sessions and your own session name. " +
      "Use this to discover who you can talk to and to confirm your own identity " +
      "before sending messages.",
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
      "Send a message to another agent session by name. " +
      "The message is injected as a user message in the recipient's conversation. " +
      "Use this to deliver results, answers, or clarification questions — " +
      "the recipient cannot see your direct output, only what you send via chitchat. " +
      "Any reply arrives in your conversation the same way, as an injected user message.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Session name of the recipient (from chitchat_list_sessions)." },
        message: { type: "string", description: "The message to send." },
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
