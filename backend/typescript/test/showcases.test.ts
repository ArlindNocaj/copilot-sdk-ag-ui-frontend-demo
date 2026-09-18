import assert from "node:assert/strict";
import { it as test } from "vitest";
import { randomUUID } from "node:crypto";
import { ageBucket, aggregate, initialState, isOverdue, measurement, type Plan, type State, Conflict } from "../../../shared/domain.js";
import { Store } from "../src/showcases/store.js";

const releasePlan: Plan = { chart: "bars", metric: "failure-rate", group: "product", filter: "urgent", rationale: "Review the Catalog P1 slice.", draft: "", actions: [
  { id: "one", target: "REL-CAT-01", kind: "task", title: "Investigate indexing race", owner: "Avery" },
  { id: "two", target: "REL-CAT-02", kind: "task", title: "Remediate inventory contract", owner: "Blair" },
  { id: "three", target: "REL-PAY-01", kind: "task", title: "Prioritize Payments fix", owner: "Casey" },
] };
function staged(workflow: "release" | "support" = "release") {
  const store = new Store();
  const threadId = randomUUID();
  store.execute({ op: "init", threadId, workflow });
  const plan: Plan = workflow === "release" ? releasePlan : { ...releasePlan, metric: "age-distribution", group: "owner", filter: "open", draft: "We are reviewing this fictional ticket.", actions: [
    { id: "one", target: "SUP-BLA-03", kind: "assign", title: "Assign aged inventory investigation", owner: "Avery" },
    { id: "two", target: "SUP-BLA-04", kind: "assign", title: "Assign aged identity investigation", owner: "Avery" },
    { id: "three", target: "SUP-DAN-04", kind: "escalate", title: "Escalate urgent ticket", owner: "Casey" },
  ] };
  store.issuedTool(threadId, "call-1", plan);
  const { state } = store.execute({ op: "stage", threadId, toolCallId: "call-1", plan });
  const command = { op: "commit" as const, threadId, submissionId: randomUUID(), proposalId: state.proposal!.id, expectedRevision: state.revision,
    saveDraft: workflow === "support", draft: "Saved locally. Next update tomorrow.", decisions: plan.actions.map((a, i) => ({ actionId: a.id, title: a.title, owner: i === 0 ? "Dana" as const : a.owner, accept: i < 2 })) };
  return { store, threadId, state, plan, command };
}
test("release story: exact 40 items, 840 attempts, 95 failures and nonuniform allocations", () => {
  const state = initialState("release");
  assert.equal(state.items.length, 40);
  assert.equal(state.items.reduce((n, item) => n + item.buildAttempts!, 0), 840);
  assert.equal(state.items.reduce((n, item) => n + item.failedBuilds!, 0), 95);
  assert(state.items.every(item => Number.isInteger(item.failedBuilds) && Number.isInteger(item.buildAttempts) && item.failedBuilds! >= 0 && item.failedBuilds! <= item.buildAttempts!));
  assert(new Set(state.items.map(item => item.buildAttempts)).size > 15);
  assert.deepEqual(aggregate(state).map(r => [r.label, r.count, r.attempts, r.failures]),
    [["Checkout", 14, 420, 42], ["Catalog", 12, 300, 27], ["Identity", 8, 80, 16], ["Payments", 6, 40, 10]]);
  assert.equal(measurement.releaseWindow.start, "2026-09-11T06:00:00Z");
  assert.equal(measurement.releaseWindow.end, "2026-09-18T06:00:00Z");
});
test("release ranking reverses by rate then urgent scope; cautions use actual denominators", () => {
  const state = initialState("release"); state.view.metric = "failure-rate";
  const all = aggregate(state);
  assert.deepEqual(all.map(r => r.label), ["Payments", "Identity", "Checkout", "Catalog"]);
  const catalog = all.find(r => r.label === "Catalog")!, checkout = all.find(r => r.label === "Checkout")!;
  assert(catalog.failures * checkout.attempts < checkout.failures * catalog.attempts);
  assert.equal(all.find(r => r.label === "Payments")!.smallSample, false);
  state.view.filter = "urgent"; const urgent = aggregate(state);
  assert.deepEqual(urgent.map(r => [r.label, r.failures, r.attempts]), [["Catalog", 18, 60], ["Identity", 5, 20], ["Payments", 3, 12], ["Checkout", 9, 90]]);
  const cat = urgent[0], chk = urgent[3];
  assert(cat.failures * chk.attempts > chk.failures * cat.attempts);
  assert.equal(urgent.find(r => r.label === "Payments")!.smallSample, true);
  assert.deepEqual([catalog.failures - cat.failures, catalog.attempts - cat.attempts], [9, 240]);
});
test("zero denominators remain explicit zero counts, not fabricated rates", () => {
  const state = initialState("release"); state.items = []; state.view.metric = "failure-rate";
  assert(aggregate(state).every(row => row.attempts === 0 && row.failures === 0 && row.smallSample === false));
  assert(!JSON.stringify(aggregate(state)).includes("rate"));
  for (const attempts of [0, 24, 25]) {
    state.items = [{ ...initialState("release").items[0], buildAttempts: attempts, failedBuilds: 0 }];
    assert.equal(aggregate(state).find(row => row.label === "Checkout")!.smallSample, attempts > 0 && attempts < 25);
  }
});
test("support story: equal counts differ in age composition and exact synthetic breach counts", () => {
  const state = initialState("support");
  assert.equal(state.items.length, 36);
  assert.deepEqual(Object.fromEntries(["Avery", "Blair", "Casey", "Dana"].map(owner => [owner, state.items.filter(i => i.owner === owner && i.status === "open" && i.priority === "P1").map(i => i.ageHours)])),
    { Avery: [2], Blair: [10, 12], Casey: [3], Dana: [6, 7, 9, 20] });
  const rows = aggregate(state);
  assert.deepEqual(rows.map(r => [r.label, r.count, r.ageHoursSum, r.overdue, r.ageBuckets]), [
    ["Dana", 9, 117, 4, [2, 7, 0, 0]], ["Avery", 8, 64, 0, [3, 5, 0, 0]],
    ["Blair", 8, 272, 6, [0, 4, 2, 2]], ["Casey", 7, 84, 0, [1, 6, 0, 0]],
  ]);
  assert.deepEqual(rows.reduce((s, r) => [s[0] + r.count, s[1] + r.ageHoursSum, s[2] + r.overdue], [0, 0, 0]), [32, 537, 10]);
  state.view.metric = "age-distribution"; assert.equal(aggregate(state)[0].label, "Blair");
  state.view.filter = "urgent"; state.view.metric = "overdue-tickets";
  assert.deepEqual(aggregate(state).map(r => [r.label, r.count, r.ageHoursSum, r.overdue]), [["Dana", 4, 42, 4], ["Blair", 2, 22, 2], ["Avery", 1, 2, 0], ["Casey", 1, 3, 0]]);
  state.items = state.items.map(i => ({ ...i, status: "done" }));
  assert(aggregate(state).every(row => row.count === 0 && row.ageHoursSum === 0 && row.overdue === 0));
});
test("age bins and strict synthetic SLA boundaries; closed ages never count", () => {
  assert.deepEqual(measurement.ageBucketEdgesHours, [0, 8, 24, 72]);
  assert.deepEqual([0, 7, 8, 23, 24, 71, 72, 200].map(ageBucket), [0, 0, 1, 1, 2, 2, 3, 3]);
  const state = initialState("support"), base = state.items[0];
  for (const [priority, hours] of [["P1", 4], ["P2", 24], ["P3", 72]] as const) {
    assert.equal(isOverdue({ ...base, priority, ageHours: hours }), false);
    assert.equal(isOverdue({ ...base, priority, ageHours: hours + 1 }), true);
    assert.equal(isOverdue({ ...base, priority, ageHours: hours + 1, status: "done" }), false);
  }
  const before = aggregate(state); state.items.filter(i => i.status === "done").forEach(i => { i.ageHours = 9999; });
  assert.deepEqual(aggregate(state), before);
});
test("release partial approval preserves edited owner, rejects unselected task", () => {
  const { store, command } = staged();
  const { state, receipt } = store.execute(command);
  assert.equal(state.work.length, 2);
  assert.equal(state.work[0].owner, "Dana");
  assert.deepEqual(receipt?.rejected, ["three"]);
  assert.equal(state.proposal, null);
});
test("support assignment, rejection, save-only draft and manual resolution feed authoritative prompt", () => {
  const { store, command, threadId } = staged("support");
  const { state, receipt } = store.execute(command);
  assert.equal(state.items.find(i => i.id === "SUP-BLA-03")!.owner, "Dana");
  assert.equal(state.work.some(w => w.kind === "escalate"), false);
  assert.equal(state.draft, command.draft);
  assert.equal(receipt?.draftSaved, true);
  const sums = (s: State) => aggregate(s).reduce((sum, r) => [sum[0] + r.count, sum[1] + r.ageHoursSum, sum[2] + r.overdue], [0, 0, 0]);
  assert.deepEqual(sums(state), [32, 537, 10]);
  assert.deepEqual(aggregate(state).find(r => r.label === "Dana")?.ageBuckets, [2, 7, 1, 0]);
  assert.deepEqual(aggregate(state).find(r => r.label === "Avery")?.ageBuckets, [3, 5, 1, 0]);
  assert.deepEqual(aggregate(state).find(r => r.label === "Blair")?.ageBuckets, [0, 4, 0, 2]);
  store.execute({ op: "complete", threadId, expectedRevision: state.revision, target: "SUP-BLA-03" });
  assert.equal(store.prompt(threadId).items.find(i => i.id === "SUP-BLA-03")!.status, "done");
  assert.deepEqual(sums(store.get(threadId)), [31, 501, 9]);
  assert.deepEqual(store.prompt(threadId).computedTotals, { count: 31, failures: 0, attempts: 0, ageHoursSum: 501, overdue: 9 });
  assert.equal(store.prompt(threadId).work[0].status, "done");
  assert.equal(store.prompt(threadId).revision, 3);
});
test("stale approval applies nothing after a manual filter change", () => {
  const { store, command, threadId, state } = staged();
  store.execute({ op: "view", threadId, expectedRevision: state.revision, view: { ...state.view, filter: "all" } });
  assert.throws(() => store.execute(command), e => e instanceof Conflict && e.code === "STALE_REVISION");
  assert.equal(store.get(threadId).work.length, 0);
  const updated = store.execute({ ...command, expectedRevision: 2 });
  assert.equal(updated.receipt?.revision, 3);
});
test("identical duplicate returns original receipt without repeating effects", () => {
  const { store, command, threadId } = staged();
  const first = store.execute(command);
  store.execute({ op: "complete", threadId, expectedRevision: first.state.revision, target: "REL-CAT-01" });
  const second = store.execute(command);
  assert.deepEqual(second.receipt, first.receipt);
  assert.equal(second.duplicate, true);
  assert.equal(second.state.revision, 3);
  assert.equal(second.state.work.length, 2);
});
test("changed duplicate is rejected; alternate submission cannot apply decided proposal", () => {
  const { store, command } = staged();
  store.execute(command);
  assert.throws(() => store.execute({ ...command, draft: "different" }), e => e instanceof Conflict && e.code === "DUPLICATE_CONFLICT");
  assert.throws(() => store.execute({ ...command, submissionId: randomUUID(), expectedRevision: 2 }), e => e instanceof Conflict && e.code === "NO_PENDING_PROPOSAL");
});
test("native continuation only accepts app-owned exact receipt", () => {
  const { store, command, threadId } = staged();
  const { receipt } = store.execute(command);
  assert.doesNotThrow(() => store.verifyToolResult(threadId, "call-1", JSON.stringify(receipt)));
  assert.throws(() => store.verifyToolResult(threadId, "call-1", JSON.stringify({ ...receipt, nonce: randomUUID() })));
  assert.throws(() => store.verifyToolResult(threadId, "unissued", JSON.stringify(receipt)));
});
test("unissued, duplicate, wrong-workflow and unknown-target plans cannot stage", () => {
  const store = new Store(); const threadId = "validation";
  store.execute({ op: "init", threadId, workflow: "release" });
  assert.throws(() => store.execute({ op: "stage", threadId, toolCallId: "fake", plan: releasePlan }));
  for (const actions of [
    [releasePlan.actions[0], releasePlan.actions[0]],
    [{ ...releasePlan.actions[0], target: "REAL-TICKET" }],
    [{ ...releasePlan.actions[0], kind: "escalate" }],
  ]) {
    const plan = { ...releasePlan, actions };
    store.issuedTool(threadId, "call-bad", plan);
    assert.throws(() => store.execute({ op: "stage", threadId, toolCallId: "call-bad", plan }));
  }
  assert.equal(store.get(threadId).revision, 0);
});
test("every action requires one explicit decision and valid owner", () => {
  const { store, command } = staged();
  assert.throws(() => store.execute({ ...command, decisions: command.decisions.slice(0, 2) }));
  assert.throws(() => store.execute({ ...command, decisions: [...command.decisions.slice(0, 2), command.decisions[0]] }));
  assert.throws(() => store.execute({ ...command, decisions: command.decisions.map(d => ({ ...d, owner: "Unknown" })) }));
});
test("model proposals cannot omit draft or exceed the rationale bound", () => {
  const { store, threadId, plan } = staged();
  const { draft: _draft, ...missingDraft } = plan;
  for (const invalid of [missingDraft, { ...plan, rationale: "x".repeat(701) }]) {
    assert.throws(() => store.issuedTool(threadId, "invalid-contract", invalid));
    assert.equal(store.get(threadId).work.length, 0);
  }
});
test("state read is isolated; repeated complete and stale view do not mutate", () => {
  const { store, threadId, state } = staged();
  const copy = store.get(threadId); copy.items[0].title = "tampered";
  assert.notEqual(store.get(threadId).items[0].title, "tampered");
  store.execute({ op: "complete", threadId, expectedRevision: state.revision, target: "REL-CAT-01" });
  const historical = store.get(threadId); historical.view.filter = "all";
  assert.deepEqual(aggregate(historical).reduce((s, r) => [s[0] + r.failures, s[1] + r.attempts], [0, 0]), [95, 840]);
  const openP1 = store.get(threadId);
  const catalog = aggregate(openP1).find(r => r.label === "Catalog")!;
  assert.deepEqual([catalog.failures, catalog.attempts], [10, 36]);
  assert.throws(() => store.execute({ op: "complete", threadId, expectedRevision: 2, target: "REL-CAT-01" }));
  assert.throws(() => store.execute({ op: "view", threadId, expectedRevision: 1, view: state.view }));
});
