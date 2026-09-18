import { z } from "zod";
import { owners } from "../../../../shared/domain.js";
import shared from "../../../../shared/contracts.json" with { type: "json" };
export const workflowSchema = z.enum(["release", "support"]);
const releaseView = z.object({ chart: z.enum(["bars", "table"]), metric: z.enum(["failures", "failure-rate"]), group: z.enum(["product", "priority"]), filter: z.enum(["all", "urgent", "open"]) }).strict();
const supportView = z.object({ chart: z.enum(["bars", "table"]), metric: z.enum(["open-tickets", "age-distribution", "overdue-tickets"]), group: z.enum(["owner", "priority"]), filter: z.enum(["urgent", "open"]) }).strict();
export const viewSchema = z.union([releaseView, supportView]);
const id = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_:.-]+$/);
const title = z.string().trim().min(1).max(180);
const planFields = {
  rationale: z.string().min(1).max(700),
  actions: z.array(z.object({ id, target: id, kind: z.enum(["task", "assign", "follow-up", "escalate"]), title, owner: z.enum(owners) }).strict()).min(1).max(6),
  draft: z.string().max(2000),
};
export const planSchema = z.union([releaseView.extend(planFields).strict(), supportView.extend(planFields).strict()]);
// Top-level fields make required/length constraints visible to model tool consumers; anyOf still enforces valid combinations.
export const planJsonSchema = shared.plan;
export const planTool = shared.tool;
const base = { threadId: id };
export const commandSchema = z.discriminatedUnion("op", [
  z.object({ ...base, op: z.literal("init"), workflow: workflowSchema }).strict(),
  z.object({ ...base, op: z.literal("read") }).strict(),
  z.object({ ...base, op: z.literal("stage"), toolCallId: id, plan: planSchema }).strict(),
  z.object({ ...base, op: z.literal("view"), expectedRevision: z.number().int().nonnegative(), view: viewSchema }).strict(),
  z.object({ ...base, op: z.literal("complete"), expectedRevision: z.number().int().nonnegative(), target: id }).strict(),
  z.object({ ...base, op: z.literal("commit"), submissionId: z.string().uuid(), proposalId: id,
    expectedRevision: z.number().int().nonnegative(), saveDraft: z.boolean(), draft: z.string().max(2000),
    decisions: z.array(z.object({ actionId: id, accept: z.boolean(), title, owner: z.enum(owners) }).strict()).min(1).max(6),
  }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;
