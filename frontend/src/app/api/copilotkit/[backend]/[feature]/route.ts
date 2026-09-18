import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { isBackend, isFeature } from "../../../../../features";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = new Map<string, ReturnType<typeof createCopilotRuntimeHandler>>();
export async function POST(request: Request, context: { params: Promise<{ backend: string; feature: string }> }) {
  const { backend, feature } = await context.params;
  if (!isBackend(backend) || !isFeature(feature)) return Response.json({ error: "Unknown backend or feature" }, { status: 404 });
  const url = new URL(request.url);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) ||
      (request.headers.get("origin") && request.headers.get("origin") !== url.origin)) {
    return Response.json({ error: "Same-origin loopback requests only" }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "JSON required" }, { status: 415 });
  const reader = request.body?.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  if (reader) for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4 * 1024 * 1024) { await reader.cancel(); return Response.json({ error: "Request exceeds 4 MiB" }, { status: 413 }); }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks);
  const key = `${backend}/${feature}`;
  let handler = handlers.get(key);
  if (!handler) {
    const origin = backend === "python" ? process.env.PYTHON_BACKEND_URL ?? "http://127.0.0.1:8227" : process.env.TYPESCRIPT_BACKEND_URL ?? "http://127.0.0.1:8228";
    const target = new URL(origin);
    if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || target.username || target.password) throw new Error("Backend must be loopback HTTP");
    handler = createCopilotRuntimeHandler({
      runtime: new CopilotRuntime({ agents: { [feature]: new HttpAgent({ url: `${origin}/${feature}` }) }, forwardHeaders: { allow: ["content-type"] } }),
      basePath: `/api/copilotkit/${key}`, mode: "single-route",
    });
    handlers.set(key, handler);
  }
  const response = await handler(new Request(request.url, { method: "POST", headers: request.headers, body, signal: request.signal }));
  if (response.headers.get("content-type")?.includes("text/event-stream")) response.headers.set("content-type", "text/event-stream; charset=utf-8");
  return response;
}
