import fixtures from "./fixtures.json" with { type: "json" };
export type Workflow = "release" | "support";
export const owners = ["Avery", "Blair", "Casey", "Dana"] as const;
export type Owner = typeof owners[number];
export type Metric = "failures" | "failure-rate" | "open-tickets" | "age-distribution" | "overdue-tickets";
export type View = { chart: "bars" | "table"; metric: Metric; group: "product" | "priority" | "owner"; filter: "all" | "urgent" | "open" };
export type Item = { id: string; title: string; product: string; priority: "P1" | "P2" | "P3"; owner: Owner; ageHours?: number; buildAttempts?: number; failedBuilds?: number; status: "open" | "done" };
export type Action = { id: string; target: string; kind: "task" | "assign" | "follow-up" | "escalate"; title: string; owner: Owner };
export type Plan = View & { rationale: string; actions: Action[]; draft: string };
export type Proposal = Plan & { id: string; toolCallId: string; basedOn: number };
export type Work = Action & { status: "open" | "done" };
export type Receipt = { nonce: string; proposalId: string; revision: number; accepted: { id: string; title: string; owner: Owner }[]; rejected: string[]; draftSaved: boolean; view: View };
export type State = {
  workflow: Workflow; revision: number; view: View; items: Item[]; work: Work[];
  proposal: Proposal | null; draft: string; receipts: Receipt[]; audit: string[];
};
export class Conflict extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}
export const measurement = fixtures.metadata;
export const ageBucketLabels = ["0–<8 h", "8–<24 h", "24–<72 h", "72+ h"];
export const metricLabels: Record<Metric, string> = { failures: "Failures", "failure-rate": "Failure rate", "open-tickets": "Open tickets", "age-distribution": "Age distribution", "overdue-tickets": "Overdue tickets" };
export function validView(workflow: Workflow, view: View) {
  return ["bars", "table"].includes(view.chart) && (workflow === "release"
    ? ["failures", "failure-rate"].includes(view.metric) && ["product", "priority"].includes(view.group) && ["all", "open", "urgent"].includes(view.filter)
    : ["open-tickets", "age-distribution", "overdue-tickets"].includes(view.metric) && ["owner", "priority"].includes(view.group) && ["open", "urgent"].includes(view.filter));
}
export function assertView(workflow: Workflow, view: View) {
  if (!validView(workflow, view)) throw new Conflict("INVALID_VIEW", "Choose a metric, group and scope supported by this workflow.", 400);
}
export function isOverdue(item: Item) {
  return item.status === "open" && (item.ageHours ?? 0) > measurement.slaHours[item.priority];
}
export function ageBucket(hours: number) { return hours < 8 ? 0 : hours < 24 ? 1 : hours < 72 ? 2 : 3; }
export function initialState(workflow: Workflow): State {
  const items = structuredClone(fixtures[workflow]) as Item[];
  const view: View = workflow === "release" ? { chart: "bars", metric: "failures", group: "product", filter: "all" }
    : { chart: "bars", metric: "open-tickets", group: "owner", filter: "open" };
  return { workflow, revision: 0, view, items, work: [], proposal: null, draft: "", receipts: [], audit: ["Fictional workspace initialized."] };
}
export function visibleItems(state: State) {
  assertView(state.workflow, state.view);
  return state.items.filter(item => state.workflow === "support" && item.status !== "open" ? false
    : state.view.filter === "urgent" ? item.priority === "P1" && item.status === "open"
      : state.view.filter === "open" ? item.status === "open" : true);
}
export function aggregate(state: State) {
  assertView(state.workflow, state.view);
  const labels = state.view.group === "owner" ? [...owners] : state.view.group === "priority" ? ["P1", "P2", "P3"] : ["Catalog", "Checkout", "Identity", "Payments"];
  const groups = new Map(labels.map(label => [label, { label, count: 0, failures: 0, attempts: 0, ageHoursSum: 0, overdue: 0, ageBuckets: [0, 0, 0, 0], smallSample: false }]));
  for (const item of visibleItems(state)) {
    const label = item[state.view.group];
    const row = groups.get(label)!;
    row.count++;
    if (state.workflow === "release") { row.failures += item.failedBuilds!; row.attempts += item.buildAttempts!; }
    else { row.ageHoursSum += item.ageHours!; row.overdue += Number(isOverdue(item)); row.ageBuckets[ageBucket(item.ageHours!)]++; }
  }
  const rows = [...groups.values()];
  for (const row of rows) row.smallSample = state.workflow === "release" && row.attempts > 0 && row.attempts < measurement.smallSampleAttempts;
  return rows.sort((a, b) => {
    const difference = state.view.metric === "failure-rate" ? (Number(b.attempts > 0) - Number(a.attempts > 0) || b.failures * a.attempts - a.failures * b.attempts)
      : state.view.metric === "age-distribution" ? (Number(b.count > 0) - Number(a.count > 0) || b.ageHoursSum * a.count - a.ageHoursSum * b.count)
        : state.view.metric === "failures" ? b.failures - a.failures : state.view.metric === "overdue-tickets" ? b.overdue - a.overdue : b.count - a.count;
    return difference || a.label.localeCompare(b.label);
  });
}
export function chartTotals(rows: ReturnType<typeof aggregate>) {
  return rows.reduce((sum, row) => ({
    count: sum.count + row.count, failures: sum.failures + row.failures, attempts: sum.attempts + row.attempts,
    ageHoursSum: sum.ageHoursSum + row.ageHoursSum, overdue: sum.overdue + row.overdue,
  }), { count: 0, failures: 0, attempts: 0, ageHoursSum: 0, overdue: 0 });
}
export function expectRevision(state: State, expected: number) {
  if (state.revision !== expected) throw new Conflict("STALE_REVISION", `Workspace changed to revision ${state.revision}. Refresh and review again; nothing was applied.`);
}
export function stage(state: State, plan: Plan, toolCallId: string, id: string): State {
  assertView(state.workflow, plan);
  if (state.proposal) throw new Conflict("PENDING_REVIEW", "Complete the current review before proposing more work.");
  if (new Set(plan.actions.map(action => action.id)).size !== plan.actions.length) throw new Conflict("INVALID_PLAN", "Proposal action IDs must be unique.", 400);
  for (const action of plan.actions) {
    if (!state.items.some(item => item.id === action.target && item.status === "open")) throw new Conflict("INVALID_PLAN", "Proposal must reference an open fictional item.", 400);
    if (state.workflow === "release" && action.kind !== "task") throw new Conflict("INVALID_PLAN", "Release proposals only create tasks.", 400);
    if (state.workflow === "support" && action.kind === "task") throw new Conflict("INVALID_PLAN", "Support proposals use assignments, follow-ups or escalations.", 400);
  }
  const revision = state.revision + 1;
  return { ...state, revision, view: { chart: plan.chart, metric: plan.metric, group: plan.group, filter: plan.filter },
    proposal: { ...plan, id, toolCallId, basedOn: revision }, audit: [...state.audit, `Agent proposed ${plan.actions.length} actions; review required.`] };
}
export type Decision = { actionId: string; accept: boolean; title: string; owner: Owner };
export function commit(state: State, proposalId: string, expectedRevision: number, decisions: Decision[], draft: string, saveDraft: boolean, nonce: string) {
  expectRevision(state, expectedRevision);
  const proposal = state.proposal;
  if (!proposal || proposal.id !== proposalId) throw new Conflict("NO_PENDING_PROPOSAL", "This proposal has already been decided or is no longer current.");
  if (new Set(decisions.map(d => d.actionId)).size !== decisions.length ||
      decisions.length !== proposal.actions.length || decisions.some(d => !proposal.actions.some(a => a.id === d.actionId))) {
    throw new Conflict("INVALID_DECISIONS", "Each proposal needs exactly one explicit decision.", 400);
  }
  const accepted = proposal.actions.filter(a => decisions.find(d => d.actionId === a.id)!.accept).map(action => {
    const edit = decisions.find(d => d.actionId === action.id)!;
    return { ...action, id: `${proposal.id}:${action.id}`, title: edit.title, owner: edit.owner, status: "open" as const };
  });
  const receipt: Receipt = { nonce, proposalId, revision: state.revision + 1,
    accepted: accepted.map(({ id, title, owner }) => ({ id, title, owner })),
    rejected: decisions.filter(d => !d.accept).map(d => d.actionId), draftSaved: saveDraft && state.workflow === "support", view: state.view };
  const next: State = { ...state, revision: receipt.revision, proposal: null,
    work: [...state.work, ...accepted],
    items: state.items.map(item => {
      const assignment = accepted.find(a => a.target === item.id && a.kind === "assign");
      return assignment ? { ...item, owner: assignment.owner } : item;
    }),
    draft: receipt.draftSaved ? draft : state.draft,
    receipts: [...state.receipts, receipt],
    audit: [...state.audit, `${receipt.accepted.length} approved, ${receipt.rejected.length} rejected. ${receipt.draftSaved ? "Draft saved only; not sent." : "No reply sent."}`] };
  return { state: next, receipt };
}
export function changeView(state: State, expected: number, view: View): State {
  expectRevision(state, expected);
  assertView(state.workflow, view);
  return { ...state, revision: state.revision + 1, view, audit: [...state.audit, `User changed chart to ${view.metric} / ${view.chart} / ${view.group} / ${view.filter}.`] };
}
export function complete(state: State, expected: number, target: string): State {
  expectRevision(state, expected);
  if (!state.items.some(i => i.id === target && i.status === "open")) throw new Conflict("ALREADY_COMPLETE", "Item is missing or already complete.");
  return { ...state, revision: state.revision + 1,
    items: state.items.map(i => i.id === target ? { ...i, status: "done" } : i),
    work: state.work.map(w => w.target === target ? { ...w, status: "done" } : w),
    audit: [...state.audit, `User manually ${state.workflow === "support" ? "resolved" : "completed"} ${target}.`] };
}
