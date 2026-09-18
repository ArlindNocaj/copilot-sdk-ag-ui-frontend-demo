export async function readLocalBody(request: Request, limit = 262144) {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (!["127.0.0.1:3310", "localhost:3310"].includes(host ?? "") || (origin && origin !== `http://${host}`)) {
    return Response.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) return Response.json({ error: "JSON required" }, { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Body required" }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return Response.json({ error: "Request too large" }, { status: 413 }); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
import type { Backend } from "../../features";
export function backendOrigin(backend: Backend) {
  const origin = backend === "python" ? process.env.PYTHON_BACKEND_URL ?? "http://127.0.0.1:8227" : process.env.TYPESCRIPT_BACKEND_URL ?? "http://127.0.0.1:8228";
  const target = new URL(origin);
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || target.username || target.password ||
      target.pathname !== "/" || target.search || target.hash) throw new Error("Backend must be a loopback HTTP origin");
  return target.origin;
}
