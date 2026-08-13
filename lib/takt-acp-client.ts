import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientContext,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import { resolveCommand, usesWindowsShell } from "./takt-state.ts";

export interface TaktAcpClientOptions {
  cwd: string;
  command?: string;
  onUpdate?: (update: TaktAcpUpdate) => void;
}

export interface TaktAcpUpdate {
  sessionId: string;
  kind: string;
  text?: string;
  title?: string;
  status?: string;
}

export interface TaktEnqueueResult {
  sessionId: string;
  stopReason: string;
  messages: string[];
}

export function buildEnqueuePrompt(task: string): string {
  return `/go ${task.trim()}`;
}

export function normalizeAcpUpdate(notification: SessionNotification): TaktAcpUpdate {
  const update = notification.update;
  if (update.sessionUpdate === "agent_message_chunk" || update.sessionUpdate === "agent_thought_chunk") {
    return {
      sessionId: notification.sessionId,
      kind: update.sessionUpdate,
      ...(update.content.type === "text" ? { text: update.content.text } : {}),
    };
  }
  if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
    return {
      sessionId: notification.sessionId,
      kind: update.sessionUpdate,
      ...(update.title ? { title: update.title } : {}),
      ...(update.status ? { status: update.status } : {}),
    };
  }
  return { sessionId: notification.sessionId, kind: update.sessionUpdate };
}

export class TaktAcpClient {
  private child: ChildProcess | undefined;
  private connection: ClientContext | undefined;
  private sessionId: string | undefined;
  private readonly options: TaktAcpClientOptions;

  constructor(options: TaktAcpClientOptions) {
    this.options = options;
  }

  async enqueue(task: string): Promise<TaktEnqueueResult> {
    if (!task.trim()) {
      throw new Error("TAKT task must not be empty");
    }
    if (this.child) {
      throw new Error("TAKT ACP request is already running");
    }

    const command = resolveCommand(this.options.command ?? process.env.TAKT_ACP_COMMAND ?? "takt-acp");
    const child = spawn(command, [], {
      cwd: this.options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: usesWindowsShell(command),
    });
    this.child = child;
    const stderr = collectStderr(child);
    const updates: TaktAcpUpdate[] = [];
    const app = client({ name: "pi-takt-bridge" })
      .onNotification(methods.client.session.update, ({ params }) => {
        const update = normalizeAcpUpdate(params);
        updates.push(update);
        this.options.onUpdate?.(update);
      })
      .onRequest(methods.client.elicitation.create, async () => ({ action: "decline" }));

    try {
      const output = Writable.toWeb(child.stdin as NodeJS.WritableStream) as unknown as WritableStream<Uint8Array>;
      const input = Readable.toWeb(child.stdout as NodeJS.ReadableStream) as unknown as ReadableStream<Uint8Array>;
      const stream = ndJsonStream(output, input);
      const childError = new Promise<never>((_resolve, reject) => {
        child.once("error", reject);
      });
      const result = await Promise.race([
        app.connectWith(stream, async (connection) => {
          this.connection = connection;
          const initialized = await connection.request<InitializeResponse>(methods.agent.initialize, {
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: { elicitation: { form: true } },
            clientInfo: { name: "pi-takt-bridge", version: "0.1.0" },
          });
          if (initialized.protocolVersion !== PROTOCOL_VERSION) {
            throw new Error(`Unsupported ACP protocol version: ${initialized.protocolVersion}`);
          }

          const newSessionParams = {
            cwd: this.options.cwd,
            mcpServers: [],
            defaultAction: "enqueue",
          } as unknown as NewSessionRequest;
          const session = await connection.request<NewSessionResponse>(methods.agent.session.new, newSessionParams);
          this.sessionId = session.sessionId;
          const prompt = await connection.request<PromptResponse>(methods.agent.session.prompt, {
            sessionId: session.sessionId,
            prompt: [{ type: "text", text: buildEnqueuePrompt(task) }],
          });
          return { sessionId: session.sessionId, prompt };
        }),
        childError,
      ]);

      return {
        sessionId: result.sessionId,
        stopReason: result.prompt.stopReason,
        messages: updates.flatMap((update) => (update.text ? [update.text] : [])),
      };
    } catch (error) {
      const detail = stderr.value;
      if (detail && error instanceof Error) {
        error.message = `${error.message} (${detail})`;
      }
      throw error;
    } finally {
      this.connection = undefined;
      this.sessionId = undefined;
      await terminate(child);
      if (this.child === child) {
        this.child = undefined;
      }
    }
  }

  async cancel(): Promise<void> {
    if (this.connection && this.sessionId) {
      await this.connection.notify(methods.agent.session.cancel, { sessionId: this.sessionId });
    }
    if (this.child) {
      await terminate(this.child);
      this.child = undefined;
    }
  }

  async close(): Promise<void> {
    await this.cancel();
  }
}

function collectStderr(child: ChildProcess): { value: string } {
  const result = { value: "" };
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    result.value = `${result.value}${chunk}`.slice(-2_000).replace(/\s+/g, " ").trim();
  });
  return result;
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        try {
          child.kill("SIGKILL");
        } catch {
          // Best effort.
        }
      }
      finish();
    }, 1_000);
    child.once("close", finish);
  });
}
