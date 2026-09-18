import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createServer } from "node:net";
const root = fileURLToPath(new URL("..", import.meta.url));
const backend = process.argv[2] ?? "typescript";
if (!["typescript", "python", "all"].includes(backend)) throw new Error("Choose typescript, python or all");
const mock = process.argv.includes("--mock");
const production = process.argv.includes("--production");
const env = {
  ...process.env,
  COPILOTKIT_TELEMETRY_DISABLED: "true", NEXT_TELEMETRY_DISABLED: "1",
  DEMO_BACKEND: backend === "all" ? "typescript" : backend,
  DEMO_MODE: mock ? "mock" : "live",
  ...(mock ? {
    OPENAI_BASE_URL: "http://127.0.0.1:5567/v1",
    OPENAI_API_KEY: "demo-mock-not-a-secret",
    OPENAI_CHAT_MODEL_ID: "gpt-4o",
    MOCK_PORT: "5567",
  } : {}),
};
const children = [];
let stopping = false;
function start(command, args, extra = {}) {
  // Backends stop their SDK children themselves, before terminal/test process-group teardown.
  const child = spawn(command, args, { cwd: root, env: { ...env, ...extra }, stdio: "inherit", detached: process.platform !== "win32" });
  children.push(child);
  child.on("error", error => { console.error(`${command}:`, error.message); stop(1); });
  child.on("exit", (code, signal) => {
    if (!stopping) { console.error(`${command} exited (${code ?? signal}); stopping demo.`); stop(code || 1); }
  });
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
}
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
for (const port of [3310, ...(backend !== "python" ? [8228] : []), ...(backend !== "typescript" ? [8227] : []), ...(mock ? [5567] : [])]) {
  await new Promise((accept, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error(`Port ${port} is already in use. Stop that service yourself or choose another demo environment.`)));
    probe.listen(port, "127.0.0.1", () => probe.close(accept));
  });
}
if (mock) start(process.execPath, ["--import", "tsx", "scripts/mock-model.ts"]);
if (backend !== "python") start(process.execPath, ["--import", "tsx", "backend/typescript/src/server.ts"], { PORT: "8228" });
if (backend !== "typescript") start("uv", ["run", "--project", "backend/python", "--extra", "server", "--locked", "--default-index", "https://pypi.org/simple", "python", resolve(root, "backend/python/server.py")], { PORT: "8227" });
start(process.execPath, ["frontend/node_modules/next/dist/bin/next", production ? "start" : "dev", "frontend", "--hostname", "127.0.0.1", "--port", "3310"]);
