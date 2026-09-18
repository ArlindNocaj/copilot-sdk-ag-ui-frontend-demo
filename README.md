# GitHub Copilot SDK + AG-UI + CopilotKit

**A native GitHub Copilot SDK agent can drive a CopilotKit frontend through AG-UI, with the same UI and contracts in Python or TypeScript.** Start with twelve small examples: streamed chat, backend and frontend tools, shared state, human approval, interrupts, and native subagents.

This repository is **PRIVATE pending user review**. It is a local demo, not a production deployment template.

```mermaid
flowchart LR
  UI["CopilotKit frontend · Next.js :3310"] --> Proxy["Next.js runtime proxy"]
  Proxy -->|"AG-UI HTTP / SSE"| PY["Python adapter :8227"]
  Proxy -->|"AG-UI HTTP / SSE"| TS["TypeScript adapter :8228"]
  PY --> Runtime["GitHub Copilot SDK 1.0.14 / Copilot runtime"]
  TS --> Runtime
  Runtime --> Live["Logged-in Copilot model"]
  Runtime -->|"BYOK · test mode only"| Mock["Local OpenAI-compatible fixtures :5567"]
```

## Prerequisites

- Node **24.13.0 or newer**; pnpm **10.33.4** (`corepack enable` if needed).
- For Python: Python **3.11+** and uv (**0.9.29** used during development).
- A GitHub Copilot account/license with access to the selected model for live mode. Install the [Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/install-copilot-cli), run `copilot`, and use `/login`. The SDK starts its own native runtime; it does not shell out to a chat transcript or fake tool execution.
- Tests use Playwright's own Chromium, never an existing Edge/CDP profile: `pnpm exec playwright install chromium`.
- No database, Docker, external weather service, booking service, or API key is needed for deterministic mode.

## Quick start

```sh
git clone https://github.com/ArlindNocaj/copilot-sdk-ag-ui-frontend-demo.git
cd copilot-sdk-ag-ui-frontend-demo
pnpm install --frozen-lockfile
pnpm dev:typescript
```

Open **http://127.0.0.1:3310**. The command starts the TypeScript backend and frontend; Ctrl+C stops both.

Choose Python instead:

```sh
uv sync --project backend/python --extra server --frozen
pnpm dev:python
```

The same page routes work with either backend. The **Backend** selector reloads the page into a new conversation; the selected backend must be running. A one-backend start selects that backend by default.

For a repeatable demo without model charges or login:

```sh
pnpm dev:mock
```

This starts **both backends**, the frontend, and a small **local OpenAI-compatible fixture server**. Its scenarios adapt the verified Dojo aimock contracts without copying the old custom SDK fixture clients. The real SDK runtime calls this model endpoint via BYOK. It does **not** replace the adapter or fabricate AG-UI events. Mock prompts are deliberately fixture-specific; arbitrary prompts need live mode.

### Environment

| Variable | Default | Purpose |
|---|---|---|
| `COPILOT_MODEL` | `gpt-5.4-mini` | Live Copilot model available to your account |
| `OPENAI_BASE_URL` | unset | Opt into an OpenAI-compatible BYOK endpoint |
| `OPENAI_API_KEY` | unset | BYOK credential; never commit one |
| `OPENAI_CHAT_MODEL_ID` | `gpt-4o` | BYOK model ID |
| `DEMO_BACKEND` | `typescript` | Frontend default; root runner sets it |
| `DEMO_MODE` | live | Root mock runner sets `mock` for honest UI labeling |
| `TYPESCRIPT_BACKEND_URL` | `http://127.0.0.1:8228` | Server-side proxy destination, loopback HTTP only |
| `PYTHON_BACKEND_URL` | `http://127.0.0.1:8227` | Server-side proxy destination, loopback HTTP only |
| `FRONTEND_ORIGIN` | `http://127.0.0.1:3310` | Accepted browser origin at backend |
| `PORT` | 8227 Python / 8228 TS | Backend port when started directly |
| `HOST` | `127.0.0.1` | Loopback only; external binding is refused |

