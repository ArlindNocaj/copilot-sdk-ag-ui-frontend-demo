import { features } from "../features";
export default function Home() {
  return <main className="home">
    <p className="eyebrow">GITHUB COPILOT SDK / AG-UI / COPILOTKIT</p>
    <h1>One agent protocol.<br />Start small. Go deeper.</h1>
    <p className="lead">Start with a conversation. Add tools, shared state, human decisions, then native subagents. The same frontend works with Python or TypeScript.</p>
    <div className="notice">Local, fictional demos. No weather lookup, booking, deployment, or message sending. Choose a backend on any page.</div>
    <h2>01 / Small contracts</h2>
    <div className="feature-grid">{Object.entries(features).map(([id, [title, description]], index) =>
      <a className="feature-card" key={id} href={`/features/${id}`}>
        <span className="index">{String(index + 1).padStart(2, "0")}</span><h2>{title}</h2><p>{description}</p><span className="arrow">Explore &rarr;</span>
      </a>)}</div>
    <section className="showcase-links"><p className="eyebrow">02 / RICH SHOWCASES</p><h2>When the chart changes the decision</h2>
      <div className="feature-grid">
        <a className="feature-card" href="/showcases/release-readiness"><span className="index">13 / 40 release items</span><h2>Release readiness</h2><p>Raw failure volume, failure rate and the urgent slice tell different stories. Approve edited tasks, not deployments.</p><span className="arrow">Review readiness &rarr;</span></a>
        <a className="feature-card" href="/showcases/support-triage"><span className="index">14 / 36 support tickets</span><h2>Support triage</h2><p>Equal queue counts hide age tails and urgent breaches. Review assignments and save a draft without sending.</p><span className="arrow">Review the queue &rarr;</span></a>
      </div>
    </section>
  </main>;
}
