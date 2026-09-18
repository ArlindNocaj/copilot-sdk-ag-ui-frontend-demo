"""Loopback-only server for the twelve verified Copilot SDK demos."""

import os
import re
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

import uvicorn
from ag_ui.core import RunAgentInput
from copilot import CopilotClient
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from ag_ui_copilot_sdk import add_copilot_fastapi_endpoint
from agents.agentic_chat import create_agentic_chat_agent
from agents.agentic_chat_multimodal import create_agentic_chat_multimodal_agent
from agents.agentic_chat_reasoning import create_agentic_chat_reasoning_agent
from agents.agentic_generative_ui import create_agentic_generative_ui_agent
from agents.backend_tool_rendering import create_backend_tool_rendering_agent
from agents.deepagents_subagents import create_deepagents_subagents_agent
from agents.human_in_the_loop import create_human_in_the_loop_agent
from agents.interrupt import create_interrupt_agent
from agents.predictive_state_updates import create_predictive_state_updates_agent
from agents.shared_state import create_shared_state_agent
from agents.subgraphs import create_subgraphs_agent
from agents.tool_based_generative_ui import create_tool_based_generative_ui_agent

MAX_BODY_BYTES = 4 * 1024 * 1024
LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")
AGENT_FACTORIES = {
    "agentic_chat": create_agentic_chat_agent,
    "agentic_chat_reasoning": create_agentic_chat_reasoning_agent,
    "agentic_chat_multimodal": create_agentic_chat_multimodal_agent,
    "backend_tool_rendering": create_backend_tool_rendering_agent,
    "human_in_the_loop": create_human_in_the_loop_agent,
    "tool_based_generative_ui": create_tool_based_generative_ui_agent,
    "shared_state": create_shared_state_agent,
    "agentic_generative_ui": create_agentic_generative_ui_agent,
    "predictive_state_updates": create_predictive_state_updates_agent,
    "interrupt": create_interrupt_agent,
    "deepagents_subagents": create_deepagents_subagents_agent,
    "subgraphs": create_subgraphs_agent,
}


def settings() -> tuple[str, int, str]:
    host = os.getenv("HOST", "127.0.0.1")
    if host not in LOOPBACK_HOSTS:
        raise ValueError("HOST must be 127.0.0.1, localhost, or ::1; this demo is local-only.")
    try:
        port = int(os.getenv("PORT", "8027"))
    except ValueError as exc:
        raise ValueError("PORT must be an integer between 1 and 65535.") from exc
    if not 1 <= port <= 65535:
        raise ValueError("PORT must be an integer between 1 and 65535.")
    origin = os.getenv("FRONTEND_ORIGIN", "http://127.0.0.1:3000")
    parsed = urlsplit(origin)
    if (
        parsed.scheme not in ("http", "https")
        or parsed.hostname not in LOOPBACK_HOSTS
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path
        or parsed.query
        or parsed.fragment
        or origin != f"{parsed.scheme}://{parsed.netloc}"
    ):
        raise ValueError("FRONTEND_ORIGIN must be one exact loopback http(s) origin, no path.")
    # Accessing .port also rejects malformed or out-of-range ports.
    if parsed.port == 0:
        raise ValueError("FRONTEND_ORIGIN must use a valid port.")
    return host, port, origin


def validate_run_input(input_data: RunAgentInput) -> None:
    if re.fullmatch(r"[\w-]{1,128}", input_data.thread_id, re.ASCII) is None:
        raise HTTPException(422, "threadId must contain 1–128 ASCII letters, digits, _ or -.")
    if len(input_data.messages) > 100:
        raise HTTPException(422, "At most 100 messages are allowed per run.")
    if len(input_data.tools) > 8:
        raise HTTPException(422, "At most 8 frontend tools are allowed per run.")


