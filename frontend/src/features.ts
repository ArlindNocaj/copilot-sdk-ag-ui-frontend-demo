export const features = {
  agentic_chat: ["Agentic chat", "Stream a response through the real Copilot SDK.", "What is the capital of France?"],
  backend_tool_rendering: ["Backend tool rendering", "A server-side weather tool becomes a typed card.", "What's the weather like in San Francisco?"],
  human_in_the_loop: ["Human in the loop", "Edit a proposed plan before resolving the pending tool.", "Give me a plan to make brownies with one step with eggs and one step with oven."],
  tool_based_generative_ui: ["Tool-based generative UI", "A frontend tool renders a haiku instead of plain text.", 'Generate Haiku for "The moon shines bright"'],
  shared_state: ["Shared state", "Edit recipe state in either the UI or the agent.", 'Please give me a pasta recipe with an ingredient called "Pasta".'],
  agentic_generative_ui: ["Agentic generative UI", "Watch predicted steps become committed progress.", "Give me a plan to make brownies in 3 steps."],
  predictive_state_updates: ["Predictive state updates", "Preview a streamed document, then accept or reject.", "Give me a story for a dragon called Atlantis in document"],
  agentic_chat_reasoning: ["Reasoning events", "Render model-provided reasoning separately from the reply.", "What is the best car to buy?"],
  agentic_chat_multimodal: ["Multimodal chat", "Upload an inline image through AG-UI to SDK attachments.", "Tell me what do you see in this image"],
  interrupt: ["Interrupt and resume", "A pending tool waits for a time selection or cancellation.", "Book an intro call with the sales team to discuss pricing."],
  subgraphs: ["Travel subgraphs", "Native specialists hand off flight and hotel choices.", "Help me plan a trip to San Francisco"],
  deepagents_subagents: ["Subagent approval", "A native research subagent pauses for your decision.", "Why is the sky blue?"],
} as const;
export type Feature = keyof typeof features;
export type Backend = "typescript" | "python";
export function isFeature(value: string): value is Feature { return Object.hasOwn(features, value); }
export function isAgent(value: string) { return isFeature(value) || value === "release_readiness" || value === "support_triage"; }
export function isBackend(value: string): value is Backend { return value === "python" || value === "typescript"; }
