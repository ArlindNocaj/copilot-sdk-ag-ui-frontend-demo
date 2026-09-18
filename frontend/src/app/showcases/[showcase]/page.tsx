import { notFound } from "next/navigation";
import { Workbench } from "../../../components/workbench";
import { isBackend } from "../../../features";
import "../styles.css";
export default async function Page({ params, searchParams }: {
  params: Promise<{ showcase: string }>; searchParams: Promise<{ backend?: string }>;
}) {
  const { showcase } = await params;
  if (!["release-readiness", "support-triage"].includes(showcase)) notFound();
  const selected = (await searchParams).backend ?? process.env.DEMO_BACKEND ?? "typescript";
  if (!isBackend(selected)) notFound();
  return <Workbench workflow={showcase === "release-readiness" ? "release" : "support"} backend={selected}
    modelMode={process.env.DEMO_MODE === "mock" ? "Deterministic mock" : "Live Copilot"} />;
}
