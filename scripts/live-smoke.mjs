import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
const env = { ...process.env, COPILOTKIT_TELEMETRY_DISABLED: "true", NEXT_TELEMETRY_DISABLED: "1" };
for (const key of ["OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_CHAT_MODEL_ID"]) delete env[key];
for (const backend of ["typescript", "python"]) {
  const port = backend === "typescript" ? "8328" : "8327";
  await new Promise((accept, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error(`Live smoke port ${port} already in use`)));
    probe.listen(Number(port), "127.0.0.1", () => probe.close(accept));
  });
  const command = backend === "typescript" ? process.execPath : "uv";
  const args = backend === "typescript" ? ["--import", "tsx", "backend/typescript/src/server.ts"]
    : ["run", "--project", "backend/python", "--extra", "server", "--locked", "--default-index", "https://pypi.org/simple", "python", "backend/python/server.py"];
  const child = spawn(command, args, { env: { ...env, PORT: port }, stdio: ["ignore", "ignore", "inherit"] });
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) throw new Error(`Backend exited with ${child.exitCode}`);
      try {
        const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
        healthy = health.app === "copilot-sdk-ag-ui-frontend-demo" && health.backend === backend;
      } catch { /* Readiness probe; bounded below. */ }
      if (healthy) break;
      await sleep(500);
    }
    if (!healthy) throw new Error("Backend did not become healthy within 30 seconds");
    const response = await fetch(`http://127.0.0.1:${port}/agentic_chat`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({ threadId: randomUUID(), runId: randomUUID(), messages: [{ id: randomUUID(), role: "user", content: "Reply in one short sentence: what is the capital of France?" }], tools: [], context: [], state: {}, forwardedProps: {} }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    const events = (await response.text()).split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
    const failure = events.find(event => event.type === "RUN_ERROR");
    if (failure) throw new Error(failure.message);
    const reply = events.filter(event => event.type === "TEXT_MESSAGE_CONTENT").map(event => event.delta).join("");
    if (!/Paris/i.test(reply) || !events.some(event => event.type === "RUN_FINISHED")) throw new Error("Expected Paris reply and RUN_FINISHED");
    console.log(JSON.stringify({ backend, mode: "live-copilot", result: "pass", reply }));
  } catch (error) {
    console.error(JSON.stringify({ backend, mode: "live-copilot", result: "failed", error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  } finally {
    child.kill("SIGTERM");
    await Promise.race([new Promise(resolve => child.once("exit", resolve)), sleep(10_000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}
