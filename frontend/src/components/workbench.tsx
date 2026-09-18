"use client";
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { CopilotChat, CopilotChatAssistantMessage, CopilotKit, useAgent, useCopilotKit, useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { ageBucketLabels, aggregate, chartTotals, isOverdue, measurement, metricLabels, owners, validView, visibleItems, type Decision, type Metric, type Receipt, type State, type View, type Workflow } from "../../../shared/domain";

const schema = z.object({
  chart: z.enum(["bars", "table"]), metric: z.enum(["failures", "failure-rate", "open-tickets", "age-distribution", "overdue-tickets"]), group: z.enum(["product", "priority", "owner"]), filter: z.enum(["all", "urgent", "open"]),
  rationale: z.string().min(1).max(700),
  actions: z.array(z.object({
    id: z.string().min(1).max(160), target: z.string().min(1).max(160),
    kind: z.enum(["task", "assign", "follow-up", "escalate"]), title: z.string().min(1).max(180), owner: z.enum(owners),
  })).min(1).max(6), draft: z.string().max(2000),
});
type Backend = "typescript" | "python";
type Reply = { state: State; receipt?: Receipt; duplicate?: boolean };
type Pending = { settle: (receipt: Receipt) => void; cancel: () => void };
const message = (error: unknown) => error instanceof Error ? error.message : "Something failed. Refresh the workspace and try again.";
async function requestBackend(backend: Backend, body: Record<string, unknown>): Promise<Reply> {
  const response = await fetch(`/api/workbench?backend=${backend}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${result.code ? `${result.code}: ` : ""}${result.error}`);
  return result;
}
function Assistant(props: ComponentProps<typeof CopilotChatAssistantMessage>) {
  return <div data-testid="assistant-message"><CopilotChatAssistantMessage {...props} /></div>;
}
export function Workbench({ workflow, backend, modelMode }: { workflow: Workflow; backend: Backend; modelMode: string }) {
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  if (!origin) return <main><p role="status">Connecting to the local workbench…</p></main>;
  const agentId = workflow === "release" ? "release_readiness" : "support_triage";
  return <CopilotKit runtimeUrl={`${origin}/api/copilotkit/${backend}/${agentId}`} agent={agentId} useSingleEndpoint enableInspector={false}
    onError={event => setError(event.error.message)}>
    <Content workflow={workflow} backend={backend} modelMode={modelMode} error={error} setError={setError} />
  </CopilotKit>;
}
function Content({ workflow, backend, modelMode, error, setError }: { workflow: Workflow; backend: Backend; modelMode: string; error: string; setError: (v: string) => void }) {
  const request = useCallback((body: Record<string, unknown>) => requestBackend(backend, body), [backend]);
  const agentId = workflow === "release" ? "release_readiness" : "support_triage";
  const { agent, isReady } = useAgent({ agentId });
  const { copilotkit, executingToolCallIds } = useCopilotKit();
  const [state, setState] = useState<State>();
  const current = useRef<State | undefined>(undefined);
  const initialized = useRef("");
  const [pending, setPending] = useState<Pending>();
  const pendingRef = useRef<Pending | undefined>(undefined);
  const [working, setWorking] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [boardSearch, setBoardSearch] = useState("");
  const [boardGroup, setBoardGroup] = useState<{ group: View["group"]; label: string }>();
  const apply = useCallback((next: State) => {
    if (!current.current || next.revision >= current.current.revision) {
      current.current = next; setState(next); agent.setState(next);
    }
  }, [agent]);
  useEffect(() => {
    if (!isReady || initialized.current === agent.threadId) return;
    initialized.current = agent.threadId;
    request({ op: "init", workflow, threadId: agent.threadId }).then(result => apply(result.state)).catch(error => setError(message(error)));
  }, [isReady, agent.threadId, workflow, apply, request, setError]);
  useEffect(() => agent.subscribe({
    onRunErrorEvent: ({ event }) => setError(event.message),
    onRunFailed: ({ error }) => setError(error.message),
  }).unsubscribe, [agent, setError]);
  useEffect(() => () => pendingRef.current?.cancel(), []);
  const busy = agent.isRunning || executingToolCallIds.size > 0 || !!pending || working;
  const disabled = !isReady || !state || busy || stopped;

  useFrontendTool({
    agentId, name: "review_plan",
    description: "Choose a chart/filter and propose editable work. Wait for the user's approval receipt. Reply drafts are SAVE ONLY.",
    parameters: schema,
    handler: async (plan, context) => {
      context.signal?.throwIfAborted();
      try {
        if (!validView(workflow, plan)) throw new Error("The proposal used an unsupported workflow view. Nothing was staged.");
        const staged = await request({ op: "stage", threadId: agent.threadId, toolCallId: context.toolCall.id, plan });
        apply(staged.state);
        return await new Promise<Receipt>((resolve, reject) => {
          let settled = false;
          const cleanup = () => { context.signal?.removeEventListener("abort", cancel); pendingRef.current = undefined; setPending(undefined); };
          const cancel = () => { if (settled) return; settled = true; cleanup(); reject(new Error("Review cancelled; no decisions submitted.")); };
          const settle = (receipt: Receipt) => { if (settled) return; settled = true; cleanup(); resolve(receipt); };
          pendingRef.current = { cancel, settle }; setPending({ cancel, settle });
          context.signal?.addEventListener("abort", cancel, { once: true });
          if (context.signal?.aborted) cancel();
        });
      } catch (error) {
        setStopped(true);
        setError(`Review failed: ${message(error)} Reload to start a new workspace.`);
        throw error;
      }
    },
    render: props => <p className="tool-summary">{props.result ? "Decisions returned to the live agent." : "Review the proposed work in the workbench."}</p>,
  }, [agent.threadId, isReady, backend, workflow]); // CopilotKit serializes these dependencies; do not pass the agent object.

  const send = (text: string) => {
    if (!text.trim() || disabled) return;
    setError("");
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content: text.trim() });
    void copilotkit.runAgent({ agent }).catch(error => setError(message(error)));
  };
  const change = async (body: Record<string, unknown>) => {
    if (!state || working) return;
    setWorking(true); setError("");
    try { const reply = await request({ ...body, threadId: agent.threadId, expectedRevision: current.current!.revision }); apply(reply.state); return reply; }
    catch (error) {
      setError(message(error));
      try {
        const refreshed = await request({ op: "read", threadId: agent.threadId });
        apply(refreshed.state);
        const receipt = body.op === "commit" ? refreshed.state.receipts.find(receipt => receipt.proposalId === body.proposalId) : undefined;
        if (receipt) {
          setError("");
          return { state: refreshed.state, receipt };
        }
      }
      catch (refreshError) { setError(`${message(error)} State refresh also failed: ${message(refreshError)}`); }
    } finally { setWorking(false); }
  };
  const stop = async () => {
    setWorking(true);
    try {
      await copilotkit.stopAgent({ agent });
      pendingRef.current?.cancel();
      setStopped(true);
    } catch (error) { setError(message(error)); } finally { setWorking(false); }
  };
  const proposePrompt = workflow === "release"
    ? 'Review volume versus failure share. Set metric="failure-rate", group="product", filter="urgent" exactly; do not use raw-count metric="failures". You choose chart="bars" or "table". Propose exactly three fictional tasks: investigate REL-CAT-01, remediate REL-CAT-02, and prioritize an urgent Payments fix for REL-PAY-01. I will review whether Payments prioritization should wait for more evidence. Give two short rationale sentences under 450 characters, without numeric claims; the chart shows verified numbers. Deferral is not a safety conclusion. No deploying or blocking releases. Include draft="" and wait for my decisions.'
    : 'Review equal counts versus the age tail and urgent P1 breaches. Set metric="age-distribution", group="owner", filter="open" exactly. You choose chart="bars" or "table". Propose exactly three actions: assign aged SUP-BLA-03 to Avery, assign aged SUP-BLA-04 to Casey, and escalate SUP-DAN-04. I may edit owners and reject escalation. Give two short rationale sentences under 450 characters, without numeric claims; the chart shows verified numbers. Reassignment is not resolution or capacity evidence. Include a short save-only draft for SUP-BLA-03; do not claim an assignment/fix already happened. Wait for my decisions; never send.';
  const followUp = workflow === "release"
    ? "No tools. Read fresh authoritative state. Confirm REL-CAT-01 status and committed task owner, revision, metric and filter, rejected Payments action, and that all-history failures/attempts remain 95/840 after task completion. Do not propose more work."
    : "No tools. Read fresh authoritative state. Confirm SUP-BLA-03 status and owner, revision, metric and filter, rejected escalation, and quote the complete saved draft. Distinguish conserved reassignment totals from resolution. Was anything sent? Do not propose more work.";
  const boardItems = state?.items.filter(item => (!boardGroup || item[boardGroup.group] === boardGroup.label) && `${item.id} ${item.title} ${item.product} ${item.owner}`.toLowerCase().includes(boardSearch.toLowerCase())) ?? [];
  const metrics: Metric[] = workflow === "release" ? ["failures", "failure-rate"] : ["open-tickets", "age-distribution", "overdue-tickets"];
  return <main className="app-shell" data-testid="workbench" data-thread-id={agent.threadId} data-workflow={workflow} data-backend={backend}>
    <header className="page-header">
      <div><h1>{workflow === "release" ? "Release readiness" : "Support triage"}</h1><p>{workflow === "release" ? "40 fictional items · volume is not failure share" : "36 fictional tickets · queue counts hide the age tail"}</p></div>
      <span className="source-note">Fictional data · {modelMode}<br />{backend === "python" ? "Python" : "TypeScript"} Copilot SDK + AG-UI + CopilotKit</span>
    </header>
    <nav className="tabs" aria-label="Workbenches">
      <a href="/">All examples</a>
      <a href={`/showcases/release-readiness?backend=${backend}`} aria-disabled={busy} onClick={e => { if (busy) e.preventDefault(); }} aria-current={workflow === "release" ? "page" : undefined}>Release readiness</a>
      <a href={`/showcases/support-triage?backend=${backend}`} aria-disabled={busy} onClick={e => { if (busy) e.preventDefault(); }} aria-current={workflow === "support" ? "page" : undefined}>Support triage</a>
      <label>SDK backend<select aria-label="SDK backend" value={backend} disabled={busy} onChange={e => { window.location.href = `?backend=${e.target.value}`; }}>
        <option value="typescript">TypeScript</option><option value="python">Python · uv</option>
      </select></label>
    </nav>
    {error && <div className="error" role="alert" data-testid="run-error">{error}</div>}
    {stopped && <p role="status">Stopped. Unsubmitted proposals were not committed. <button onClick={() => window.location.reload()}>Start new workspace</button></p>}
    <div className="workspace">
      <div className="surface">
        <section className="analysis-panel" aria-labelledby="chart-title">
          <div className="section-heading"><h2 id="chart-title">{workflow === "release" ? "Where does the failure share change?" : "Which queues hide older or urgent tickets?"}</h2><span data-testid="revision">Revision {state?.revision ?? "—"}</span></div>
          <p className="measurement" data-testid="measurement">{workflow === "release"
            ? `Fixed build window: ${measurement.releaseWindow.start} → ${measurement.releaseWindow.end}. Failures / build attempts; completing work never erases this history.`
            : `Fixed as of ${measurement.supportAsOf}. Open-ticket ages in hours. Fictional SLA: P1 >4 h, P2 >24 h, P3 >72 h. Closed tickets are excluded; this is not time-to-resolution.`}</p>
          <div className="view-controls">
            <label>Metric<select aria-label="Chart metric" data-testid="chart-metric" value={state?.view.metric ?? metrics[0]} disabled={!state || working || (!!agent.isRunning && !pending)}
              onChange={e => void change({ op: "view", view: { ...state!.view, metric: e.target.value } })}>{metrics.map(metric => <option key={metric} value={metric}>{metricLabels[metric]}</option>)}</select></label>
            <label>{workflow === "release" ? "History scope" : "Open-ticket scope"}<select aria-label="Chart filter" data-testid="chart-filter" value={state?.view.filter ?? (workflow === "release" ? "all" : "open")} disabled={!state || working || (!!agent.isRunning && !pending)}
              onChange={e => void change({ op: "view", view: { ...state!.view, filter: e.target.value } })}>{workflow === "release" && <option value="all">All recorded items</option>}<option value="urgent">Open P1 only</option><option value="open">Currently open</option></select></label>
            <label>Group<select aria-label="Chart grouping" value={state?.view.group ?? (workflow === "release" ? "product" : "owner")} disabled={!state || working || (!!agent.isRunning && !pending)}
              onChange={e => void change({ op: "view", view: { ...state!.view, group: e.target.value } })}>{workflow === "release" ? <option value="product">Product</option> : <option value="owner">Owner</option>}<option value="priority">Priority</option></select></label>
            <label>Display<select aria-label="Chart display" value={state?.view.chart ?? "bars"} disabled={!state || working || (!!agent.isRunning && !pending)}
              onChange={e => void change({ op: "view", view: { ...state!.view, chart: e.target.value } })}><option value="bars">Horizontal bars</option><option value="table">Data table</option></select></label>
          </div>
          {state ? <Chart state={state} inspect={label => { setBoardSearch(""); setBoardGroup({ group: state.view.group, label }); document.getElementById("board-title")?.scrollIntoView(); }} /> : <p role="status">Loading the fictional workspace…</p>}
        </section>
        {state?.proposal && <Review key={state.proposal.id} state={state} enabled={!!pending && !working}
          submit={async (decisions, draft, saveDraft, submissionId) => {
            const result = await change({ op: "commit", proposalId: state.proposal!.id, decisions, draft, saveDraft, submissionId });
            if (result?.receipt) pendingRef.current?.settle(result.receipt);
          }} />}
        <section className="board-panel" aria-labelledby="board-title">
          <div className="section-heading"><h2 id="board-title">{workflow === "release" ? "Release board" : "Ticket board"}</h2><span>{state?.items.filter(i => i.status === "open").length ?? "—"} open</span></div>
          <p className="muted">{workflow === "release" ? "Complete fictional work, not a deployment. Recorded attempts and failures remain unchanged." : "Reassigning moves age distributions, not total work. Resolving removes a ticket from open-only analytics. Neither measures capacity or performance."}</p>
          <div className="board-controls"><label>Find source items<input data-testid="board-search" value={boardSearch} onChange={e => setBoardSearch(e.target.value)} placeholder="Item ID, title, product or owner" /></label>
            {boardGroup && <button data-testid="clear-drilldown" onClick={() => setBoardGroup(undefined)}>Clear {boardGroup.label} drill-down</button>}</div>
          <p className="muted" data-testid="board-count">{boardItems.length} of {state?.items.length ?? 0} source rows · scroll inside the table to inspect every match. Chart scope does not silently hide source rows.</p>
          {state && <div className="table-wrap board-scroll" role="region" aria-label="Scrollable source items" tabIndex={0}><table data-testid="board"><thead><tr><th>Item</th><th>{workflow === "release" ? "Priority / failures / attempts" : "Priority / age / SLA"}</th><th>Owner</th><th>Status</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>
            {boardItems.map(item => <tr key={item.id} data-testid={`item-${item.id}`}><td><strong>{item.title}</strong><small>{item.id} · {item.product}</small></td><td>{item.priority}<small>{workflow === "release" ? `${item.failedBuilds} / ${item.buildAttempts} attempts` : item.status === "done" ? "Closed · age excluded" : `${item.ageHours} h · ${isOverdue(item) ? "overdue" : "within fictional SLA"}`}</small></td><td>{item.owner}</td><td><span className={`status ${item.status}`}>{item.status === "done" ? (workflow === "release" ? "Complete" : "Resolved") : "Open"}</span></td><td>
              <button data-testid={`complete-${item.id}`} disabled={disabled || item.status === "done"} onClick={() => void change({ op: "complete", target: item.id })}>{workflow === "release" ? "Complete" : "Resolve"}</button>
            </td></tr>)}
          </tbody></table></div>}
          <h3>Approved work <span>{state?.work.length ?? 0}</span></h3>
          <div data-testid="committed-work">{state?.work.length ? state.work.map(work => <div className="work-row" key={work.id}><div><strong>{work.title}</strong><small>{work.target} · {work.kind}</small></div><span>{work.owner}</span><span className={`status ${work.status}`}>{work.status}</span></div>) : <p className="muted">No actions committed. Review a live proposal before anything appears here.</p>}</div>
          {workflow === "support" && <div className="saved-draft"><h3>Saved reply draft · not sent</h3><p data-testid="saved-draft">{state?.draft || "No draft saved. There is no send implementation."}</p></div>}
        </section>
        <details className="audit"><summary>Decision history & continuation receipt</summary>
          <ol>{state?.audit.map((line, i) => <li key={i}>{line}</li>)}</ol>
          <pre data-testid="receipt">{JSON.stringify(state?.receipts.at(-1) ?? null, null, 2)}</pre>
          <pre data-testid="app-state">{JSON.stringify(state ?? null)}</pre>
        </details>
      </div>
      <aside className="agent-panel" aria-label="Live agent">
        <div className="agent-header"><h2>Copilot</h2><span role="status" data-testid="run-status" data-state={busy ? "running" : "idle"}>{pending ? "Your review" : busy ? "Working" : state ? "Ready" : "Connecting"}</span></div>
        <p className="model-note">{modelMode} · {backend} backend<br />No shell tools or business APIs.</p>
        <div className="agent-actions">
          <button className="primary" data-testid="propose" disabled={disabled} onClick={() => send(proposePrompt)}>Review {workflow === "release" ? "readiness" : "queue"}</button>
          <button data-testid="follow-up" disabled={disabled || !state?.receipts.length} onClick={() => send(followUp)}>Read back current state</button>
        </div>
        <div className="standard-chat"><CopilotChat agentId={agentId}
          labels={{ welcomeMessageText: "Ask for a proposal, then decide in the workbench.", chatInputPlaceholder: "Ask about this fictional workspace", chatDisclaimerText: `${modelMode} · fictional data · no send` }}
          input={{ isRunning: busy, onStop: stop, textArea: { "aria-label": "Message", disabled, ...{ "data-testid": "message-input" } }, sendButton: { "aria-label": "Send message", disabled, ...{ "data-testid": "send-button" } } }}
          messageView={{ assistantMessage: Assistant as typeof CopilotChatAssistantMessage }} /></div>
        <button className="stop" disabled={!busy || working} onClick={() => void stop()}>Stop live run</button>
      </aside>
    </div>
    <footer>Fork integration, not an upstream shipped feature. In-memory state only; reload starts a new workspace. Drafts are never sent as replies; fictional draft text is shared with the selected model.</footer>
  </main>;
}
function Chart({ state, inspect }: { state: State; inspect: (label: string) => void }) {
  const rows = aggregate(state);
  const release = state.workflow === "release", distribution = state.view.metric === "age-distribution";
  const percent = (failures: number, attempts: number) => attempts ? `${(100 * failures / attempts).toFixed(1)}%` : "N/A";
  const mean = (sum: number, count: number) => count ? `${(sum / count).toFixed(1)} h` : "N/A";
  const value = (row: typeof rows[number]) => state.view.metric === "failure-rate" ? row.attempts ? row.failures / row.attempts : 0
    : state.view.metric === "failures" ? row.failures : state.view.metric === "overdue-tickets" ? row.overdue : row.count;
  const max = state.view.metric === "failure-rate" ? 1 : Math.max(1, ...rows.map(value));
  const totals = chartTotals(rows);
  const description = rows.map(row => release ? `${row.label}: ${row.failures} failures / ${row.attempts} attempts, ${percent(row.failures, row.attempts)}${row.smallSample ? ", demo small-sample caution" : ""}`
    : `${row.label}: ${row.count} open, ${row.ageHoursSum} age-hours summed, mean ${mean(row.ageHoursSum, row.count)}, ${row.overdue} overdue. Age bucket counts ${row.ageBuckets.join(", ")}.`).join("; ");
  return <div className="chart" data-testid="chart">
    <p className="insight" data-testid="insight">{release
      ? totals.attempts === 0 ? "No recorded attempts in this scope. Failure rate is N/A, not evidence of zero risk."
        : `${rows[0].label} leads this ${metricLabels[state.view.metric].toLowerCase()} view: ${rows[0].failures}/${rows[0].attempts} attempts (${percent(rows[0].failures, rows[0].attempts)}). Compare all history with open P1 before prioritizing.`
      : state.view.filter === "urgent" ? `Open P1 synthetic breaches: ${[...rows].sort((a, b) => b.overdue - a.overdue || a.label.localeCompare(b.label)).map(row => `${row.label} ${row.overdue}`).join(" · ")}. Overall age is not urgent severity.`
        : distribution ? "Same-count queues can have different age tails. Bucket widths count open tickets; mean age is not effort or an individual-performance measure."
          : "Counts alone hide waiting time. Compare age distribution, then open P1. Owner changes do not resolve tickets."}</p>
    {state.view.chart === "bars" && <><p className="muted">{metricLabels[state.view.metric]} · {state.view.metric === "failure-rate" ? "0–100% axis; every rate shows its numerator and denominator" : distribution ? "stacked counts; each segment is an elapsed-age bucket" : "counts, zero-based axis"}</p>
      {distribution && <ul className="age-legend" aria-label="Age bucket legend">{ageBucketLabels.map((label, i) => <li key={label}><span className={`bucket-${i}`} />{label}</li>)}</ul>}
      <div className="bar-chart" aria-label={description} data-testid="chart-bars">{rows.map(row => <div key={row.label} className="chart-group" data-testid={`chart-row-${row.label}`}>
        <div className="bar-row"><button className="chart-label" aria-label={`Inspect ${row.label} source items`} onClick={() => inspect(row.label)}>{row.label}</button>
          <div className="bar-track" role="img" aria-label={release ? `${row.label}: ${row.failures}/${row.attempts}, ${percent(row.failures, row.attempts)}` : `${row.label}: ${row.count} open; buckets ${row.ageBuckets.join(", ")}; ${row.overdue} overdue`}>
            {distribution ? row.ageBuckets.map((count, i) => <span key={i} className={`age-segment bucket-${i}`} style={{ width: `${100 * count / max}%` }}>{count > 0 ? count : ""}</span>)
              : <div className="bar" style={{ width: `${100 * value(row) / max}%` }} />}</div>
          <strong>{state.view.metric === "failure-rate" ? percent(row.failures, row.attempts) : value(row)}</strong></div>
        <p className="bar-detail">{release ? `${row.failures} failures / ${row.attempts} attempts · ${row.count} items${row.smallSample ? " · n<25: demo small-sample caution" : ""}`
          : `${row.count} open · ${row.ageHoursSum} age-hours summed · mean ${mean(row.ageHoursSum, row.count)} · ${row.overdue} overdue`}</p>
      </div>)}</div></>}
    <div className="table-wrap analytics-table"><table className="chart-data" data-testid="chart-data"><caption>{visibleItems(state).length} eligible {release ? "release items; historical counts for the selected current scope" : "open tickets; closed records never enter age or SLA calculations"}. Exact application-calculated values.</caption>
      <thead><tr><th>{state.view.group}</th><th>{release ? "Items" : "Open"}</th>{release ? <><th>Failures</th><th>Attempts</th><th>Failure rate</th><th>Sample caution</th></> : <><th>Age sum (h)</th><th>Mean age (h)</th><th>Overdue</th>{ageBucketLabels.map(label => <th key={label}>{label}</th>)}</>}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.label} data-group={row.label}><td>{row.label}</td><td>{row.count}</td>{release ? <><td>{row.failures}</td><td>{row.attempts}</td><td>{percent(row.failures, row.attempts)}</td><td>{row.smallSample ? "n<25 caution" : row.attempts ? "—" : "No attempts · N/A"}</td></> : <><td>{row.ageHoursSum}</td><td>{mean(row.ageHoursSum, row.count)}</td><td>{row.overdue}</td>{row.ageBuckets.map((count, i) => <td key={i}>{count}</td>)}</>}</tr>)}</tbody></table></div>
    <p data-testid="chart-totals" className="measurement">{release ? `${totals.failures} failures / ${totals.attempts} attempts · ${percent(totals.failures, totals.attempts)} · ${totals.count} items`
      : `${totals.count} open · ${totals.ageHoursSum} age-hours summed · ${totals.overdue} fictional SLA breaches. Reassignment conserves all three; resolution does not.`}</p>
    <p className="muted">{release ? "n<25 is a demo caution, not statistical confidence or evidence of safety. Zero attempts means N/A, not zero risk."
      : "Synthetic SLA policy; strictly greater than the threshold. Age is a measurement, not effort, throughput, capacity or MTTR."}</p>
    {!totals.count && <p>No eligible items. Ratios are N/A where the denominator is zero.</p>}
  </div>;
}
function Review({ state, enabled, submit }: { state: State; enabled: boolean; submit: (decisions: Decision[], draft: string, saveDraft: boolean, submissionId: string) => Promise<void> }) {
  const proposal = state.proposal!;
  const [decisions, setDecisions] = useState<Decision[]>(() => proposal.actions.map(action => ({ actionId: action.id, accept: false, title: action.title, owner: action.owner })));
  const [draft, setDraft] = useState(proposal.draft);
  const [saveDraft, setSaveDraft] = useState(false);
  const submission = useRef(crypto.randomUUID());
  const update = (index: number, edit: Partial<Decision>) => { submission.current = crypto.randomUUID(); setDecisions(ds => ds.map((d, i) => i === index ? { ...d, ...edit } : d)); };
  const accepted = decisions.filter(d => d.accept).length;
  return <section className="review-panel" aria-labelledby="review-title" data-testid="proposal">
    <div className="section-heading"><h2 id="review-title">Your decision, before any action</h2><span>Awaiting review</span></div>
    <p>{proposal.rationale}</p><p className="muted">Select only what you approve. Unselected actions will be explicitly rejected. Owners and task titles are editable.</p>
    <p className="decision-context">{state.workflow === "release" ? "Review Catalog's urgent slice; defer an overconfident Payments priority claim pending more evidence. Rejection is not a declaration of safety. These are fictional investigation/remediation tasks, never deployment controls."
      : "Edit the assignment owners and choose the subset you authorize. Reassignment moves age buckets between owners; it does not reduce the open queue, summed age or breach total. Escalation needs a separate decision."}</p>
    <fieldset disabled={!enabled}><legend className="sr-only">Proposed actions</legend>
      {proposal.actions.map((action, index) => <div className="proposal-row" key={action.id} data-testid="proposal-row" data-kind={action.kind} data-target={action.target}>
        <label className="approve-check"><input type="checkbox" aria-label={`Approve ${action.target} ${action.kind}`} checked={decisions[index].accept} onChange={e => update(index, { accept: e.target.checked })} /><span>Approve</span></label>
        <label className="task-title">{action.target} · {action.kind}<input aria-label={`Task title ${action.target} ${action.kind}`} maxLength={180} value={decisions[index].title} onChange={e => update(index, { title: e.target.value })} /></label>
        <label>Owner<select aria-label={`Owner ${action.target} ${action.kind}`} value={decisions[index].owner} onChange={e => update(index, { owner: e.target.value as Decision["owner"] })}>{owners.map(o => <option key={o}>{o}</option>)}</select></label>
      </div>)}
      {state.workflow === "support" && <div className="draft-editor"><label htmlFor="reply-draft">Editable reply draft · save only<textarea id="reply-draft" data-testid="draft-editor" maxLength={2000} rows={4} value={draft} onChange={e => { setDraft(e.target.value); submission.current = crypto.randomUUID(); }} /></label>
        <label className="check-label"><input type="checkbox" checked={saveDraft} data-testid="save-draft" onChange={e => { setSaveDraft(e.target.checked); submission.current = crypto.randomUUID(); }} />Save this draft locally. No send action exists.</label></div>}
      <div className="decision-footer"><p data-testid="decision-summary">{accepted} approve · {decisions.length - accepted} reject{saveDraft ? " · save draft" : ""}</p>
        <button className="primary" data-testid="commit" disabled={!decisions.every(d => d.title.trim())}
          onClick={() => void submit(decisions, draft, saveDraft, submission.current)}>Submit decisions</button></div>
    </fieldset>
  </section>;
}
