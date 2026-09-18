import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { matchFixture } from "@copilotkit/aimock";
import { createMockServer } from "../scripts/mock-model.ts";
import { initialState, aggregate, chartTotals } from "../shared/domain.ts";

const fixtures = createMockServer({ port: 0, log: () => {} }).getFixtures();
function resolveCompletion(req) {
  const fixture = matchFixture([...fixtures], { ...req, _endpointType: "chat" });
  assert.ok(fixture);
  const response = typeof fixture.response === "function" ? fixture.response(req) : fixture.response;
  if ("error" in response) throw new Error(response.error.message);
  return response;
}

const tool = (name, parameters = {}) => ({ type: "function", function: { name, parameters } });
const request = (system, user, names = []) => ({
  model: "gpt-4o",
  messages: [{ role: "system", content: system }, { role: "user", content: user }],
  tools: names.map((name) => tool(name)),
});
const args = (result) => JSON.parse(result.toolCalls[0].arguments);
test("Python packaged workbench data stays identical to shared frontend and TypeScript data", () => {
  for (const file of ["fixtures.json", "contracts.json", "instructions.txt"]) {
    assert.equal(readFileSync(new URL(`../backend/python/showcase_data/${file}`, import.meta.url), "utf8"),
      readFileSync(new URL(`../shared/${file}`, import.meta.url), "utf8"));
  }
});
function finish(req, name, value, callArgs = {}) {
  const id = `call_${req.messages.length}`;
  req.messages.push({ role: "assistant", content: null, tool_calls: [{
    id, type: "function", function: { name, arguments: JSON.stringify(callArgs) },
  }] }, { role: "tool", tool_call_id: id, content: typeof value === "string" ? value : JSON.stringify(value) });
  return req;
}

