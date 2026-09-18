# Standalone Python backend

The twelve agent factories and the small vendored AG-UI adapter are copied unchanged
from [the verified fork source commit](https://github.com/ArlindNocaj/ag-ui/tree/8665f1ee1aeb5fe7f873a850b20df9af0c4fbba2/integrations/copilot-sdk/python).
No checkout of that repository is needed. The source is MIT licensed; see
[LICENSE](./LICENSE).

From the repository root, install and run with Python 3.11+ and
[uv](https://docs.astral.sh/uv/):

```sh
uv sync --project backend/python --extra server --locked --default-index https://pypi.org/simple
uv run --project backend/python --extra server --locked --default-index https://pypi.org/simple copilot-ag-ui-demo
```

Use the machine's authenticated Copilot account, or set `OPENAI_BASE_URL`,
`OPENAI_API_KEY`, and `OPENAI_CHAT_MODEL_ID` for SDK BYOK. `COPILOT_MODEL` defaults
to `gpt-5.4-mini`; BYOK instead defaults to `gpt-4o` unless
`OPENAI_CHAT_MODEL_ID` is set. Model capabilities (images, reasoning, tool calls)
must be supported by the selected provider.

The defaults are `HOST=127.0.0.1`, `PORT=8227`, and
`FRONTEND_ORIGIN=http://127.0.0.1:3310`. Health is at
<http://127.0.0.1:8227/health> and identifies
`app="copilot-sdk-ag-ui-frontend-demo"`, `backend="python"`, and
`mode="copilot"` (or `"byok"` when `OPENAI_BASE_URL` is set). Check this identity
before treating an existing listener as this demo. POST AG-UI `RunAgentInput` JSON to:

```text
/agentic_chat                /agentic_chat_reasoning
/agentic_chat_multimodal     /backend_tool_rendering
/human_in_the_loop           /tool_based_generative_ui
/shared_state               /agentic_generative_ui
/predictive_state_updates    /interrupt
/deepagents_subagents        /subgraphs
/release_readiness           /support_triage
```

The twelve simple agents also provide `GET /{feature}/health`. Responses use AG-UI SSE, including
`RUN_ERROR` when a native session fails. Malformed JSON/schema, invalid Host,
foreign Origin, non-JSON POSTs, and bodies over 4 MiB are rejected before inference.
The size limit includes base64 overhead; use small inline images.
Thread IDs must contain 1–128 ASCII letters, digits, underscores, or hyphens.
Each run accepts at most 100 messages and 8 frontend tools.

The two rich routes use the same native SDK and pinned adapter, with an independent
Python authoritative store. `POST /workbench` initializes/reads the workspace,
changes views, stages model-issued plans, commits explicit decisions, and completes
fictional items. Rich runs accept only `review_plan`, replace client-supplied state
with server-owned state, and verify continuation receipts against recorded decisions.
The packaged `showcase_data` copy is checked against the root shared data by `pnpm test`.

This unauthenticated demo binds only to loopback. Only exact loopback Host headers
with the configured port are accepted. Browser Origin, when present, must equal
the one configured frontend origin; there is no wildcard CORS. Use the frontend's
same-origin proxy, not cross-origin browser requests. These checks do not
authenticate other local processes; do not expose this service through a tunnel.

The native client uses `mode="empty"`. Agent defaults disable config/instruction
discovery, file hooks, host Git access, the session store, and skills. Only declared
tools are enabled, with native `task` additionally enabled for subagent demos.
There is no blanket permission-approval handler. SDK runtime files stay in ignored
`backend/python/.runtime/`; suspended tool calls are process-local, so restart
with a fresh conversation after restarting the backend.

## Validation

```sh
uv lock --project backend/python --check
uv run --project backend/python --extra server --locked pytest backend/python/tests
uv run --project backend/python --extra server --locked ruff check backend/python
uv build --project backend/python
```

For disconnected environments add `--offline` to uv commands. A complete uv cache
is required, including the pinned public SDK wheel and the build backend; the lock
uses <https://pypi.org/simple> and public <https://files.pythonhosted.org> artifacts.
If an environment-level index setting overrides the project default, pass
`--default-index https://pypi.org/simple` explicitly, including to `uv lock --check`.
Tests use deterministic fake native events, not a real model. A healthy process
alone does not verify provider authentication or inference.