The root runner reserves 3310, 8227, 8228, and (mock only) 5567. It refuses occupied ports rather than reusing another service. Stop an existing demo before starting another.

## Simple examples

Each route uses the original verified agent/tool/state names. The UI is deliberately smaller than Dojo: semantic cards, checkboxes, a plain Markdown preview, and a native-subagent lifecycle panel, without Dojo's integration shell, source viewer, analytics, rich-text editor, carousel, or theme system.

| Route under `/features/` | What it demonstrates | Screenshots |
|---|---|---|
| `agentic_chat` | Native text deltas become chat messages | [TS](screenshots/simple/typescript/agentic_chat.png) / [Python](screenshots/simple/python/agentic_chat.png) |
| `backend_tool_rendering` | `get_weather` executes on the backend; its real result renders a card | [TS](screenshots/simple/typescript/backend_tool_rendering.png) / [Python](screenshots/simple/python/backend_tool_rendering.png) |
| `human_in_the_loop` | `generate_task_steps` pauses; edited selections resolve the original pending call | [TS](screenshots/simple/typescript/human_in_the_loop.png) / [Python](screenshots/simple/python/human_in_the_loop.png) |
| `tool_based_generative_ui` | Frontend `generate_haiku` renders a card | [TS](screenshots/simple/typescript/tool_based_generative_ui.png) / [Python](screenshots/simple/python/tool_based_generative_ui.png) |
| `shared_state` | Backend `generate_recipe` snapshots state; UI ingredient edits reach the next prompt | [TS](screenshots/simple/typescript/shared_state.png) / [Python](screenshots/simple/python/shared_state.png) |
| `agentic_generative_ui` | Predicted `steps` become committed completion snapshots | [TS](screenshots/simple/typescript/agentic_generative_ui.png) / [Python](screenshots/simple/python/agentic_generative_ui.png) |
| `predictive_state_updates` | `write_document` arguments predict state; approval commits, rejection restores | [TS](screenshots/simple/typescript/predictive_state_updates.png) / [Python](screenshots/simple/python/predictive_state_updates.png) |
| `agentic_chat_reasoning` | Provider-supplied `REASONING_*` events, separate from assistant text | [TS](screenshots/simple/typescript/agentic_chat_reasoning.png) / [Python](screenshots/simple/python/agentic_chat_reasoning.png) |
| `agentic_chat_multimodal` | Inline uploaded image becomes a native SDK blob attachment | [TS](screenshots/simple/typescript/agentic_chat_multimodal.png) / [Python](screenshots/simple/python/agentic_chat_multimodal.png) |
| `interrupt` | `schedule_meeting` pauses for a time choice or cancellation | [TS](screenshots/simple/typescript/interrupt.png) / [Python](screenshots/simple/python/interrupt.png) |
| `subgraphs` | Native flight, hotel, and experience specialists; choices survive pause/resume | [TS](screenshots/simple/typescript/subgraphs.png) / [Python](screenshots/simple/python/subgraphs.png) |
| `deepagents_subagents` | Native research subagent attribution and approve/reject interrupt | [TS](screenshots/simple/typescript/deepagents_subagents.png) / [Python](screenshots/simple/python/deepagents_subagents.png) |

Screenshot seed provenance: deterministic aimock browser run on verified integration commit **8665f1ee**. Standalone browser tests overwrite these with fresh captures as the scenarios pass.

## Checks

```sh
pnpm test              # typechecks, adapter units, fixture units, Python checks/build, Next/TS builds
pnpm test:e2e          # deterministic browser scenarios against both backends
pnpm test:live         # one logged-in real model chat per backend; separate from mock tests
```

Build the frontend with `pnpm build` before running the browser suite directly. Browser tests start the production frontend and both backend choices themselves, cover approval/rejection and alternate selections, and write fresh screenshots. Temporary traces/results stay ignored.

### Phase A checkpoint

| Check | TypeScript | Python |
|---|---|---|
| Type / unit checks | Typecheck and 16 adapter tests passed | 73 pytest tests and Ruff passed |
| Build | Backend and Next.js production build passed | Wheel and source distribution passed |
| Live `agentic_chat` | curl-level SDK flow passed: Paris + `RUN_FINISHED` | curl-level SDK flow passed: Paris + `RUN_FINISHED` |
| Twelve standalone browser scenarios | Not verified at this checkpoint | Not verified at this checkpoint |

