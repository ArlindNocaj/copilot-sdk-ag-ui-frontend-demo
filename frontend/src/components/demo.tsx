"use client";
import { useEffect, useRef, useState } from "react";
import { CopilotChat, CopilotKit, useAgent, useCopilotKit, useFrontendTool, useHumanInTheLoop, useInterrupt, useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { features, type Backend, type Feature } from "../features";

export function Demo({ feature, backend, mode }: { feature: Feature; backend: Backend; mode: string }) {
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const [title, description] = features[feature];
  return <main className="demo">
    <header className="topbar"><a href="/">SDK / AG-UI</a><span>{mode}</span>
      <label>Backend <select aria-label="Backend" value={backend} onChange={e => { window.location.href = `?backend=${e.target.value}`; }}>
        <option value="typescript">TypeScript</option><option value="python">Python / uv</option>
      </select></label></header>
    <header className="demo-heading"><p className="eyebrow">SIMPLE CONTRACT / {feature}</p><h1>{title}</h1><p>{description}</p></header>
    <p className="notice compact">Fictional, loopback-only demo. Tool completion does not perform real-world actions.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {origin ? <CopilotKit runtimeUrl={`${origin}/api/copilotkit/${backend}/${feature}`} agent={feature} useSingleEndpoint enableInspector={false}
      onError={event => setError(event.error.message)}>
      <Content feature={feature} setError={setError} />
    </CopilotKit> : <p role="status">Connecting...</p>}
  </main>;
}

function Content({ feature, setError }: { feature: Feature; setError: (message: string) => void }) {
  const { agent, isReady } = useAgent({ agentId: feature });
  const { copilotkit, executingToolCallIds } = useCopilotKit();
  const [events, setEvents] = useState<string[]>([]);
  const [children, setChildren] = useState<Record<string, { name: string; status: string }>>({});
  const [attachment, setAttachment] = useState<{ mimeType: string; data: string; name: string }>();
  const busy = agent.isRunning || executingToolCallIds.size > 0;
  useEffect(() => agent.subscribe({
    onRunErrorEvent: ({ event }) => setError(event.message),
    onRunFailed: ({ error }) => setError(error.message),
    onEvent: ({ event }) => setEvents(previous => [...previous.slice(-199), event.type]),
    onSubagentStartedEvent: ({ event }) => setChildren(previous => ({ ...previous, [event.subagentRunId]: { name: event.name ?? "Specialist", status: "running" } })),
    onSubagentFinishedEvent: ({ event }) => setChildren(previous => ({ ...previous, [event.subagentRunId]: { name: previous[event.subagentRunId]?.name ?? "Specialist", status: event.outcome?.type ?? "finished" } })),
    onSubagentErrorEvent: ({ event }) => { setError(event.message); setChildren(previous => ({ ...previous, [event.subagentRunId]: { name: previous[event.subagentRunId]?.name ?? "Specialist", status: "error" } })); },
  }).unsubscribe, [agent, setError]);
  const send = (text: string) => {
    setError("");
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content: attachment
      ? [{ type: "text", text }, { type: "binary", mimeType: attachment.mimeType, data: attachment.data }]
      : text });
    void copilotkit.runAgent({ agent }).catch(error => setError(error instanceof Error ? error.message : "Run failed"));
  };
  return <div className="workspace">
    <section className="surface">
      <h2>Try the contract</h2>
      <button className="primary example" data-testid="example" disabled={!isReady || busy || (feature === "agentic_chat_multimodal" && !attachment)} onClick={() => send(features[feature][2])}>{features[feature][2]}</button>
      <p className="muted" data-testid="run-status">{!isReady ? "Connecting" : busy ? "Running" : "Ready"}</p>
      {feature === "agentic_chat_multimodal" && <label className="upload">Choose an image (PNG, JPEG, WebP; max 1 MiB)
        <input aria-label="Image" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={async event => {
          const file = event.target.files?.[0];
          if (!file) { setAttachment(undefined); return; }
          if (file.size > 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
            setAttachment(undefined); setError("Choose a PNG, JPEG or WebP image no larger than 1 MiB."); return;
          }
          try {
            const reader = new FileReader();
            const data = await new Promise<string>((resolve, reject) => {
              reader.onload = () => typeof reader.result === "string" ? resolve(reader.result.split(",")[1]) : reject(new Error("Unable to read image"));
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(file);
            });
            setAttachment({ mimeType: file.type, data, name: file.name });
          } catch (error) { setError(error instanceof Error ? error.message : "Unable to read image"); }
        }} />
        {attachment && <img className="image-preview" src={`data:${attachment.mimeType};base64,${attachment.data}`} alt={attachment.name} />}
      </label>}
      {feature === "backend_tool_rendering" && <Weather feature={feature} />}
      {feature === "human_in_the_loop" && <PlanTool feature={feature} />}
      {feature === "tool_based_generative_ui" && <HaikuTool feature={feature} />}
      {feature === "shared_state" && <Recipe feature={feature} />}
      {feature === "agentic_generative_ui" && <Steps feature={feature} />}
      {feature === "predictive_state_updates" && <Document feature={feature} />}
      {["interrupt", "subgraphs", "deepagents_subagents"].includes(feature) && <InterruptPanel feature={feature} />}
      {!!Object.keys(children).length && <section className="panel"><h3>Native subagents</h3>{Object.entries(children).map(([id, child]) =>
        <div className="subagent" data-testid="subagent" key={id}><strong>{child.name}</strong><span>{child.status}</span><small>{id}</small></div>)}</section>}
      {feature === "subgraphs" && <section className="panel"><h3>Saved itinerary</h3><pre data-testid="itinerary">{JSON.stringify(agent.state, null, 2)}</pre></section>}
      <details className="trace"><summary>AG-UI event trace</summary><pre data-testid="events">{events.join("\n")}</pre></details>
      <details className="trace"><summary>Current shared state</summary><pre data-testid="state">{JSON.stringify(agent.state, null, 2)}</pre></details>
    </section>
    <section className="conversation" aria-label="Agent conversation">
      <CopilotChat agentId={feature}
        labels={{ welcomeMessageText: "Use the example to begin, or send your own message.", chatInputPlaceholder: "Ask the agent...", chatDisclaimerText: "Copilot SDK via AG-UI. Demo only." }}
        input={{ textArea: { "aria-label": "Message" }, sendButton: { "aria-label": "Send message" } }} />
    </section>
  </div>;
}

