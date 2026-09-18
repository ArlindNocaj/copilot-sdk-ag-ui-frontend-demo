import { notFound } from "next/navigation";
import { Demo } from "../../../components/demo";
import { isFeature, isBackend } from "../../../features";
export default async function Page({ params, searchParams }: { params: Promise<{ feature: string }>; searchParams: Promise<{ backend?: string }> }) {
  const { feature } = await params;
  if (!isFeature(feature)) notFound();
  const query = await searchParams;
  const selected = query.backend ?? process.env.DEMO_BACKEND ?? "typescript";
  if (!isBackend(selected)) notFound();
  return <Demo feature={feature} backend={selected} mode={process.env.DEMO_MODE === "mock" ? "Deterministic mock" : "Live Copilot"} />;
}