test("twelve feature entry points use declared tools, not fabricated adapter events", () => {
  assert.match(resolveCompletion(request("You are a helpful assistant. Use declared tools when requested.", "What is the capital of France?")).content, /Paris/);
  const weather = request("You are a helpful Weather Assistant.", "Weather in San Francisco", ["get_weather"]);
  assert.deepEqual(args(resolveCompletion(weather)), { location: "San Francisco" });
  assert.match(resolveCompletion(finish(weather, "get_weather", { temperature: 20, conditions: "sunny" })).content, /sunny, 20°C/);
  const human = request("You are a task planning assistant. Human review and approval.", "Make a plan with one step with eggs", ["generate_task_steps"]);
  const humanSteps = args(resolveCompletion(human)).steps;
  assert.equal(humanSteps.length, 3);
  assert.ok(humanSteps.every((step) => step.status === "enabled"));
  assert.match(humanSteps[0].description, /eggs/);
  const automated = request("You are a helpful assistant assisting with any task.", "A plan to make brownies", ["generate_task_steps"]);
  assert.ok(args(resolveCompletion(automated)).steps.every((step) => step.status === "pending"));
  assert.equal(args(resolveCompletion(automated)).steps.length, 3);
  const haiku = args(resolveCompletion(request("Creative writing assistant.", "Write a haiku", ["generate_haiku"])));
  assert.equal(haiku.english.length, 3);
  assert.equal(haiku.japanese.length, 3);
  const generatedRecipe = args(resolveCompletion(request("Helpful recipe assistant.", "Complete a pasta recipe", ["generate_recipe"]))).recipe;
  for (const key of ["title", "skill_level", "special_preferences", "cooking_time", "ingredients", "instructions", "changes"]) {
    assert.ok(key in generatedRecipe);
  }
  assert.match(generatedRecipe.title, /Pasta/);
  assert.match(args(resolveCompletion(request("Assistant for writing documents.", "Give me a story for a dragon called Atlantis in document", ["write_document"]))).document, /Atlantis/);
  const reasoning = resolveCompletion(request("Think carefully before you answer.", "What is the best car to buy?"));
  assert.match(reasoning.content, /Toyota/);
  assert.ok(reasoning.reasoning);
  assert.match(resolveCompletion(request("Think carefully before you answer.", "Recommend a car")).content, /Toyota/);
  assert.match(resolveCompletion(request("Analyze images.", [
    { type: "text", text: "What do you see in this image?" },
    { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
  ])).content, /multimodal-image-verified/);
  assert.equal(args(resolveCompletion(request("You are a scheduling assistant.", "Book an intro call with sales about pricing", ["schedule_meeting"]))).attendee, "Sales team");
  for (const [system, user, agent] of [
    ["You are the Copilot SDK travel supervisor.", "Plan my trip from Amsterdam to San Francisco", "flights_agent"],
    ["You are a research supervisor with one specialist subagent: research_assistant.", "Why is the sky blue?", "research_assistant"],
  ]) {
    const delegated = args(resolveCompletion(request(system, user, ["task"])));
    assert.equal(delegated.agent_type, agent);
    assert.equal(delegated.mode, "sync");
    for (const key of ["name", "description", "prompt"]) assert.ok(delegated[key]);
  }
});

test("latest turn and current shared state win over old tool results", () => {
  const req = request("Helpful recipe assistant.", "Complete a pasta recipe", ["generate_recipe"]);
  finish(req, "generate_recipe", "Recipe updated successfully");
  req.messages.push({ role: "system", content: `Current shared state:\n${JSON.stringify({
    recipe: { ingredients: [{ icon: "🥔", name: "Potatoes", amount: "12" }, { icon: "🥕", name: "Carrots", amount: "3" }] },
  })}` }, { role: "user", content: "List the ingredients" });
  const reply = resolveCompletion(req).content;
  assert.match(reply, /Potatoes: 12/);
  assert.match(reply, /Carrots: 3/);
  assert.doesNotMatch(reply, /Pasta:|completed/);
  assert.throws(() => resolveCompletion(request("Helpful recipe assistant.", "List the ingredients", ["generate_recipe"])), /shared recipe state/);
  req.messages.push({ role: "user", content: "Make a pasta recipe" });
  assert.equal(resolveCompletion(req).toolCalls[0].name, "generate_recipe");
});

test("document edits preserve the supplied document; approval and rejection differ", () => {
  const document = "# Atlantis\nAtlantis loves maps. Keep this sentence!";
  const req = request(`Assistant for writing documents.\nCurrent state: ${JSON.stringify({ document })}`, "Change dragon name to Lola", ["write_document"]);
  assert.equal(args(resolveCompletion(req)).document, "# Lola\nLola loves maps. Keep this sentence!");
  const approved = structuredClone(req);
  const rejected = structuredClone(req);
  assert.match(resolveCompletion(finish(approved, "write_document", "User approved the changes.")).content, /accepted/);
  assert.match(resolveCompletion(finish(rejected, "write_document", { approved: false })).content, /unchanged/);
  assert.throws(() => resolveCompletion(request("Assistant for writing documents.", "Change dragon name to Lola", ["write_document"])), /current Atlantis/);
});

test("adapter state preambles cannot match old intent or field names", () => {
  const wrap = (state, prompt) => `## Current shared state\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\`\n\n${prompt}`;
  const recipe = request("Helpful recipe assistant.", wrap({ recipe: { ingredients: [] } }, 'Please give me a pasta recipe with an ingredient called "Pasta"'), ["generate_recipe"]);
  assert.equal(resolveCompletion(recipe).toolCalls[0].name, "generate_recipe");
  const document = request("Assistant for writing documents.", wrap({ document: "A dragon called Atlantis." }, "Change dragon name to Lola"), ["write_document"]);
  assert.equal(args(resolveCompletion(document)).document, "A dragon called Lola.");
});

test("rich proposals and follow-ups use real receipts and current authoritative state", () => {
  for (const workflow of ["release", "support"]) {
    const state = initialState(workflow);
    const req = request("You assist in a fictional release/support workbench.", `## Current shared state\n\`\`\`json\n${JSON.stringify(state)}\n\`\`\`\nPropose exactly three fictional actions.`, ["review_plan"]);
    const plan = args(resolveCompletion(req));
    assert.equal(plan.actions.length, 3);
    assert.equal(plan.metric, workflow === "release" ? "failure-rate" : "age-distribution");
    const receipt = { nonce: "actual-app-nonce", revision: 2, accepted: [{ title: "Edited by user", owner: "Dana" }], rejected: ["action-3"], draftSaved: workflow === "support" };
    assert.match(resolveCompletion(finish(req, "review_plan", receipt)).content, /Edited by user \(Dana\)/);
    const target = plan.actions[0].target;
    state.items.find(item => item.id === target).status = "done";
    state.work = [{ ...plan.actions[0], owner: "Dana", status: "done" }];
    state.receipts = [receipt];
    state.revision = 3;
    state.draft = "User-edited saved reply.";
    state.computedTotals = chartTotals(aggregate(state));
    req.messages.push({ role: "user", content: `## Current shared state\n\`\`\`json\n${JSON.stringify(state)}\n\`\`\`\nNo tools. Read fresh authoritative state.` });
    const reply = resolveCompletion(req).content;
    assert.ok(reply.includes(`${target}: done`));
    assert.match(reply, /Revision 3/);
    if (workflow === "support") assert.match(reply, /31 open, 501 age-hours, 9 breaches.*User-edited saved reply/);
    else assert.match(reply, /95\/840/);
  }
});

test("human selections and scheduling never turn rejections into confirmations", () => {
  const req = request("Task planning assistant, human review and approval.", "one step with eggs", ["generate_task_steps"]);
  finish(req, "generate_task_steps", { steps: [
    { description: "Crack eggs", status: "disabled" }, { description: "Preheat oven", status: "enabled" },
  ] });
  assert.match(resolveCompletion(req).content, /Preheat oven/);
  assert.doesNotMatch(resolveCompletion(req).content, /Crack eggs/);
  for (const [result, expected] of [
    ["Meeting scheduled for Tuesday 10:00: Intro pricing call", /Tuesday 10:00/],
    ["User cancelled. Meeting NOT scheduled: Intro pricing call", /not scheduled/],
  ]) {
    const scheduling = request("You are a scheduling assistant.", "Book a call", ["schedule_meeting"]);
    assert.match(resolveCompletion(finish(scheduling, "schedule_meeting", result)).content, expected);
  }
});

test("native travel specialists search, pause, save exact selection, and return", () => {
  for (const agent of ["flights", "hotels"]) {
    const req = request(`You are the Copilot SDK travel specialist: ${agent}.`, `Plan ${agent}`, ["travel_state", "choose_travel_option"]);
    assert.deepEqual(args(resolveCompletion(req)), { agent });
    const search = { agent, message: "Choose one", options: [{ name: "Option A" }, { name: "Option B" }], recommendation: { name: "Option A" } };
    finish(req, "travel_state", search, { agent });
    assert.equal(resolveCompletion(req).toolCalls[0].name, "choose_travel_option");
    assert.deepEqual(args(resolveCompletion(req)), search);
    finish(req, "choose_travel_option", { agent, selection: "Option B" });
    assert.deepEqual(args(resolveCompletion(req)), { agent, selection: "Option B" });
    finish(req, "travel_state", { agent, selection: "Option B", saved: true });
    assert.equal(resolveCompletion(req).content, "Selected Option B.");
  }
  const experiences = request("You are the Copilot SDK travel specialist: experiences.", "Plan experiences", ["travel_state"]);
  finish(experiences, "travel_state", { agent: "experiences", experiences: [{ name: "Pier 39" }, { name: "Tartine Bakery" }] });
  assert.match(resolveCompletion(experiences).content, /Pier 39, Tartine Bakery/);
  const supervisor = request("You are the Copilot SDK travel supervisor.", "Plan a trip", ["task"]);
  for (const [index, agent] of ["flights", "hotels", "experiences"].entries()) {
    assert.equal(args(resolveCompletion(supervisor)).agent_type, `${agent}_agent`);
    finish(supervisor, "task", `${agent} complete`, { agent_type: `${agent}_agent` });
    if (index === 2) assert.match(resolveCompletion(supervisor).content, /Nothing has been booked/);
  }
});

test("research assistant approval and supervisor relay are not generic acknowledgments", () => {
  const system = "You are a research supervisor with one specialist subagent.\nYou are a research assistant.";
  for (const decision of ["APPROVED", "REJECTED"]) {
    const specialist = request(system, "Why is the sky blue?", ["request_human_approval"]);
    assert.match(args(resolveCompletion(specialist)).answer_summary, /Rayleigh/);
    finish(specialist, "request_human_approval", `The user ${decision}.`);
    // Resumed turns must not depend on the tools still being advertised.
    specialist.tools = [];
    const result = resolveCompletion(specialist).content;
    const supervisor = request("You are a research supervisor with one specialist subagent.", "Why is the sky blue?", ["task"]);
    finish(supervisor, "task", result);
    const relayed = resolveCompletion(supervisor).content;
    assert.match(relayed, decision === "APPROVED" ? /Rayleigh/ : /^You rejected my draft answer/);
    if (decision === "REJECTED") assert.doesNotMatch(relayed, /Rayleigh/);
  }
});

test("multimodal guard checks this turn, and unknown requests do not silently succeed", () => {
  const req = request("Analyze images.", "What do you see in this image?");
  assert.throws(() => resolveCompletion(req), /missing an image_url/);
  req.messages.splice(1, 0, { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,aA==" } }] });
  assert.throws(() => resolveCompletion(req), /missing an image_url/);
  assert.throws(() => resolveCompletion(request("Helpful assistant.", "unsupported private prompt")), /No deterministic response/);
  const weather = request("Weather Assistant", "Weather in San Francisco", ["mcp__ag_ui__get_weather"]);
  assert.equal(resolveCompletion(weather).toolCalls[0].name, "mcp__ag_ui__get_weather");
  assert.throws(() => resolveCompletion(finish(weather, "unrelated_tool", "done")), /get_weather/);
  assert.throws(() => resolveCompletion(finish(
    request("Helpful recipe assistant.", "Make a pasta recipe", ["generate_recipe"]),
    "generate_recipe", { error: "backend failed" },
  )), /will not claim success/);
});

test("HTTP health, OpenAI JSON/SSE, chunked arguments, reasoning, and redacted errors", async (t) => {
  const logs = [];
  const server = createMockServer({ port: 0, log: (line) => logs.push(line) });
  const base = await server.start();
  t.after(() => server.stop());
  const post = (body) => fetch(`${base}/v1/chat/completions`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer demo-mock-not-a-secret" },
    body: JSON.stringify(body),
  });
  assert.equal((await (await fetch(`${base}/health`)).json()).status, "ok");
  const plain = await post(request("You are a helpful assistant. Use declared tools when requested.", "What is the capital of France?"));
  const completion = await plain.json();
  assert.equal(completion.object, "chat.completion");
  assert.equal(completion.choices[0].finish_reason, "stop");
  assert.match(completion.choices[0].message.content, /Paris/);
  const toolJSON = await (await post(request("Weather Assistant.", "Weather in San Francisco", ["get_weather"]))).json();
  assert.equal(toolJSON.choices[0].finish_reason, "tool_calls");
  assert.equal(toolJSON.choices[0].message.content, null);
  assert.equal(toolJSON.choices[0].message.tool_calls[0].function.name, "get_weather");
  assert.deepEqual(JSON.parse(toolJSON.choices[0].message.tool_calls[0].function.arguments), { location: "San Francisco" });

  for (const req of [
    request("Assistant for writing documents.", "Give me a story for a dragon called Atlantis in document", ["write_document"]),
    request("Think carefully before you answer.", "What is the best car to buy?"),
  ]) {
    req.stream = true;
    req.stream_options = { include_usage: true };
    const response = await post(req);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    const events = (await response.text()).trim().split("\n\n").map((line) => line.replace(/^data: /, ""));
    assert.equal(events.pop(), "[DONE]");
    const payloads = events.map(JSON.parse);
    assert.ok(payloads.every((item) => item.object === "chat.completion.chunk"));
    const deltas = payloads.flatMap((item) => item.choices).map((choice) => choice.delta);
    if (req.tools.length) {
      const calls = deltas.flatMap((delta) => delta.tool_calls ?? []);
      assert.ok(calls.length > 3);
      assert.equal(calls[0].function.name, "write_document");
      assert.ok(calls[0].id);
      assert.match(JSON.parse(calls.map((call) => call.function.arguments).join("")).document, /Atlantis/);
      assert.equal(payloads.at(-2).choices[0].finish_reason, "tool_calls");
    } else {
      assert.ok(deltas.filter((delta) => delta.reasoning_content).length > 1);
      assert.match(deltas.map((delta) => delta.content ?? "").join(""), /Toyota/);
      assert.equal(payloads.at(-2).choices[0].finish_reason, "stop");
    }
    assert.ok(payloads.at(-1).usage.total_tokens > 0);
  }
  const secretPrompt = "private-secret-must-not-appear-in-diagnostics";
  const failure = await post(request("Helpful assistant.", secretPrompt));
  assert.equal(failure.status, 422);
  const error = await failure.text();
  assert.match(error, /lastUserHash/);
  assert.ok(!error.includes(secretPrompt) && logs.every((line) => !line.includes(secretPrompt)));
  assert.equal((await fetch(`${base}/unknown`)).status, 404);
  assert.equal((await fetch(`${base}/v1/chat/completions`, { method: "POST", body: "{" })).status, 400);
});