class LocalRequestBoundary:
    """Check browser authority and bound JSON before FastAPI parses the request."""

    def __init__(self, app: ASGIApp, *, port: int, origin: str):
        self.app = app
        self.hosts = {f"127.0.0.1:{port}", f"localhost:{port}", f"[::1]:{port}"}
        self.origin = origin

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers: dict[str, list[str]] = {}
        for key, value in scope["headers"]:
            headers.setdefault(key.decode("latin-1").lower(), []).append(value.decode("latin-1"))

        async def reject(status: int, detail: str) -> None:
            await JSONResponse({"detail": detail}, status_code=status)(scope, receive, send)

        hosts = headers.get("host", [])
        if len(hosts) != 1 or hosts[0] not in self.hosts:
            await reject(400, "Invalid Host: use the configured loopback host and port.")
            return
        if headers.get("origin", []) not in ([], [self.origin]):
            await reject(403, "Origin is not allowed; use the configured frontend proxy.")
            return
        if scope["method"] != "POST":
            await self.app(scope, receive, send)
            return

        content_types = headers.get("content-type", [])
        if (
            len(content_types) != 1
            or content_types[0].split(";", 1)[0].strip().lower() != "application/json"
        ):
            await reject(415, "Agent requests require Content-Type: application/json.")
            return
        lengths = headers.get("content-length", [])
        if (
            len(lengths) > 1
            or (lengths and not lengths[0].isascii())
            or (lengths and not lengths[0].isdigit())
        ):
            await reject(400, "Invalid Content-Length.")
            return
        try:
            length = int(lengths[0]) if lengths else 0
        except ValueError:
            await reject(400, "Invalid Content-Length.")
            return
        if length > MAX_BODY_BYTES:
            await reject(413, "JSON body exceeds the 4 MiB limit; use a smaller inline image.")
            return

        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > MAX_BODY_BYTES:
                await reject(413, "JSON body exceeds the 4 MiB limit; use a smaller inline image.")
                return
            body.extend(chunk)
            if not message.get("more_body", False):
                break

        replayed = False

        async def replay_body():
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay_body, send)


@asynccontextmanager
async def lifespan(app: FastAPI):
    runtime = Path(__file__).resolve().parent / ".runtime"
    runtime.mkdir(exist_ok=True)
    client = CopilotClient(
        mode="empty",
        log_level="error",
        base_directory=str(runtime),
        use_logged_in_user=not os.getenv("OPENAI_BASE_URL"),
    )
    agents = {}
    try:
        try:
            await client.start()
        except Exception as exc:
            raise RuntimeError(
                "Copilot SDK startup failed. Check the installed Copilot CLI/runtime and "
                "authenticate with Copilot, or configure OPENAI_BASE_URL, OPENAI_API_KEY, "
                "and OPENAI_CHAT_MODEL_ID for an OpenAI-compatible provider."
            ) from exc
        for name, factory in AGENT_FACTORIES.items():
            agent = agents[name] = factory(client)
            add_copilot_fastapi_endpoint(
                app=app,
                agent=agent,
                path=f"/{name}",
                dependencies=[Depends(validate_run_input)],
            )
        app.state.agents = agents
        yield
    finally:
        try:
            for agent in agents.values():
                await agent.close()
        finally:
            await client.stop()


def create_app() -> FastAPI:
    host, port, origin = settings()
    app = FastAPI(title="Standalone Copilot SDK demo", lifespan=lifespan)
    app.state.host = host
    app.state.port = port
    app.add_middleware(LocalRequestBoundary, port=port, origin=origin)

    @app.get("/health")
    async def health():
        return {
            "app": "copilot-sdk-ag-ui-frontend-demo",
            "status": "healthy",
            "backend": "python",
            "mode": "byok" if os.getenv("OPENAI_BASE_URL") else "copilot",
            "agents": list(AGENT_FACTORIES),
        }

    return app


app = create_app()


def main():
    uvicorn.run(
        app, host=app.state.host, port=app.state.port, log_level="info", proxy_headers=False
    )


if __name__ == "__main__":
    main()
