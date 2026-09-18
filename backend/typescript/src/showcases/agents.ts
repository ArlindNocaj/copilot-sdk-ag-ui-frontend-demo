import { readFileSync } from "node:fs";
import type { BaseEvent, RunAgentInput } from "@ag-ui/core";
import { EventType } from "@ag-ui/core";
import type { CopilotClientPort } from "../ag_ui_copilot_sdk/index.js";
import { defineAgent } from "../agents/base.js";
import { Conflict } from "../../../../shared/domain.js";
import { planTool } from "./contracts.js";
import type { Store } from "./store.js";

const instructions = readFileSync(new URL("../../../../shared/instructions.txt", import.meta.url), "utf8");
export function showcaseAgents(client: CopilotClientPort) {
  return Object.fromEntries(["release_readiness", "support_triage"].map(agentId => [agentId,
    defineAgent(client, { agentId, description: "Fictional decision workbench with authoritative state and explicit approvals", instructions })]));
}
export function isShowcase(feature: string) { return feature === "release_readiness" || feature === "support_triage"; }
export function prepareShowcaseRun(store: Store, feature: string, input: RunAgentInput) {
  const state = store.prompt(input.threadId);
  if (state.workflow !== (feature === "release_readiness" ? "release" : "support")) throw new Conflict("WORKFLOW_MISMATCH", "This thread belongs to another showcase.", 400);
  if (input.tools.length !== 1 || input.tools[0]?.name !== "review_plan" || input.context.length || Object.keys(input.forwardedProps ?? {}).length) {
    throw new Conflict("INVALID_RUN", "Showcases accept only the review_plan tool and authoritative app state.", 400);
  }
  for (const message of input.messages) {
    if (!["user", "assistant", "tool", "activity"].includes(message.role)) throw new Conflict("INVALID_ROLE", "Unsupported message role.", 400);
    if (message.role === "tool") store.verifyToolResult(input.threadId, message.toolCallId, message.content);
    if (message.role === "user" && typeof message.content !== "string") throw new Conflict("TEXT_ONLY", "Showcases accept fictional text only.", 400);
  }
  input.tools = [planTool];
  input.state = state;
  const pending = new Map<string, { name: string; args: string }>();
  return (event: BaseEvent) => {
    if (event.type === EventType.TOOL_CALL_START) {
      const start = event as { toolCallId: string; toolCallName: string } & BaseEvent;
      pending.set(start.toolCallId, { name: start.toolCallName, args: "" });
    } else if (event.type === EventType.TOOL_CALL_ARGS) {
      const args = event as { toolCallId: string; delta: string } & BaseEvent;
      const call = pending.get(args.toolCallId);
      if (call) call.args += args.delta;
    } else if (event.type === EventType.TOOL_CALL_END) {
      const end = event as { toolCallId: string } & BaseEvent;
      const call = pending.get(end.toolCallId);
      if (call?.name === "review_plan") store.issuedTool(input.threadId, end.toolCallId, JSON.parse(call.args));
    }
  };
}
