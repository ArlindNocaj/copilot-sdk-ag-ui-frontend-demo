// Adapted from https://github.com/ag-ui-protocol/ag-ui/blob/8665f1ee1aeb5fe7f873a850b20df9af0c4fbba2/apps/dojo/e2e/copilot-sdk-subgraphs-fixtures.ts
// Keep native task calls; current-turn tool correlation avoids stale continuations.
import type { ChatCompletionRequest, FixtureResponse, LLMock } from "@copilotkit/aimock";
import { answer, guarded, MockError, systemText, turn } from "./helpers.js";

function respond(req: ChatCompletionRequest): FixtureResponse {
  const { system, user, last, results, call, expectResult } = turn(req);
  const specialist = system.match(/Copilot SDK travel specialist: (flights|hotels|experiences)\./)?.[1];
  if (!specialist) {
    if (!/travel|trip|itinerary|Amsterdam|San Francisco/i.test(user)) throw new MockError("Unsupported travel prompt.");
    if (results.some((result) => result.name !== "task")) throw new MockError("Travel supervisor expected native task results.");
    const agent = ["flights", "hotels", "experiences"][results.length];
    return agent ? call("task", {
      agent_type: `${agent}_agent`, name: agent, description: `Plan ${agent}`,
      prompt: `Plan ${agent} for the Amsterdam to San Francisco demo.`, mode: "sync",
    }) : answer("Your demo itinerary is ready: your chosen flight, hotel, and four experiences. Nothing has been booked.");
  }
  if (!last) return call("travel_state", { agent: specialist });
  const value = last.value;
  if (!value || value.agent !== specialist) throw new MockError("Travel tool returned an invalid specialist result.");
  if (last.name === "choose_travel_option" && typeof value.selection === "string") {
    return call("travel_state", { agent: specialist, selection: value.selection });
  }
  expectResult("travel_state");
  if (value.saved === true && typeof value.selection === "string") return answer(`Selected ${value.selection}.`);
  if (specialist === "experiences" && Array.isArray(value.experiences)) {
    return answer(`Enjoy ${value.experiences.map((option: { name: string }) => option.name).join(", ")}. Nothing has been booked.`);
  }
  if (["flights", "hotels"].includes(specialist) && Array.isArray(value.options) && value.recommendation && value.message) {
    return call("choose_travel_option", value);
  }
  throw new MockError("Travel search/selection result did not match the demo contract.");
}

export function registerCopilotSdkSubgraphsFixtures(mock: LLMock, log?: (message: string) => void) {
  mock.prependFixture({
    match: { model: "gpt-4o", endpoint: "chat",
      predicate: (req) => /Copilot SDK travel (supervisor|specialist:)/.test(systemText(req)) },
    response: guarded(respond, log),
  });
}
