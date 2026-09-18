import { backendOrigin, readLocalBody } from "../boundary";
import { isBackend } from "../../../features";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const backend = new URL(request.url).searchParams.get("backend") ?? "typescript";
  if (!isBackend(backend)) return Response.json({ error: "Unknown backend" }, { status: 400 });
  const body = await readLocalBody(request);
  if (body instanceof Response) return body;
  try {
    const response = await fetch(`${backendOrigin(backend)}/workbench`, {
      method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(5000),
    });
    return new Response(await response.text(), { status: response.status, headers: { "content-type": "application/json" } });
  } catch (error) {
    console.error("Workbench proxy failed:", error);
    return Response.json({ error: "Local workbench unavailable. Start the selected backend, then refresh." }, { status: 502 });
  }
}
