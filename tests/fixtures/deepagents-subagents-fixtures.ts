// Adapted from https://github.com/ag-ui-protocol/ag-ui/blob/8665f1ee1aeb5fe7f873a850b20df9af0c4fbba2/apps/dojo/e2e/deepagents-subagents-fixtures.ts
// Copilot-only native task schema; rejection must also survive supervisor relay.
import type { ChatCompletionRequest, FixtureResponse, LLMock } from "@copilotkit/aimock";
import { answer, guarded, MockError, systemText, turn } from "./helpers.js";

export const SUBAGENT_DRAFT_SUMMARY = "The sky appears blue because of Rayleigh scattering.";
export const SUBAGENT_FINAL_ANSWER = "The sky appears blue because of Rayleigh scattering: shorter blue wavelengths of sunlight scatter more than other colors.";
export const SUBAGENT_REJECTED_REPLY = "You rejected my draft answer. Would you like me to revise it?";

function respond(req: ChatCompletionRequest): FixtureResponse {
  const { system, user, last, call, expectResult } = turn(req);
  // A native subagent may inherit supervisor context: its own prompt wins.
  if (/You are a research assistant/i.test(system)) {
    if (last) {
      expectResult("request_human_approval");
      if (/REJECTED|not approved|denied/i.test(last.text)) return answer(SUBAGENT_REJECTED_REPLY);
      if (/APPROVED/i.test(last.text)) return answer(SUBAGENT_FINAL_ANSWER);
      throw new MockError("Research approval result contained no approved/rejected decision.");
    }
    if (!/sky.*blue/i.test(user)) throw new MockError("Unsupported research question; use the sky-blue demo.");
    return call("request_human_approval", { answer_summary: SUBAGENT_DRAFT_SUMMARY });
  }
  if (last) {
    expectResult("task");
    if (/You rejected my draft answer|REJECTED/i.test(last.text)) return answer(SUBAGENT_REJECTED_REPLY);
    if (/Rayleigh scattering/i.test(last.text)) return answer(`The research assistant reports: ${SUBAGENT_FINAL_ANSWER}`);
    throw new MockError("Research task returned no recognized specialist answer.");
  }
  if (!/sky.*blue/i.test(user)) throw new MockError("Unsupported research question; use the sky-blue demo.");
  return call("task", {
    agent_type: "research_assistant", name: "research", description: user, prompt: user, mode: "sync",
  });
}

export function registerDeepagentsSubagentsFixtures(mock: LLMock, log?: (message: string) => void) {
  mock.prependFixture({
    match: { model: "gpt-4o", endpoint: "chat",
      predicate: (req) => /research supervisor with one specialist subagent|You are a research assistant/i.test(systemText(req)) },
    response: guarded(respond, log),
  });
}
