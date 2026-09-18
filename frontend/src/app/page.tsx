import { features } from "../features";
export default function Home() {
  return <main className="home">
    <p className="eyebrow">GITHUB COPILOT SDK / AG-UI / COPILOTKIT</p>
    <h1>One agent protocol.<br />Twelve small proofs.</h1>
    <p className="lead">Start with a conversation. Add tools, shared state, human decisions, then native subagents. The same frontend works with Python or TypeScript.</p>
    <div className="notice">Local, fictional demos. No weather lookup, booking, deployment, or message sending. Choose a backend on any page.</div>
    <div className="feature-grid">{Object.entries(features).map(([id, [title, description]], index) =>
      <a className="feature-card" key={id} href={`/features/${id}`}>
        <span className="index">{String(index + 1).padStart(2, "0")}</span><h2>{title}</h2><p>{description}</p><span className="arrow">Explore &rarr;</span>
      </a>)}</div>
  </main>;
}
