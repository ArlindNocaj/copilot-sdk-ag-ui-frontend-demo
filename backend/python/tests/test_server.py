"""Local request boundary and all twelve real factory registrations, without inference."""

import json
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from test_agent import TEXT_TURN, FakeClient, make_input

import server
from agents.base import HERMETIC

BASE_URL = "http://127.0.0.1:8027"


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    for name in ("HOST", "PORT", "FRONTEND_ORIGIN", "OPENAI_BASE_URL", "OPENAI_CHAT_MODEL_ID"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def native(monkeypatch):
    client = FakeClient(TEXT_TURN)
    client.start = AsyncMock()
    client.stop = AsyncMock()
    options = {}

    def create_client(**kwargs):
        options.update(kwargs)
        return client

    monkeypatch.setattr(server, "CopilotClient", create_client)
    return client, options


@pytest.fixture
def http(native):
    with TestClient(server.create_app(), base_url=BASE_URL) as client:
        yield client


@pytest.mark.parametrize("feature", server.AGENT_FACTORIES)
def test_all_features_stream_with_hermetic_defaults(http, native, feature):
    assert len(server.AGENT_FACTORIES) == 12
    assert http.get("/health").json() == {"status": "healthy", "agents": 12}
    assert http.get(f"/{feature}/health").json()["agent"]["name"] == feature
    response = http.post(f"/{feature}", json=make_input().model_dump(by_alias=True))
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = [
        json.loads(line.removeprefix("data: "))
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]
    assert events[0]["type"] == "RUN_STARTED"
    assert events[-1]["type"] == "RUN_FINISHED"
    assert "Hello there" == "".join(
        event["delta"] for event in events if event["type"] == "TEXT_MESSAGE_CONTENT"
    )
    client, options = native
    assert options["mode"] == "empty"
    assert options["use_logged_in_user"] is True
    assert all(client.options[key] == value for key, value in HERMETIC.items())
    allowed = ["custom:*"]
    if feature in ("subgraphs", "deepagents_subagents"):
        allowed.append("builtin:task")
    assert client.options["available_tools"] == allowed
    assert "on_permission_request" not in client.options


def test_sdk_lifecycle_closes_native_sessions(native):
    client, _ = native
    with TestClient(server.create_app(), base_url=BASE_URL) as http:
        http.post("/agentic_chat", json=make_input().model_dump(by_alias=True))
        client.start.assert_awaited_once()
        assert not client.session.aborted
    assert client.session.aborted
    client.stop.assert_awaited_once()


def test_byok_configuration_still_uses_real_adapter(native, monkeypatch):
    monkeypatch.setenv("OPENAI_BASE_URL", "http://127.0.0.1:9000/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "test-only")
    monkeypatch.setenv("OPENAI_CHAT_MODEL_ID", "test-model")
    client, options = native
    with TestClient(server.create_app(), base_url=BASE_URL) as http:
        http.post("/agentic_chat", json=make_input().model_dump(by_alias=True))
    assert options["use_logged_in_user"] is False
    assert client.options["model"] == "test-model"
    assert client.options["provider"] == {
        "type": "openai",
        "base_url": "http://127.0.0.1:9000/v1",
        "api_key": "test-only",
    }


@pytest.mark.parametrize("host", ["127.0.0.1:8027", "localhost:8027", "[::1]:8027"])
def test_exact_loopback_hosts_are_accepted(http, host):
    assert http.get("/health", headers={"host": host}).status_code == 200


@pytest.mark.parametrize(
    "host",
    ["evil.example:8027", "127.0.0.1", "127.0.0.1:3000", "localhost:80", "127.0.0.1:8027.evil"],
)
def test_other_hosts_are_rejected_before_inference(http, native, host):
    response = http.post(
        "/agentic_chat",
        headers={"host": host},
        json=make_input().model_dump(by_alias=True),
    )
    assert response.status_code == 400
    assert "Host" in response.json()["detail"]
    assert native[0].session is None


@pytest.mark.parametrize(
    "origin",
    ["https://evil.example", "null", "http://localhost:3000", "http://127.0.0.1:3000.evil"],
)
def test_unsolicited_browser_origins_are_rejected(http, native, origin):
    response = http.post(
        "/agentic_chat",
        headers={"origin": origin},
        json=make_input().model_dump(by_alias=True),
    )
    assert response.status_code == 403
    assert native[0].session is None
    assert "access-control-allow-origin" not in response.headers


def test_configured_origin_and_port(monkeypatch, native):
    monkeypatch.setenv("PORT", "8127")
    monkeypatch.setenv("FRONTEND_ORIGIN", "http://localhost:3001")
    with TestClient(server.create_app(), base_url="http://localhost:8127") as http:
        assert http.get("/health", headers={"origin": "http://localhost:3001"}).status_code == 200
        assert http.get("/health", headers={"origin": "http://127.0.0.1:3000"}).status_code == 403
        assert http.get("/health", headers={"host": "localhost:8027"}).status_code == 400


@pytest.mark.parametrize(
    ("headers", "status"),
    [
        ([("host", "127.0.0.1:8027"), ("host", "evil.example:8027")], 400),
        ([("origin", "http://127.0.0.1:3000"), ("origin", "https://evil.example")], 403),
        ([("content-type", "application/json"), ("content-type", "text/plain")], 415),
        ([("content-length", "2"), ("content-length", "3")], 400),
        ([("content-length", "-1")], 400),
        ([("content-length", "many")], 400),
        ([("content-length", "9" * 5000)], 400),
    ],
)
def test_ambiguous_or_malformed_headers_are_rejected(http, headers, status):
    assert http.post("/agentic_chat", headers=headers, json={}).status_code == status


@pytest.mark.parametrize("content_type", ["text/plain", "application/x-www-form-urlencoded", ""])
def test_posts_require_json(http, native, content_type):
    response = http.post("/agentic_chat", content="{}", headers={"content-type": content_type})
    assert response.status_code == 415
    assert native[0].session is None


@pytest.mark.parametrize("payload", ['{"invalid"', "{}", '{"messages": "not an array"}'])
def test_json_and_run_input_validation(http, native, payload):
    response = http.post(
        "/agentic_chat",
        content=payload,
        headers={"content-type": "application/json; charset=utf-8"},
    )
    assert response.status_code == 422
    assert native[0].session is None


@pytest.mark.parametrize("thread_id", ["", "a" * 129, "../other", "a b", "a/b", "tést", "t\n"])
def test_invalid_thread_ids_are_rejected(http, native, thread_id):
    data = make_input().model_dump(by_alias=True)
    data["threadId"] = thread_id
    response = http.post("/agentic_chat", json=data)
    assert response.status_code == 422
    assert native[0].session is None


@pytest.mark.parametrize(("messages", "tools"), [(101, 0), (1, 9)])
def test_oversized_lists_are_rejected(http, native, messages, tools):
    data = make_input().model_dump(by_alias=True)
    data["messages"] = [
        {"id": f"u-{index}", "role": "user", "content": "Hello"} for index in range(messages)
    ]
    data["tools"] = [
        {"name": f"tool_{index}", "description": "demo", "parameters": {"type": "object"}}
        for index in range(tools)
    ]
    assert http.post("/agentic_chat", json=data).status_code == 422
    assert native[0].session is None


def test_run_limits_are_inclusive(http):
    data = make_input().model_dump(by_alias=True)
    data["threadId"] = "a-_" + "1" * 125
    data["messages"] = [
        {"id": f"u-{index}", "role": "user", "content": "Hello"} for index in range(100)
    ]
    data["tools"] = [
        {"name": f"tool_{index}", "description": "demo", "parameters": {"type": "object"}}
        for index in range(8)
    ]
    response = http.post("/agentic_chat", json=data)
    assert response.status_code == 200
    assert "RUN_FINISHED" in response.text


def test_default_origin_is_allowed_without_cors_wildcard(http):
    response = http.post(
        "/agentic_chat",
        json=make_input().model_dump(by_alias=True),
        headers={"origin": "http://127.0.0.1:3000"},
    )
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_body_length_limit(http, native):
    response = http.post(
        "/agentic_chat",
        json={},
        headers={"content-length": str(server.MAX_BODY_BYTES + 1)},
    )
    assert response.status_code == 413
    assert "4 MiB" in response.json()["detail"]
    assert native[0].session is None


async def test_chunked_body_limit_does_not_trust_content_length():
    downstream = AsyncMock()
    boundary = server.LocalRequestBoundary(downstream, port=8027, origin="http://127.0.0.1:3000")
    receive = AsyncMock(
        side_effect=[
            {"type": "http.request", "body": b" " * server.MAX_BODY_BYTES, "more_body": True},
            {"type": "http.request", "body": b"x", "more_body": False},
        ]
    )
    send = AsyncMock()
    await boundary(
        {
            "type": "http",
            "method": "POST",
            "headers": [(b"host", b"127.0.0.1:8027"), (b"content-type", b"application/json")],
        },
        receive,
        send,
    )
    assert send.await_args_list[0].args[0]["status"] == 413
    downstream.assert_not_awaited()


def test_body_at_limit_is_accepted(http):
    data = make_input().model_dump(by_alias=True)
    encoded = json.dumps(data).encode()
    response = http.post(
        "/agentic_chat",
        content=encoded + b" " * (server.MAX_BODY_BYTES - len(encoded)),
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 200
    assert "RUN_FINISHED" in response.text


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("HOST", "0.0.0.0"),
        ("HOST", "example.org"),
        ("PORT", "not-a-port"),
        ("PORT", "0"),
        ("PORT", "65536"),
        ("FRONTEND_ORIGIN", "*"),
        ("FRONTEND_ORIGIN", "https://evil.example"),
        ("FRONTEND_ORIGIN", "http://localhost:3000/"),
        ("FRONTEND_ORIGIN", "http://localhost:3000?query=1"),
        ("FRONTEND_ORIGIN", "http://user@localhost:3000"),
        ("FRONTEND_ORIGIN", "http://localhost:99999"),
    ],
)
def test_invalid_configuration_fails_before_start(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError):
        server.create_app()


def test_startup_error_is_actionable_and_client_stops(native):
    client, _ = native
    client.start.side_effect = RuntimeError("missing native runtime")
    with (
        pytest.raises(RuntimeError, match="Copilot SDK startup failed"),
        TestClient(server.create_app(), base_url=BASE_URL),
    ):
        pass
    client.stop.assert_awaited_once()
