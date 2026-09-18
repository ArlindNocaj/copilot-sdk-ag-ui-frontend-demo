import type { CopilotClientPort } from "../ag_ui_copilot_sdk/index.js";
import { defineAgent } from "./base.js";

/** Reasoning deltas from the runtime stream as AG-UI REASONING_* events. */
export const createAgenticChatReasoningAgent = (client: CopilotClientPort) =>
  defineAgent(client, {
    agentId: "agentic_chat_reasoning",
    description: "Agentic chat that surfaces the model's reasoning",
    instructions: "You are a helpful assistant. Think carefully before you answer.",
    sessionConfig: { reasoningEffort: "medium" },
  });
