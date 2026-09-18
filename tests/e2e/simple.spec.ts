import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { features, type Feature } from "../../frontend/src/features";

async function prompt(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Message", exact: true }).fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
}
async function ready(page: Page) { await expect(page.getByTestId("run-status")).toHaveText("Ready"); }
async function snapshot(page: Page, backend: string, feature: string) {
  await mkdir(`screenshots/simple/${backend}`, { recursive: true });
  await page.screenshot({ path: `screenshots/simple/${backend}/${feature}.png`, fullPage: true });
}
for (const backend of ["typescript", "python"] as const) {
  test.describe(backend, () => {
    test.beforeEach(async ({ request }) => {
      const response = await request.get(`http://127.0.0.1:${backend === "python" ? 8227 : 8228}/health`);
      expect(response.ok()).toBe(true);
      expect(await response.json()).toMatchObject({ app: "copilot-sdk-ag-ui-frontend-demo", backend });
    });
    for (const feature of Object.keys(features) as Feature[]) {
      test(`${feature}: contract happy path`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(`/features/${feature}?backend=${backend}`);
        await expect(page.getByRole("heading", { level: 1, name: features[feature][0], exact: true })).toBeVisible();
        await ready(page);
        if (feature === "agentic_chat_multimodal") {
          // A real inline attachment crosses CopilotKit -> AG-UI -> SDK -> model.
          await page.getByLabel("Image", { exact: true }).setInputFiles({
            name: "pixel.png", mimeType: "image/png",
            buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1sAAAAASUVORK5CYII=", "base64"),
          });
        }
        await page.getByTestId("example").click();
        const conversation = page.getByRole("region", { name: "Agent conversation" });
        if (feature === "agentic_chat") await expect(conversation).toContainText("Paris");
        if (feature === "backend_tool_rendering") {
          await expect(page.getByTestId("weather")).toContainText("20");
          await expect(page.getByTestId("weather")).toContainText("50%");
        }
        if (feature === "human_in_the_loop") {
          const plan = page.getByTestId("plan").last();
          await expect(plan).toBeVisible();
          await plan.getByRole("checkbox").first().uncheck();
          await plan.getByRole("button", { name: "Perform selected steps" }).click();
          await ready(page);
          await expect(page.getByTestId("events")).toContainText("TOOL_CALL_RESULT");
        }
        if (feature === "tool_based_generative_ui") await expect(page.getByTestId("haiku")).not.toBeEmpty();
        if (feature === "shared_state") {
          await expect(page.getByRole("textbox", { name: "Ingredient 1", exact: true })).toHaveValue(/Pasta/i);
          await ready(page);
          await page.getByRole("button", { name: "Add potatoes" }).click();
          await prompt(page, "Give me all the ingredients");
          await expect(conversation).toContainText("Potatoes");
        }
        if (feature === "agentic_generative_ui") await expect(page.getByTestId("steps")).toContainText("3/3 Complete");
        if (feature === "predictive_state_updates") {
          await expect(page.getByTestId("document-preview")).toContainText("Atlantis");
          await page.getByRole("button", { name: "Accept changes", exact: true }).last().click();
          await expect(page.getByTestId("document")).toContainText("Atlantis");
        }
        if (feature === "agentic_chat_reasoning") {
          await expect(conversation).toContainText(/Toyota|Honda|Mazda/);
          await expect(page.getByTestId("events")).toContainText("REASONING_MESSAGE_CONTENT");
        }
        if (feature === "agentic_chat_multimodal") await expect(conversation).toContainText(/image|visual|pixel/i);
        if (feature === "interrupt") {
          await expect(page.getByTestId("interrupt")).toContainText(/pricing/i);
          await page.getByRole("button", { name: "Tomorrow at 10:00" }).click();
          await expect(conversation).toContainText("Tomorrow at 10:00");
        }
        if (feature === "subgraphs") {
          await page.getByRole("button", { name: /KLM/ }).click();
          await page.getByRole("button", { name: /Hotel Zoe/ }).click();
          await expect(page.getByTestId("itinerary")).toContainText("Hotel Zoe");
          await expect(page.getByTestId("itinerary")).toContainText("KLM");
          await expect(page.getByTestId("itinerary")).toContainText("Tartine Bakery");
          await expect(page.getByTestId("subagent")).toHaveCount(3);
        }
        if (feature === "deepagents_subagents") {
          await expect(page.getByTestId("subagent")).toHaveCount(1);
          await page.getByRole("button", { name: "Approve answer" }).click();
          await expect(conversation).toContainText(/Rayleigh|scatter/i);
          await expect(page.getByTestId("subagent")).toContainText("success");
        }
        await ready(page);
        await expect(page.getByTestId("events")).toContainText("RUN_FINISHED");
        expect(errors).toEqual([]);
        await snapshot(page, backend, feature);
      });
    }
    test("interrupt cancellation", async ({ page }) => {
      await page.goto(`/features/interrupt?backend=${backend}`);
      await ready(page);
      await page.getByTestId("example").click();
      await page.getByRole("button", { name: "Cancel meeting" }).click();
      await expect(page.getByRole("region", { name: "Agent conversation" })).toContainText(/cancel|not scheduled/i);
      await ready(page);
    });
    test("subagent rejection", async ({ page }) => {
      await page.goto(`/features/deepagents_subagents?backend=${backend}`);
      await ready(page);
      await page.getByTestId("example").click();
      await page.getByRole("button", { name: "Reject answer" }).click();
      await expect(page.getByRole("region", { name: "Agent conversation" })).toContainText(/rejected my draft answer/i);
      await ready(page);
    });
    test("document rejection preserves accepted state", async ({ page }) => {
      await page.goto(`/features/predictive_state_updates?backend=${backend}`);
      await ready(page);
      await page.getByTestId("example").click();
      await page.getByRole("button", { name: "Accept changes", exact: true }).last().click();
      await ready(page);
      await prompt(page, "Change dragon name to Lola");
      await expect(page.getByTestId("document-preview")).toContainText("Lola");
      await page.getByRole("button", { name: "Reject changes", exact: true }).last().click();
      await ready(page);
      await expect(page.getByTestId("document")).toContainText("Atlantis");
      await expect(page.getByTestId("document-preview")).toContainText("Atlantis");
      await expect(page.getByTestId("document")).not.toContainText("Lola");
    });
    test("alternative travel selections", async ({ page }) => {
      await page.goto(`/features/subgraphs?backend=${backend}`);
      await ready(page);
      await page.getByTestId("example").click();
      await page.getByRole("button", { name: /United/ }).click();
      await page.getByRole("button", { name: /The Ritz-Carlton/ }).click();
      await expect(page.getByTestId("itinerary")).toContainText("The Ritz-Carlton");
      await expect(page.getByTestId("itinerary")).toContainText("United");
      await expect(page.getByTestId("itinerary")).toContainText("Tartine Bakery");
      await ready(page);
    });
  });
}
