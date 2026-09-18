import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { createMockServer } from "../scripts/mock-model.ts";
import { features } from "../frontend/src/features.ts";

// Opt-in: this exercises SDK 1.0.14 and the actual copied adapter, not a fake client.
test("real Copilot SDK BYOK consumes the aimock feature fixtures", {
  skip: process.env.RUN_MOCK_SDK_SMOKE !== "1", timeout: 180_000,
}, async (t) => {
  const work = resolve(`tests/mock-model-runtime-work-${process.pid}`);
  await mkdir(work, { recursive: true });
  const keys = ["TMPDIR", "OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_CHAT_MODEL_ID", "COPILOT_MODEL"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const mock = createMockServer({ port: 0 });
  const agents = [];
  let client;
  t.after(async () => {
    await Promise.all(agents.map((agent) => agent.close()));
    await client?.stop();
    await mock.stop();
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(work, { recursive: true, force: true });
  });
  process.env.TMPDIR = work;
  process.env.OPENAI_BASE_URL = `${await mock.start()}/v1`;
  process.env.OPENAI_API_KEY = "demo-mock-not-a-secret";
  process.env.OPENAI_CHAT_MODEL_ID = "gpt-4o";
  process.env.COPILOT_MODEL = "gpt-4o";
  assert.equal((await (await fetch(`${mock.url}/health`)).json()).status, "ok");
  const { CopilotClient } = await import("../backend/typescript/node_modules/@github/copilot-sdk/dist/index.js");
  client = new CopilotClient({ mode: "empty", baseDirectory: work, useLoggedInUser: false, logLevel: "error" });
  await client.start();
  for (const [feature, factory, tools, expected] of [
    ["agentic_chat", "createAgenticChatAgent", [], "Paris"],
    ["backend_tool_rendering", "createBackendToolRenderingAgent", [], "get_weather"],
    ["shared_state", "createSharedStateAgent", [], "generate_recipe"],
    ["agentic_generative_ui", "createAgenticGenerativeUIAgent", [], "generate_task_steps"],
    ["agentic_chat_reasoning", "createAgenticChatReasoningAgent", [], "REASONING"],
    ["human_in_the_loop", "createHumanInTheLoopAgent", ["generate_task_steps"], "generate_task_steps"],
    ["tool_based_generative_ui", "createToolBasedGenerativeUIAgent", ["generate_haiku"], "generate_haiku"],
    ["predictive_state_updates", "createPredictiveStateUpdatesAgent", ["write_document"], "write_document"],
    ["interrupt", "createInterruptAgent", [], "schedule_meeting"],
    ["subgraphs", "createSubgraphsAgent", [], "choose_travel_option"],
    ["deepagents_subagents", "createDeepagentsSubagentsAgent", [], "request_human_approval"],
    ["agentic_chat_multimodal", "createAgenticChatMultimodalAgent", [], "multimodal-image-verified"],
  ]) {
    const module = await import(`../backend/typescript/src/agents/${feature}.ts`);
    const agent = module[factory](client);
    agents.push(agent);
    const prompt = features[feature][2];
    const content = feature === "agentic_chat_multimodal" ? [
      { type: "text", text: prompt },
      { type: "binary", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF7sAAAAASUVORK5CYII=" },
    ] : prompt;
    const input = {
      threadId: randomUUID(), runId: randomUUID(), context: [], state: {}, forwardedProps: {},
      messages: [{ id: randomUUID(), role: "user", content }],
      tools: tools.map((name) => ({ name, description: `Demo ${name}`, parameters: { type: "object", additionalProperties: true } })),
    };
    const events = await new Promise((accept, reject) => {
      const events = [];
      const timer = setTimeout(() => { subscription.unsubscribe(); reject(new Error(`${feature} timed out`)); }, 40_000);
      const subscription = agent.run(input).subscribe({
        next: (event) => events.push(event),
        error: (error) => { clearTimeout(timer); reject(error); },
        complete: () => { clearTimeout(timer); accept(events); },
      });
    });
    assert.ok(!events.some((event) => event.type === "RUN_ERROR"), `${feature}: ${JSON.stringify(events.filter((event) => event.type === "RUN_ERROR"))}`);
    const text = events.filter((event) => event.type === "TEXT_MESSAGE_CONTENT").map((event) => event.delta).join("");
    assert.ok(JSON.stringify(events).includes(expected) || text.includes(expected), `${feature} did not emit ${expected}`);
    assert.ok(events.some((event) => event.type === "RUN_FINISHED"), `${feature} did not finish`);
    if (feature === "agentic_chat_reasoning") {
      assert.ok(events.filter((event) => event.type === "REASONING_MESSAGE_CONTENT").length > 1, "SDK must forward multiple reasoning deltas");
    }
    if (feature === "predictive_state_updates") {
      assert.ok(events.filter((event) => event.type === "TOOL_CALL_ARGS").length > 1, "SDK must forward chunked tool arguments");
    }
    t.diagnostic(`${feature}: real SDK + real adapter passed`);
    await agent.close();
  }
  const requests = mock.getRequests();
  assert.ok(requests.length > 0);
  assert.ok(requests.every((entry) => entry.path === "/v1/chat/completions"), "gpt-4o BYOK must use Chat Completions, not the separately patched Responses API");
  assert.ok(requests.every((entry) => entry.body.model === "gpt-4o" && entry.body.stream === true));
  t.diagnostic(`${requests.length} real SDK requests used streaming /v1/chat/completions; no Responses API patch needed`);
});
