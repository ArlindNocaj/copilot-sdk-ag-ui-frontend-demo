import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

async function ready(page: Page) { await expect(page.getByTestId("run-status")).toHaveText("Ready"); }
async function capture(page: Page, backend: string, showcase: string, phase: string) {
  await mkdir(`screenshots/rich/${backend}`, { recursive: true });
  await page.screenshot({ path: `screenshots/rich/${backend}/${showcase}-${phase}.png`, fullPage: true });
}
for (const backend of ["typescript", "python"] as const) {
  for (const invalid of ["wrong-workflow", "unknown-target"]) {
    test(`${backend} support-triage: ${invalid} proposal requires an explicit fresh workspace`, async ({ page }) => {
      await page.goto(`/showcases/support-triage?backend=${backend}`);
      await ready(page);
      const thread = await page.getByTestId("workbench").getAttribute("data-thread-id");
      await page.getByRole("textbox", { name: "Message", exact: true }).fill(`Propose a ${invalid} plan for a recovery test`);
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect(page.getByRole("button", { name: "Start new workspace", exact: true })).toBeVisible();
      await expect(page.getByTestId("run-error")).not.toBeEmpty();
      await expect(page.getByTestId("propose")).toBeDisabled();
      await expect(page.getByTestId("committed-work")).toContainText("No actions committed");
      await page.getByRole("button", { name: "Start new workspace", exact: true }).click();
      await ready(page);
      await expect(page.getByTestId("workbench")).not.toHaveAttribute("data-thread-id", thread!);
      await expect(page.getByTestId("propose")).toBeEnabled();
      await expect(page.getByTestId("run-error")).toHaveCount(0);
    });
  }
  test(`${backend} support-triage: lost commit response recovers the exact authoritative receipt`, async ({ page }) => {
    let committed = false;
    await page.route("**/api/workbench?*", async route => {
      if (route.request().postDataJSON()?.op !== "commit") return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      committed = true;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Simulated response loss after commit" }) });
    });
    await page.goto(`/showcases/support-triage?backend=${backend}`);
    await ready(page);
    await page.getByTestId("propose").click();
    await expect(page.getByTestId("proposal-row")).toHaveCount(3);
    await page.getByRole("checkbox", { name: "Approve SUP-BLA-03 assign" }).check();
    await page.getByTestId("commit").click();
    await ready(page);
    expect(committed).toBe(true);
    await expect(page.getByTestId("proposal")).toHaveCount(0);
    await expect(page.getByTestId("committed-work").locator(".work-row")).toHaveCount(1);
    await expect(page.getByTestId("run-error")).toHaveCount(0);
    await page.getByTestId("follow-up").click();
    await expect(page.getByTestId("assistant-message").last()).toContainText("SUP-BLA-03: open");
    await ready(page);
  });
  for (const workflow of ["release", "support"] as const) {
    const showcase = workflow === "release" ? "release-readiness" : "support-triage";
    test(`${backend} ${showcase}: distributions, edited approval and authoritative follow-up`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`/showcases/${showcase}?backend=${backend}`);
      await ready(page);
      const rows = page.getByTestId("chart-data").locator("tbody tr");
      if (workflow === "release") {
        await expect(page.getByTestId("chart-totals")).toContainText("95 failures / 840 attempts");
        await expect(rows.first()).toHaveAttribute("data-group", "Checkout");
        await page.getByTestId("chart-metric").selectOption("failure-rate");
        await expect(rows.first()).toHaveAttribute("data-group", "Payments");
        await page.getByTestId("chart-filter").selectOption("urgent");
        await expect(rows.first()).toHaveAttribute("data-group", "Catalog");
        await expect(page.getByTestId("chart-row-Catalog")).toContainText("18 failures / 60 attempts");
        await expect(page.getByTestId("chart-row-Payments")).toContainText("n<25");
        await page.getByTestId("chart-filter").selectOption("all");
        await page.getByTestId("chart-metric").selectOption("failures");
      } else {
        await expect(page.getByTestId("chart-totals")).toContainText("32 open");
        await expect(page.getByTestId("chart-totals")).toContainText("537 age-hours");
        await expect(page.getByTestId("chart-row-Avery")).toContainText("8 open");
        await expect(page.getByTestId("chart-row-Blair")).toContainText("8 open");
        await page.getByTestId("chart-metric").selectOption("age-distribution");
        await expect(rows.first()).toHaveAttribute("data-group", "Blair");
        await expect(page.getByTestId("chart-row-Blair")).toContainText("mean 34.0 h");
        await expect(page.getByTestId("chart-row-Avery")).toContainText("mean 8.0 h");
        await page.getByTestId("chart-filter").selectOption("urgent");
        await page.getByTestId("chart-metric").selectOption("overdue-tickets");
        await expect(rows.first()).toHaveAttribute("data-group", "Dana");
        await expect(page.getByTestId("chart-row-Dana")).toContainText("4 overdue");
        await page.getByTestId("chart-filter").selectOption("open");
        await page.getByTestId("chart-metric").selectOption("open-tickets");
      }
      await ready(page);
      await capture(page, backend, showcase, "before");
      await page.getByTestId("propose").click();
      await expect(page.getByTestId("proposal")).toBeVisible();
      await expect(page.getByTestId("proposal-row")).toHaveCount(3);
      await expect(page.getByTestId("run-status")).toHaveText("Your review");
      await expect(page.getByTestId("committed-work")).toContainText("No actions committed");
      await expect(page.getByTestId("chart-metric")).toHaveValue(workflow === "release" ? "failure-rate" : "age-distribution");
      await expect(page.getByTestId("chart-filter")).toHaveValue(workflow === "release" ? "urgent" : "open");
      const targets = workflow === "release" ? ["REL-CAT-01", "REL-CAT-02", "REL-PAY-01"] : ["SUP-BLA-03", "SUP-BLA-04", "SUP-DAN-04"];
      const kind = workflow === "release" ? "task" : "assign";
      await page.getByRole("checkbox", { name: `Approve ${targets[0]} ${kind}` }).check();
      await page.getByRole("checkbox", { name: `Approve ${targets[1]} ${kind}` }).check();
      await page.getByRole("combobox", { name: `Owner ${targets[0]} ${kind}` }).selectOption("Dana");
      await page.getByRole("textbox", { name: `Task title ${targets[0]} ${kind}` }).fill("Edited investigation with explicit approval");
      if (workflow === "support") {
        await page.getByTestId("draft-editor").fill("Saved locally. Next update tomorrow. No fix or message has been sent.");
        await page.getByTestId("save-draft").check();
      }
      await expect(page.getByTestId("decision-summary")).toContainText("2 approve");
      await expect(page.getByTestId("decision-summary")).toContainText("1 reject");
      await capture(page, backend, showcase, "review");
      await page.getByTestId("commit").click();
      await ready(page);
      await expect(page.getByTestId("proposal")).toHaveCount(0);
      await expect(page.getByTestId("committed-work")).toContainText("Edited investigation with explicit approval");
      await expect(page.getByTestId("committed-work").locator(".work-row")).toHaveCount(2);
      await expect(page.getByTestId("committed-work")).not.toContainText(targets[2]);
      await expect(page.getByTestId("receipt")).toContainText('"rejected"');
      if (workflow === "support") {
        await expect(page.getByTestId("item-SUP-BLA-03")).toContainText("Dana");
        await expect(page.getByTestId("chart-totals")).toContainText("32 open");
        await expect(page.getByTestId("chart-totals")).toContainText("537 age-hours");
        await expect(page.getByTestId("chart-totals")).toContainText("10 fictional SLA breaches");
        await expect(page.getByTestId("saved-draft")).toHaveText("Saved locally. Next update tomorrow. No fix or message has been sent.");
      }
      await page.getByTestId(`complete-${targets[0]}`).click();
      await ready(page);
      if (workflow === "release") {
        await page.getByTestId("chart-filter").selectOption("all");
        await expect(page.getByTestId("chart-totals")).toContainText("95 failures / 840 attempts");
      } else {
        await expect(page.getByTestId("chart-totals")).toContainText("31 open");
        await expect(page.getByTestId("chart-totals")).toContainText("501 age-hours");
        await expect(page.getByTestId("chart-totals")).toContainText("9 fictional SLA breaches");
      }
      await ready(page);
      await page.getByTestId("follow-up").click();
      await expect(page.getByTestId("assistant-message").last()).toContainText(targets[0]);
      await expect(page.getByTestId("assistant-message").last()).toContainText(/done|complete|resolved/i);
      await ready(page);
      await capture(page, backend, showcase, "after");
      expect(errors).toEqual([]);
      await expect(page.getByTestId("run-error")).toHaveCount(0);
    });
  }
}
