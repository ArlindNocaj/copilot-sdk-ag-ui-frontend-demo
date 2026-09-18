import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { isBackend, isAgent } from "../../../../../features";
import { backendOrigin, readLocalBody } from "../../../boundary";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = new Map<string, ReturnType<typeof createCopilotRuntimeHandler>>();
export async function POST(request: Request, context: { params: Promise<{ backend: string; feature: string }> }) {
  const { backend, feature } = await context.params;
  if (!isBackend(backend) || !isAgent(feature)) return Response.json({ error: "Unknown backend or feature" }, { status: 404 });
  const body = await readLocalBody(request, 4 * 1024 * 1024);
  if (body instanceof Response) return body;
  const key = `${backend}/${feature}`;
  let handler = handlers.get(key);
  if (!handler) {
    const origin = backendOrigin(backend);
    handler = createCopilotRuntimeHandler({
      runtime: new CopilotRuntime({ agents: { [feature]: new HttpAgent({ url: `${origin}/${feature}`, headers: { "Content-Type": "application/json" } }) }, forwardHeaders: { allow: ["content-type"] } }),
      basePath: `/api/copilotkit/${key}`, mode: "single-route",
    });
    handlers.set(key, handler);
  }
  const response = await handler(new Request(request.url, { method: "POST", headers: request.headers, body, signal: request.signal }));
  if (response.headers.get("content-type")?.includes("text/event-stream")) response.headers.set("content-type", "text/event-stream; charset=utf-8");
  return response;
}
