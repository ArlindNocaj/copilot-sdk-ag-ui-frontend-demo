import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CopilotClient } from "@github/copilot-sdk";
import { EventEncoder } from "@ag-ui/encoder";
import { EventType, RunAgentInputSchema } from "@ag-ui/core";
import type { CopilotAgent, CopilotClientPort } from "./ag_ui_copilot_sdk/index.js";
import { createAgenticChatAgent } from "./agents/agentic_chat.js";
import { createAgenticChatReasoningAgent } from "./agents/agentic_chat_reasoning.js";
import { createAgenticChatMultimodalAgent } from "./agents/agentic_chat_multimodal.js";
import { createBackendToolRenderingAgent } from "./agents/backend_tool_rendering.js";
import { createHumanInTheLoopAgent } from "./agents/human_in_the_loop.js";
import { createToolBasedGenerativeUIAgent } from "./agents/tool_based_generative_ui.js";
import { createSharedStateAgent } from "./agents/shared_state.js";
import { createAgenticGenerativeUIAgent } from "./agents/agentic_generative_ui.js";
import { createPredictiveStateUpdatesAgent } from "./agents/predictive_state_updates.js";
import { createInterruptAgent } from "./agents/interrupt.js";
import { createDeepagentsSubagentsAgent } from "./agents/deepagents_subagents.js";
import { createSubgraphsAgent } from "./agents/subgraphs.js";
import { tap } from "rxjs";
import { z } from "zod";
import { Store } from "./showcases/store.js";
import { Conflict } from "../../../shared/domain.js";
import { isShowcase, prepareShowcaseRun, showcaseAgents } from "./showcases/agents.js";

export function createAgents(client: CopilotClientPort): Record<string, CopilotAgent> {
  return {
    agentic_chat: createAgenticChatAgent(client),
    agentic_chat_reasoning: createAgenticChatReasoningAgent(client),
    agentic_chat_multimodal: createAgenticChatMultimodalAgent(client),
    backend_tool_rendering: createBackendToolRenderingAgent(client),
    human_in_the_loop: createHumanInTheLoopAgent(client),
    tool_based_generative_ui: createToolBasedGenerativeUIAgent(client),
    shared_state: createSharedStateAgent(client),
    agentic_generative_ui: createAgenticGenerativeUIAgent(client),
    predictive_state_updates: createPredictiveStateUpdatesAgent(client),
    interrupt: createInterruptAgent(client),
    deepagents_subagents: createDeepagentsSubagentsAgent(client),
    subgraphs: createSubgraphsAgent(client),
    ...showcaseAgents(client),
  };
}

async function main() {
  const host = process.env.HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1") throw new Error("This unauthenticated demo only binds to 127.0.0.1");
  const port = Number(process.env.PORT ?? 8228);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  const baseDirectory = await mkdtemp(join(tmpdir(), "copilot-ag-ui-demo-"));
  const client = new CopilotClient({
    mode: "empty", baseDirectory, logLevel: "error",
    useLoggedInUser: !process.env.OPENAI_BASE_URL,
  });
  await client.start();
  const agents = createAgents(client);
  const store = new Store();
  const server = http.createServer((req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    };
    void (async () => {
      if (req.headers.host !== `${host}:${port}` ||
          (req.headers.origin && req.headers.origin !== (process.env.FRONTEND_ORIGIN ?? "http://127.0.0.1:3310"))) {
        json(403, { error: "Loopback Host and trusted frontend Origin required" }); return;
      }
      const path = new URL(req.url ?? "/", `http://${host}:${port}`).pathname.slice(1);
      if (req.method === "GET" && path === "health") {
        json(200, { app: "copilot-sdk-ag-ui-frontend-demo", status: "healthy", backend: "typescript", mode: process.env.OPENAI_BASE_URL ? "byok" : "copilot", agents: Object.keys(agents) }); return;
      }
      const agent = req.method === "POST" && Object.hasOwn(agents, path) ? agents[path] : undefined;
      if (!agent && !(req.method === "POST" && path === "workbench")) { json(404, { error: "Unknown agent route" }); return; }
      if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] ?? "")) {
        json(415, { error: "application/json required" }); return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) { req.resume(); json(413, { error: "Request exceeds 4 MiB" }); return; }
        chunks.push(chunk);
      }
      let raw: unknown;
      try { raw = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { json(400, { error: "Invalid JSON" }); return; }
      if (path === "workbench") { json(200, store.execute(raw)); return; }
      const parsed = RunAgentInputSchema.safeParse(raw);
      if (!parsed.success) { json(400, { error: "Invalid AG-UI run", issues: parsed.error.issues }); return; }
      if (parsed.data.messages.length > 100 || parsed.data.tools.length > 8 ||
          !/^[\w-]{1,128}$/.test(parsed.data.threadId)) {
        json(400, { error: "Run exceeds demo limits" }); return;
      }
      const observe = isShowcase(path) ? prepareShowcaseRun(store, path, parsed.data) : () => {};
      const encoder = new EventEncoder({ accept: "text/event-stream" });
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
      const subscription = agent!.run(parsed.data).pipe(tap(observe)).subscribe({
        next: event => res.write(encoder.encode(event)),
        error: (error: unknown) => {
          console.error("Agent run failed:", error);
          res.end(encoder.encode({ type: EventType.RUN_ERROR, message: error instanceof Error ? error.message : "Agent run failed" }));
        },
        complete: () => res.end(),
      });
      res.once("close", () => subscription.unsubscribe());
    })().catch((error: unknown) => {
      console.error("Request failed:", error);
      if (!res.headersSent) json(error instanceof Conflict ? error.status : error instanceof z.ZodError ? 400 : 500, { error: error instanceof Error ? error.message : "Request failed", ...(error instanceof Conflict ? { code: error.code } : {}) });
      else res.destroy(error instanceof Error ? error : new Error("Request failed"));
    });
  });
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    server.closeAllConnections();
    server.close();
    await Promise.all(Object.values(agents).map(agent => agent.close()));
    await client.stop();
    await rm(baseDirectory, { recursive: true, force: true });
  };
  process.once("SIGINT", () => void shutdown().catch(console.error));
  process.once("SIGTERM", () => void shutdown().catch(console.error));
  server.requestTimeout = 15_000;
  server.once("error", error => { console.error(error); process.exitCode = 1; void shutdown().catch(console.error); });
  server.listen(port, host, () => console.log(`TypeScript AG-UI: http://${host}:${port}`));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
