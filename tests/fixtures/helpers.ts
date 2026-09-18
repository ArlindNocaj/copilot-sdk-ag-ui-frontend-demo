import { createHash } from "node:crypto";
import type { ChatCompletionRequest, ChatMessage, FixtureResponse, ToolCallResponse } from "@copilotkit/aimock";

export const textOf = (content: ChatMessage["content"] | undefined): string =>
  typeof content === "string" ? content : Array.isArray(content)
    ? content.map((part) => part?.type === "text" && typeof part.text === "string" ? part.text : "").join("\n") : "";
export const systemText = (req: ChatCompletionRequest): string =>
  req.messages.filter((message) => ["system", "developer"].includes(message.role))
    .map((message) => textOf(message.content)).join("\n");
export const baseName = (name = ""): string => name.split("__").at(-1)!;
export const answer = (content: string) => ({ content });

export class MockError extends Error {
  constructor(message: string, public status = 422) { super(message); }
}

export function parseJSON(text: string | undefined): any {
  try { return JSON.parse(text!); } catch { return undefined; }
}

// State is injected into the model's messages by the real AG-UI adapter.
function jsonObjects(text: string): any[] {
  const values = [];
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (start < 0) {
      if (char === "{") { start = i; depth = 1; }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      const value = parseJSON(text.slice(start, i + 1));
      if (value) values.push(value);
      start = -1;
    }
  }
  return values;
}

export function currentState(messages: ChatMessage[]): any {
  for (const message of messages.toReversed()) {
    if (!["system", "developer", "user"].includes(message.role)) continue;
    for (const value of jsonObjects(textOf(message.content)).toReversed()) {
      const state = value.state ?? value;
      if (state && typeof state === "object" && ("recipe" in state || "document" in state || "workflow" in state)) return state;
    }
  }
  return {};
}

export function turn(req: ChatCompletionRequest) {
  const messages = req.messages;
  const userIndex = messages.findLastIndex((message) => message.role === "user");
  // Match intent, not field names and old prose inside the adapter's state preamble.
  const user = textOf(messages[userIndex]?.content).replace(/## Current shared state\n```json\n[\s\S]*?\n```\s*/, "");
  const calls = new Map<string, { name: string; args: any }>();
  const allResults = [];
  for (const [index, message] of messages.entries()) {
    for (const call of message.tool_calls ?? []) {
      calls.set(call.id, { name: baseName(call.function?.name), args: parseJSON(call.function?.arguments) });
    }
    if (message.role !== "tool") continue;
    const call = calls.get(message.tool_call_id!);
    const text = textOf(message.content);
    allResults.push({ index, name: call?.name ?? baseName(message.name), args: call?.args, text, value: parseJSON(text) });
  }
  const results = allResults.filter((result) => result.index > userIndex);
  const last = results.at(-1);
  if (last && (/^Error\b/i.test(last.text) || last.value?.error || last.value?.is_error === true || last.value?.success === false)) {
    throw new MockError("The latest tool returned an error; the model will not claim success.");
  }
  const tools = req.tools ?? [];
  const has = (name: string) => tools.some((tool) => baseName(tool.function?.name) === name);
  const call = (name: string, args: object): ToolCallResponse => {
    const offered = tools.filter((tool) => baseName(tool.function?.name) === name);
    if (offered.length !== 1) throw new MockError(`Expected exactly one advertised ${name} tool.`);
    return { toolCalls: [{ name: offered[0].function.name, arguments: JSON.stringify(args) }] };
  };
  const expectResult = (name: string) => {
    if (!last || last.name !== name) throw new MockError(`Expected the latest result to belong to ${name}.`);
    return last;
  };
  return { messages, userIndex, user, results, allResults, last, tools, has, call, expectResult, system: systemText(req) };
}

export function diagnostic(req: ChatCompletionRequest) {
  const messages = Array.isArray(req?.messages) ? req.messages : [];
  const text = textOf(messages.findLast((message) => message?.role === "user")?.content);
  return {
    model: req?.model === "gpt-4o" ? "gpt-4o" : "(unsupported)",
    messageCount: messages.length,
    lastUserCharacters: text.length,
    lastUserHash: createHash("sha256").update(text).digest("hex").slice(0, 12),
    imageParts: messages.reduce((count, message) => count + (Array.isArray(message?.content)
      ? message.content.filter((part) => part?.type === "image_url" && (part.image_url as { url?: string })?.url).length : 0), 0),
    tools: Array.isArray(req?.tools) ? req.tools.map((tool) => tool?.function?.name)
      .filter((name) => typeof name === "string").map((name) => name.slice(0, 80)).slice(0, 60) : [],
  };
}

export function guarded(
  resolve: (req: ChatCompletionRequest) => FixtureResponse,
  log: (message: string) => void = console.error,
) {
  return (req: ChatCompletionRequest): FixtureResponse => {
    try { return resolve(req); } catch (error) {
      const message = error instanceof MockError ? error.message : "Unexpected fixture implementation error.";
      const detail = `${message} Diagnostic: ${JSON.stringify(diagnostic(req))}`;
      log(`[mock-model] ${detail}`);
      return { status: error instanceof MockError ? error.status : 500,
        error: { message: detail, type: "mock_request_error", code: "unsupported_demo_request" } };
    }
  };
}
