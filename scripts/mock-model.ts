import { pathToFileURL } from "node:url";
import { LLMock } from "@copilotkit/aimock";
import { registerCopilotFixtures } from "../tests/fixtures/copilot-fixtures.js";

export function createMockServer({ port = 5567, log = console.error } = {}): LLMock {
  const mock = new LLMock({
    port, host: "127.0.0.1", latency: 5, chunkSize: 24, logLevel: "silent", journalMaxEntries: 100,
    // gpt-4o reasoning is intentionally a transport demo. Strict mode suppresses it;
    // the explicit error fixture still rejects every unmatched request.
    strict: false,
  });
  registerCopilotFixtures(mock, log);
  return mock;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = process.env.MOCK_PORT === undefined ? 5567 : Number(process.env.MOCK_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("MOCK_PORT must be an integer from 1 to 65535.");
  const mock = createMockServer({ port });
  console.log(`[mock-model] ${await mock.start()}/v1 (aimock; gpt-4o; deterministic BYOK demo)`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void mock.stop(); });
}