The first browser attempt was blocked by a missing Playwright browser and a health-check contract mismatch, not counted as a pass. Chromium has since been installed; standalone browser results and fresh captures are still pending. The fixture server's eight unit/HTTP tests passed. Public-registry JavaScript installation was blocked on this network; mirror installation and a portable-lock frozen/offline reinstall passed.

## Source and dependency status

The Copilot SDK integration is a **fork PR, not a published integration package**:

- [Verified source commit 8665f1ee1aeb5fe7f873a850b20df9af0c4fbba2](https://github.com/ArlindNocaj/ag-ui/commit/8665f1ee1aeb5fe7f873a850b20df9af0c4fbba2)
- [Integration PR](https://github.com/ArlindNocaj/ag-ui/pull/1)

The small MIT-licensed adapters and twelve example definitions are copied from that commit into `backend/python/ag_ui_copilot_sdk`, `backend/python/agents`, `backend/typescript/src/ag_ui_copilot_sdk`, and `backend/typescript/src/agents`. TypeScript imports are adjusted to the standalone folder; the hosts add request-boundary checks. Adapter unit tests are copied/adapted from the same source. Frontend contracts and mock fixtures are adapted from its Dojo examples. Original AG-UI MIT terms are preserved in [LICENSE](LICENSE).

Vendoring is intentional: the upstream TypeScript manifest depends on monorepo `workspace:*` packages; cloning/building that monorepo during install would defeat this demo. Replace the vendored adapter import/package when a supported release is published. All runtime dependencies are pinned in package-manager locks.

## Security and production caveats

- **Unauthenticated loopback demo only.** Backend Host/Origin, JSON, body size, and AG-UI schema checks reduce accidental exposure; they are not authentication. Never reverse-proxy this app publicly.
- Native sessions and suspended tool calls live in a **bounded, in-process registry**. A process restart loses pending calls. Start a new conversation after restart. Multi-instance production hosting needs sticky routing plus deliberate session lifecycle/storage design.
- Copilot runs in **empty mode** with repository configuration discovery, skills, file hooks, host git operations, and session-store integration disabled. There is **no broad permission approval**. Only explicitly registered safe demo handlers bypass permission. Native subagents have narrow tool lists; shell and filesystem tools are not available.
- Weather is static, task completion is simulated, travel selections are not bookings, and the scheduler never touches a calendar. A model saying “scheduled” reflects the fictional tool result, not an external action.
- State, prompt, and frontend tool declarations are demo inputs, not authorization. In production, validate business commands and tool results against authoritative data.
- Uploaded image bytes are sent to the selected model. Do not upload confidential data. The demo accepts only inline PNG/JPEG/WebP up to 1 MiB; no remote media URL fetching.
- Reasoning display depends on provider/model support; mock reasoning is a test fixture, not proof that every live model emits reasoning.
- Deterministic tests exercise the real SDK/AG-UI/CopilotKit plumbing but cannot prove live model quality or business correctness. Live checks are reported separately.

## Troubleshooting

- **Connection refused:** run the backend selected in the page. Health endpoints are http://127.0.0.1:8228/health and http://127.0.0.1:8227/health.
- **Port in use:** stop your prior demo, rather than killing unrelated processes.
- **Model/auth failure:** run `copilot` and `/login`; confirm model access, or use `pnpm dev:mock`. BYOK intentionally bypasses logged-in Copilot authentication.
- **Expired pending call:** reload the page for a new conversation; backend restarts invalidate pending native RPCs.
- **Blocked package registry:** this development network blocks direct public npm/PyPI. Use an approved mirror or the existing verified cache. Locks must remain portable and contain no private registry URLs; do not paste credentials into configuration.
- **Next.js build warning:** CopilotKit's transitive AI provider imports can emit a dynamic-dependency webpack warning. This demo uses `HttpAgent`, not those provider adapters.
