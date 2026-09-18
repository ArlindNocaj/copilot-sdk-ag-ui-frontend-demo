// Minimal extraction, not the cross-framework catch-alls in Dojo's aimock-setup.
// Sources: https://github.com/ag-ui-protocol/ag-ui/tree/8665f1ee1aeb5fe7f873a850b20df9af0c4fbba2/apps/dojo/e2e/fixtures/openai
// https://github.com/ag-ui-protocol/ag-ui/blob/8665f1ee1aeb5fe7f873a850b20df9af0c4fbba2/apps/dojo/e2e/aimock-setup.ts
import { fileURLToPath } from "node:url";
import type { ChatCompletionRequest, FixtureResponse, LLMock } from "@copilotkit/aimock";
import { answer, baseName, currentState, guarded, MockError, turn } from "./helpers.js";
import { registerCopilotSdkSubgraphsFixtures } from "./copilot-sdk-subgraphs-fixtures.js";
import { registerDeepagentsSubagentsFixtures } from "./deepagents-subagents-fixtures.js";

const story = "Once upon a time, in a land far away, there lived a magnificent dragon named Atlantis. Atlantis was known throughout the realm for its shimmering scales that reflected the light of a thousand stars. The dragon Atlantis would soar above the mountains, breathing fire that lit up the night sky. Villagers would gather to watch Atlantis perform its aerial dances, marveling at the grace of this ancient creature.";
const recipe = {
  title: "Pasta Aglio e Olio", skill_level: "Intermediate", special_preferences: [], cooking_time: "45 min",
  ingredients: [
    { icon: "🍝", name: "Pasta", amount: "400g" }, { icon: "🧂", name: "Salt", amount: "1 tsp" },
    { icon: "🫒", name: "Olive Oil", amount: "4 tbsp" }, { icon: "🧄", name: "Garlic", amount: "6 cloves" },
    { icon: "🍅", name: "Tomatoes", amount: "2 cups" },
  ],
  instructions: ["Boil water and cook pasta until al dente", "Slice garlic thinly and sauté in olive oil",
    "Dice tomatoes and add to the pan", "Season with salt to taste", "Toss pasta with the sauce and serve"],
  changes: "Completed the pasta recipe.",
};

