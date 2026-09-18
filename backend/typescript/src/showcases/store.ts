import { randomUUID } from "node:crypto";
import { aggregate, changeView, chartTotals, commit, complete, Conflict, initialState, measurement, stage, type Receipt, type State } from "../../../../shared/domain.js";
import { commandSchema, planSchema } from "./contracts.js";

// ponytail: process-local single-user demo; durable transactions needed for restart recovery or multi-user deployment.
export class Store {
  private states = new Map<string, State>();
  private submissions = new Map<string, { digest: string; receipt: Receipt }>();
  private issued = new Map<string, { args: string; result?: { state: State } }>();
  private receipts = new Map<string, Receipt>();
  get(thread: string) {
    const state = this.states.get(thread);
    if (!state) throw new Conflict("UNKNOWN_WORKSPACE", "Open a new workspace first.", 404);
    return structuredClone(state);
  }
  issuedTool(thread: string, toolCallId: string, args: unknown) {
    this.issued.set(`${thread}:${toolCallId}`, { args: JSON.stringify(planSchema.parse(args)) });
  }
  verifyToolResult(thread: string, toolCallId: string, content: string) {
    const expected = this.receipts.get(`${thread}:${toolCallId}`);
    let value: unknown;
    try { value = JSON.parse(content); } catch { throw new Conflict("INVALID_RECEIPT", "Unrecognized tool receipt.", 403); }
    if (!expected || JSON.stringify(value) !== JSON.stringify(expected)) throw new Conflict("INVALID_RECEIPT", "Only the app-owned approval receipt can continue this tool.", 403);
  }
  execute(raw: unknown): { state: State; receipt?: Receipt; duplicate?: boolean } {
    const cmd = commandSchema.parse(raw);
    if (cmd.op === "init") {
      if (this.states.has(cmd.threadId)) {
        const state = this.get(cmd.threadId);
        if (state.workflow !== cmd.workflow) throw new Conflict("WORKFLOW_MISMATCH", "Start a new workspace to change workflow.");
        return { state };
      }
      if (this.states.size >= 24) throw new Conflict("CAPACITY", "Workspace capacity reached; restart the demo.", 429);
      const state = initialState(cmd.workflow);
      this.states.set(cmd.threadId, state);
      return { state: structuredClone(state) };
    }
    const state = this.get(cmd.threadId);
    if (cmd.op === "read") return { state };
    if (state.audit.length >= 150) throw new Conflict("CAPACITY", "Demo change limit reached; start a new workspace.", 429);
    if (cmd.op === "stage") {
      const issued = this.issued.get(`${cmd.threadId}:${cmd.toolCallId}`);
      if (!issued || JSON.stringify(cmd.plan) !== issued.args) throw new Conflict("UNISSUED_PLAN", "Only a plan requested by the live model can be staged.", 403);
      if (issued.result) return structuredClone(issued.result);
      const next = stage(state, cmd.plan, cmd.toolCallId, randomUUID());
      this.states.set(cmd.threadId, next);
      issued.result = { state: next };
      return structuredClone(issued.result);
    }
    if (cmd.op === "commit") {
      const key = `${cmd.threadId}:${cmd.submissionId}`;
      const previous = this.submissions.get(key);
      const digest = JSON.stringify(cmd);
      if (previous) {
        if (previous.digest !== digest) throw new Conflict("DUPLICATE_CONFLICT", "This submission ID was already used with different decisions.");
        return { state, receipt: previous.receipt, duplicate: true };
      }
      const toolCallId = state.proposal?.toolCallId;
      const result = commit(state, cmd.proposalId, cmd.expectedRevision, cmd.decisions, cmd.draft, cmd.saveDraft, randomUUID());
      this.states.set(cmd.threadId, result.state);
      this.submissions.set(key, { digest, receipt: result.receipt });
      this.receipts.set(`${cmd.threadId}:${toolCallId}`, result.receipt);
      return structuredClone(result);
    }
    const next = cmd.op === "view" ? changeView(state, cmd.expectedRevision, cmd.view)
      : complete(state, cmd.expectedRevision, cmd.target);
    this.states.set(cmd.threadId, next);
    return { state: structuredClone(next) };
  }
  prompt(thread: string) {
    const state = this.get(thread);
    const computedChart = aggregate(state);
    return { ...state, measurement, computedChart, computedTotals: chartTotals(computedChart) };
  }
}