function Weather({ feature }: { feature: string }) {
  useRenderTool({ agentId: feature, name: "get_weather", parameters: z.object({ location: z.string() }),
    render: ({ parameters, result, status }) => {
      if (status !== "complete") return <div className="panel">Retrieving fictional weather...</div>;
      let parsed: unknown = result;
      try { if (typeof parsed === "string") parsed = JSON.parse(parsed); }
      catch { return <p role="alert">Weather tool returned invalid JSON.</p>; }
      const data = z.object({ temperature: z.number(), conditions: z.string(), humidity: z.number() }).safeParse(parsed);
      if (!data.success) return <p role="alert">Weather tool returned an invalid result.</p>;
      return <div className="weather panel" data-testid="weather"><h3>{parameters.location}</h3><strong>{data.data.temperature}&deg; C</strong><p>{data.data.conditions} / Humidity {data.data.humidity}%</p></div>;
    },
  });
  return <p className="muted">The weather card appears in the conversation after the backend tool returns.</p>;
}

const stepSchema = z.object({ description: z.string(), status: z.enum(["enabled", "disabled", "executing"]) });
function PlanTool({ feature }: { feature: string }) {
  useHumanInTheLoop({ agentId: feature, name: "generate_task_steps", description: "Propose steps for the user to edit and explicitly approve.",
    parameters: z.object({ steps: z.array(stepSchema) }),
    render: ({ args, respond, status }) => <PlanReview key={JSON.stringify(args)} steps={args.steps ?? []} respond={respond} status={status} />,
  });
  return <p className="muted">Uncheck steps before approving. Only the selected steps are returned to the pending native call.</p>;
}
function PlanReview({ steps, respond, status }: { steps: z.infer<typeof stepSchema>[]; respond?: (value: unknown) => Promise<void>; status: string }) {
  const [selected, setSelected] = useState(steps.map(step => step.status !== "disabled"));
  return <div className="panel" data-testid="plan"><h3>Review the proposed steps</h3>{steps.map((step, index) => <label className="check" key={index}>
    <input type="checkbox" checked={selected[index] ?? true} disabled={!respond} onChange={e => setSelected(previous => previous.map((v, i) => i === index ? e.target.checked : v))} />{step.description}
  </label>)}
    <button disabled={!respond || status !== "executing"} onClick={() => void respond?.({ steps: steps.map((step, index) => ({ ...step, status: selected[index] ? "enabled" : "disabled" })) })}>Perform selected steps</button>
    <button disabled={!respond || status !== "executing"} onClick={() => void respond?.({ steps: steps.map(step => ({ ...step, status: "disabled" })) })}>Reject all steps</button>
  </div>;
}
const haikuSchema = z.object({ japanese: z.array(z.string()), english: z.array(z.string()), image_name: z.string(), gradient: z.string() });
function HaikuTool({ feature }: { feature: string }) {
  const [haiku, setHaiku] = useState<z.infer<typeof haikuSchema>>();
  useFrontendTool({ agentId: feature, name: "generate_haiku", description: "Render a three-line haiku card.", parameters: haikuSchema,
    handler: async value => { setHaiku(haikuSchema.parse(value)); return "Haiku rendered"; },
  });
  return haiku ? <div className="haiku panel" data-testid="haiku">{haiku.english.map((line, i) => <p key={i}>{line}</p>)}<hr />{haiku.japanese.map((line, i) => <p lang="ja" key={i}>{line}</p>)}</div> : <p className="muted">The frontend tool creates a card here. Model-provided CSS and image URLs are intentionally not applied.</p>;
}
const recipeSchema = z.object({
  title: z.string().optional(), skill_level: z.string(), special_preferences: z.array(z.string()), cooking_time: z.string(),
  ingredients: z.array(z.object({ icon: z.string(), name: z.string(), amount: z.string() })), instructions: z.array(z.string()), changes: z.string().optional(),
});
const initialRecipe = { title: "Your recipe", skill_level: "Beginner", special_preferences: [], cooking_time: "15 min", ingredients: [], instructions: [] };
function Recipe({ feature }: { feature: string }) {
  const { agent, isReady } = useAgent({ agentId: feature });
  useEffect(() => { if (isReady && !agent.state?.recipe) agent.setState({ recipe: initialRecipe }); }, [agent, isReady]);
  const result = recipeSchema.safeParse(agent.state?.recipe);
  if (!result.success) return <p>Waiting for a complete recipe...</p>;
  const recipe = result.data;
  return <div className="panel" data-testid="recipe"><h3>{recipe.title}</h3><p>{recipe.cooking_time} / {recipe.skill_level}</p>
    {recipe.ingredients.map((ingredient, index) => <div className="ingredient" key={index}>
      <input aria-label={`Ingredient ${index + 1}`} disabled={agent.isRunning} value={ingredient.name} onChange={event => agent.setState({ recipe: { ...recipe, ingredients: recipe.ingredients.map((item, i) => i === index ? { ...item, name: event.target.value } : item) } })} />
      <span>{ingredient.amount}</span></div>)}
    <button disabled={agent.isRunning} onClick={() => agent.setState({ recipe: { ...recipe, ingredients: [...recipe.ingredients, { icon: "", name: "Potatoes", amount: "12" }] } })}>Add potatoes</button>
    <ol>{recipe.instructions.map((line, index) => <li key={index}>{line}</li>)}</ol></div>;
}
function Steps({ feature }: { feature: string }) {
  const { agent } = useAgent({ agentId: feature });
  const result = z.array(z.object({ description: z.string().optional(), status: z.string().optional() })).safeParse(agent.state?.steps);
  const steps = result.success ? result.data : [];
  return <section className="panel" data-testid="steps"><h3>{steps.filter(step => step.status === "completed").length}/{steps.length} Complete</h3>
    {steps.map((step, index) => <p key={index}><span className={`status ${step.status}`}>{step.status}</span> {step.description}</p>)}</section>;
}
function Document({ feature }: { feature: string }) {
  const { agent } = useAgent({ agentId: feature });
  const [committed, setCommitted] = useState("");
  const committedRef = useRef("");
  useHumanInTheLoop({ agentId: feature, name: "write_document", description: "Preview the complete Markdown document and ask for approval.", parameters: z.object({ document: z.string() }),
    render: ({ args, respond, status }) => <div className="panel" data-testid="document-review"><h3>Review document changes</h3><pre>{args.document}</pre>
      <button disabled={!respond || status !== "executing"} onClick={() => {
        committedRef.current = args.document ?? ""; setCommitted(committedRef.current); agent.setState({ document: committedRef.current });
        void respond?.("Changes approved.");
      }}>Accept changes</button>
      <button disabled={!respond || status !== "executing"} onClick={() => { agent.setState({ document: committedRef.current }); void respond?.("Changes rejected. Keep the previous document."); }}>Reject changes</button>
    </div>,
  });
  return <section className="panel"><h3>Live preview</h3><pre data-testid="document-preview">{typeof agent.state?.document === "string" ? agent.state.document : ""}</pre>
    <h3>Accepted document</h3><pre data-testid="document">{committed || "No changes accepted yet."}</pre></section>;
}
const interruptPayload = z.object({
  topic: z.string().optional(), answer_summary: z.string().optional(), agent: z.string().optional(),
  options: z.array(z.record(z.string())).optional(), message: z.string().optional(),
});
function InterruptPanel({ feature }: { feature: string }) {
  return useInterrupt<never, false>({ agentId: feature, renderInChat: false,
    render: ({ interrupt, event, resolve }) => {
      const raw: unknown = interrupt?.metadata?.reason ?? event.value?.metadata?.reason;
      const parsed = interruptPayload.safeParse(raw);
      if (!parsed.success) return <p role="alert">Unsupported interrupt payload. Start a new conversation.</p>;
      const payload = parsed.data;
      return <section className="panel review" data-testid="interrupt"><h3>Your decision</h3>
        <p>{payload.topic ?? payload.answer_summary ?? payload.message}</p>
        {feature === "interrupt" ? <>
          <button onClick={() => resolve({ chosen_label: "Tomorrow at 10:00", chosen_time: new Date(Date.now() + 86400000).toISOString() })}>Tomorrow at 10:00</button>
          <button onClick={() => resolve({ cancelled: true })}>Cancel meeting</button>
        </> : feature === "deepagents_subagents" ? <>
          <button onClick={() => resolve({ approved: true })}>Approve answer</button>
          <button onClick={() => resolve({ approved: false })}>Reject answer</button>
        </> : payload.options?.map((option, index) =>
          <button className="travel-option" key={index} onClick={() => resolve(JSON.stringify(option))}><strong>{option.airline ?? option.name}</strong><span>{option.price ?? option.price_per_night}</span></button>)}
      </section>;
    },
  });
}