function respond(req: ChatCompletionRequest): FixtureResponse {
  if (req.model !== "gpt-4o") throw new MockError("The demo requires model gpt-4o.");
  const { messages, userIndex, user, last, tools, has, call, expectResult, system } = turn(req);
  if (has("get_weather") || /Weather Assistant/i.test(system)) {
    if (last) {
      const result = expectResult("get_weather");
      if (!result.value || typeof result.value.temperature !== "number" || !result.value.conditions) {
        throw new MockError("Weather result is missing temperature/conditions.");
      }
      return answer(`The weather in ${result.args?.location ?? "San Francisco"} is ${result.value.conditions}, ${result.value.temperature}°C.`);
    }
    if (/weather/i.test(user) && /San Francisco/i.test(user)) return call("get_weather", { location: "San Francisco" });
  }
  if (has("schedule_meeting") || /You are a scheduling assistant/i.test(system)) {
    if (last) {
      const result = expectResult("schedule_meeting");
      if (/cancelled|not scheduled/i.test(result.text)) return answer("The meeting was not scheduled. No booking was made.");
      if (/Meeting scheduled for /i.test(result.text)) return answer(result.text);
      throw new MockError("Meeting result must explicitly confirm a schedule or cancellation.");
    }
    if (/schedule|book|call|meeting/i.test(user)) {
      return call("schedule_meeting", { topic: "Intro call about pricing", attendee: "Sales team" });
    }
  }
  if (has("generate_recipe") || /helpful recipe assistant/i.test(system)) {
    if (last) {
      expectResult("generate_recipe");
      return answer("I've completed your pasta recipe with all ingredients and cooking instructions.");
    }
    if (/ingredients/i.test(user)) {
      const ingredients = currentState(messages).recipe?.ingredients;
      if (!Array.isArray(ingredients)) throw new MockError("Ingredient follow-up requires injected shared recipe state.");
      return answer(`Here are the ingredients from your current recipe:\n${ingredients.map((item) => `- ${item.name}: ${item.amount}`).join("\n")}`);
    }
    if (/pasta recipe/i.test(user)) return call("generate_recipe", { recipe });
  }
  if (has("write_document") || /assistant for writing documents/i.test(system)) {
    if (last) {
      const result = expectResult("write_document");
      if (/reject|declin|denied|cancel|not approved/i.test(result.text) || result.value?.approved === false) {
        return answer("You rejected the document changes. Your existing document is unchanged.");
      }
      if (/accept|approv|confirm|writ|written|updat|appl|success|saved|\bdone\b|\bok\b/i.test(result.text)
          || result.value?.approved === true) return answer("The document changes were accepted and applied.");
      throw new MockError("Document result contained no approval/rejection decision.");
    }
    if (/dragon called Atlantis/i.test(user)) return call("write_document", { document: story });
    if (/dragon name to Lola|(?:change|rename|replace|edit).*Lola/i.test(user)) {
      const document = currentState(messages).document;
      if (typeof document !== "string" || !document.includes("Atlantis")) {
        throw new MockError("The Lola edit requires the current Atlantis document.");
      }
      return call("write_document", { document: document.replaceAll("Atlantis", "Lola") });
    }
  }
  if (has("generate_task_steps")) {
    const human = /task planning assistant|human review and approval/i.test(system)
      || tools.some((tool) => baseName(tool.function?.name) === "generate_task_steps"
        && JSON.stringify(tool.function.parameters ?? {}).includes('"enabled"'));
    if (last) {
      const result = expectResult("generate_task_steps");
      if (!human) return answer("I completed all three steps! ✅");
      const steps = result.value?.steps ?? (Array.isArray(result.value) ? result.value : undefined);
      const approved = steps?.filter((step: { status: string }) => !["disabled", "rejected", "skipped"].includes(step.status));
      return answer(approved ? `I performed only your approved steps: ${approved.map((step: { description: string }) => step.description).join("; ")}.`
        : "I performed only the steps you approved; unselected steps were skipped.");
    }
    if (/one step with eggs|brownies|baking|bake|cake/i.test(user)) {
      return call("generate_task_steps", { steps: [
        { description: human ? "Crack eggs into bowl" : "Cracking eggs into a bowl", status: human ? "enabled" : "pending" },
        { description: human ? "Preheat oven to 350F" : "Preheating the oven to 350F", status: human ? "enabled" : "pending" },
        { description: human ? "Mix and bake for 25 min" : "Mixing and baking for 25 minutes", status: human ? "enabled" : "pending" },
      ] });
    }
    if (!human && /Go to Mars/i.test(user)) return call("generate_task_steps", { steps: [
      { description: "Designing a spacecraft", status: "pending" }, { description: "Launching from Earth", status: "pending" },
      { description: "Landing on Mars", status: "pending" },
    ] });
  }
  if (has("generate_haiku")) {
    if (last) {
      expectResult("generate_haiku");
      return answer("I've created a beautiful haiku for you! 🎋");
    }
    if (/haiku|I will always win|moon shines bright/i.test(user)) return call("generate_haiku", {
      japanese: ["月が輝く", "夜空に静かに浮かぶ", "光の詩よ"],
      english: ["The bright moon shining", "Floating quietly in night sky", "A poem of light"],
      image_name: "Cherry_Blossoms_Sakura_Night_View_City_Lights_Japan.jpg",
      gradient: "linear-gradient(135deg, #0c3547 0%, #204f64 50%, #2d6187 100%)",
    });
  }
  if (/(?:describe|see|analyze|what).*(?:image|picture|photo|uploaded)|multimodal.*check/i.test(user)) {
    const parts = messages[userIndex]?.content;
    if (!Array.isArray(parts) || !parts.some((part) => part?.type === "image_url"
        && typeof (part.image_url as { url?: string })?.url === "string" && (part.image_url as { url: string }).url)) {
      throw new MockError("Multimodal request is missing an image_url part in the latest user turn.");
    }
    return answer("multimodal-image-verified: I received your image_url attachment. This deterministic demo verifies image transport, not visual interpretation.");
  }
  throw new MockError("No deterministic response matched this feature, latest user turn, and tool result.");
}

export function registerCopilotFixtures(mock: LLMock, log?: (message: string) => void) {
  // Only the two relevant static fixtures, not Dojo's unrelated integrations.
  mock.loadFixtureFile(fileURLToPath(new URL("./openai.json", import.meta.url)));
  mock.addFixture({ match: { endpoint: "chat" }, response: guarded(respond, log) });
  registerDeepagentsSubagentsFixtures(mock, log);
  registerCopilotSdkSubgraphsFixtures(mock, log);
}
