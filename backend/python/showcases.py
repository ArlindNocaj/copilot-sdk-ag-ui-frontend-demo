"""Authoritative workbench commands around the unchanged pinned adapter."""

import json
import logging

from ag_ui.core import RunAgentInput, RunErrorEvent, Tool
from ag_ui.encoder import EventEncoder
from fastapi import Request
from fastapi.responses import StreamingResponse

from agents.base import define_agent
from showcase_domain import CONTRACTS, ROOT, Conflict, Store

NAMES = ("release_readiness", "support_triage")
INSTRUCTIONS = (ROOT / "instructions.txt").read_text()
logger = logging.getLogger(__name__)


def register_showcases(app, client, agents, validate_run_input):
    store = app.state.workbench
    for name in NAMES:
        agent = define_agent(client, name=name, instructions=INSTRUCTIONS)
        agents[name] = agent
        register_run(app, agent, name, store, validate_run_input)


def register_run(app, agent, name, store: Store, validate_run_input):
    @app.post(f"/{name}")
    async def run(input_data: RunAgentInput, request: Request):
        validate_run_input(input_data)
        state = store.prompt(input_data.thread_id)
        workflow = "release" if name == "release_readiness" else "support"
        if state["workflow"] != workflow:
            raise Conflict("WORKFLOW_MISMATCH", "This thread belongs to another showcase.", 400)
        if (
            len(input_data.tools) != 1
            or input_data.tools[0].name != "review_plan"
            or input_data.context
            or input_data.forwarded_props
        ):
            raise Conflict(
                "INVALID_RUN", "Only review_plan and authoritative app state allowed.", 400
            )
        for message in input_data.messages:
            if message.role not in ("user", "assistant", "tool", "activity"):
                raise Conflict("INVALID_ROLE", "Unsupported message role.", 400)
            if message.role == "tool":
                store.verify_tool_result(
                    input_data.thread_id, message.tool_call_id, message.content
                )
            if message.role == "user" and not isinstance(message.content, str):
                raise Conflict("TEXT_ONLY", "Showcases accept fictional text only.", 400)
        input_data.state = state
        input_data.tools = [Tool.model_validate(CONTRACTS["tool"])]
        encoder = EventEncoder(accept=request.headers.get("accept"))

        async def events():
            pending = {}
            stream = agent.run(input_data)
            try:
                async for event in stream:
                    data = event.model_dump(mode="json", by_alias=True)
                    kind = data["type"]
                    if kind == "TOOL_CALL_START":
                        pending[data["toolCallId"]] = {"name": data["toolCallName"], "args": ""}
                    elif kind == "TOOL_CALL_ARGS" and data["toolCallId"] in pending:
                        pending[data["toolCallId"]]["args"] += data["delta"]
                    elif kind == "TOOL_CALL_END":
                        tool = pending.get(data["toolCallId"])
                        if tool and tool["name"] == "review_plan":
                            store.issued_tool(
                                input_data.thread_id, data["toolCallId"], json.loads(tool["args"])
                            )
                    yield encoder.encode(event)
            except Exception as error:
                logger.exception("Showcase run failed")
                yield encoder.encode(RunErrorEvent(message=str(error)))
            finally:
                await stream.aclose()

        return StreamingResponse(events(), media_type=encoder.get_content_type())
