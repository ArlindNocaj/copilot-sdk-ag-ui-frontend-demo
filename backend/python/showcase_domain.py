"""Matching app-owned state transitions; no TypeScript service is called here."""

import json
from copy import deepcopy
from functools import cmp_to_key
from pathlib import Path
from uuid import uuid4

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parent / "showcase_data"
FIXTURES = json.loads((ROOT / "fixtures.json").read_text())
MEASUREMENT = FIXTURES["metadata"]
CONTRACTS = json.loads((ROOT / "contracts.json").read_text())
PLAN = Draft202012Validator(CONTRACTS["plan"], format_checker=FormatChecker())
COMMAND = Draft202012Validator(CONTRACTS["command"], format_checker=FormatChecker())


class Conflict(Exception):
    def __init__(self, code, message, status=409):
        super().__init__(message)
        self.code, self.status = code, status


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def validate(value, schema):
    value = deepcopy(value)
    if isinstance(value, dict):
        for action in (
            value.get("actions", []) if isinstance(value.get("actions", []), list) else []
        ):
            if isinstance(action, dict) and isinstance(action.get("title"), str):
                action["title"] = action["title"].strip()
        for decision in (
            value.get("decisions", []) if isinstance(value.get("decisions", []), list) else []
        ):
            if isinstance(decision, dict) and isinstance(decision.get("title"), str):
                decision["title"] = decision["title"].strip()
        if isinstance(value.get("plan"), dict):
            value["plan"] = validate(value["plan"], PLAN)
    schema.validate(value)
    return value


def initial_state(workflow):
    return {
        "workflow": workflow,
        "revision": 0,
        "view": {"chart": "bars", "metric": "failures", "group": "product", "filter": "all"}
        if workflow == "release"
        else {"chart": "bars", "metric": "open-tickets", "group": "owner", "filter": "open"},
        "items": deepcopy(FIXTURES[workflow]),
        "work": [],
        "proposal": None,
        "draft": "",
        "receipts": [],
        "audit": ["Fictional workspace initialized."],
    }


def valid_view(workflow, view):
    return view["chart"] in ("bars", "table") and (
        view["metric"] in ("failures", "failure-rate")
        and view["group"] in ("product", "priority")
        and view["filter"] in ("all", "open", "urgent")
        if workflow == "release"
        else view["metric"] in ("open-tickets", "age-distribution", "overdue-tickets")
        and view["group"] in ("owner", "priority")
        and view["filter"] in ("open", "urgent")
    )


def assert_view(workflow, view):
    if not valid_view(workflow, view):
        raise Conflict(
            "INVALID_VIEW", "Choose a metric, group and scope supported by this workflow.", 400
        )


def is_overdue(item):
    return (
        item["status"] == "open"
        and item.get("ageHours", 0) > MEASUREMENT["slaHours"][item["priority"]]
    )


def age_bucket(hours):
    return 0 if hours < 8 else 1 if hours < 24 else 2 if hours < 72 else 3


def aggregate(state):
    assert_view(state["workflow"], state["view"])
    labels = (
        ["Avery", "Blair", "Casey", "Dana"]
        if state["view"]["group"] == "owner"
        else ["P1", "P2", "P3"]
        if state["view"]["group"] == "priority"
        else ["Catalog", "Checkout", "Identity", "Payments"]
    )
    groups = {
        label: {
            "label": label,
            "count": 0,
            "failures": 0,
            "attempts": 0,
            "ageHoursSum": 0,
            "overdue": 0,
            "ageBuckets": [0, 0, 0, 0],
            "smallSample": False,
        }
        for label in labels
    }
    for item in state["items"]:
        if state["workflow"] == "support" and item["status"] != "open":
            continue
        selected = state["view"]["filter"]
        if selected == "urgent" and not (item["priority"] == "P1" and item["status"] == "open"):
            continue
        if selected == "open" and item["status"] != "open":
            continue
        label = item[state["view"]["group"]]
        row = groups[label]
        row["count"] += 1
        if state["workflow"] == "release":
            row["failures"] += item["failedBuilds"]
            row["attempts"] += item["buildAttempts"]
        else:
            row["ageHoursSum"] += item["ageHours"]
            row["overdue"] += int(is_overdue(item))
            row["ageBuckets"][age_bucket(item["ageHours"])] += 1
    for row in groups.values():
        row["smallSample"] = (
            state["workflow"] == "release"
            and 0 < row["attempts"] < MEASUREMENT["smallSampleAttempts"]
        )

    def compare(a, b):
        metric = state["view"]["metric"]
        if metric == "failure-rate":
            difference = (
                int(b["attempts"] > 0) - int(a["attempts"] > 0)
                or b["failures"] * a["attempts"] - a["failures"] * b["attempts"]
            )
        elif metric == "age-distribution":
            difference = (
                int(b["count"] > 0) - int(a["count"] > 0)
                or b["ageHoursSum"] * a["count"] - a["ageHoursSum"] * b["count"]
            )
        else:
            field = (
                "failures"
                if metric == "failures"
                else "overdue"
                if metric == "overdue-tickets"
                else "count"
            )
            difference = b[field] - a[field]
        return difference or ((a["label"] > b["label"]) - (a["label"] < b["label"]))

    return sorted(groups.values(), key=cmp_to_key(compare))


def expect_revision(state, expected):
    if state["revision"] != expected:
        raise Conflict(
            "STALE_REVISION",
            f"Workspace changed to revision {state['revision']}. Refresh and review again; nothing was applied.",
        )


def chart_totals(rows):
    return {
        field: sum(row[field] for row in rows)
        for field in ("count", "failures", "attempts", "ageHoursSum", "overdue")
    }


class Store:
    # ponytail: one local process; use durable transactions for restart recovery or multi-user deployment.
    def __init__(self):
        self.states, self.submissions, self.issued, self.receipts = {}, {}, {}, {}

    def get(self, thread):
        if thread not in self.states:
            raise Conflict("UNKNOWN_WORKSPACE", "Open a new workspace first.", 404)
        return deepcopy(self.states[thread])

    def issued_tool(self, thread, tool_call_id, args):
        self.issued[(thread, tool_call_id)] = {"args": canonical(validate(args, PLAN))}

    def verify_tool_result(self, thread, tool_call_id, content):
        try:
            actual = json.loads(content)
            actual_digest = canonical(actual)
        except (ValueError, TypeError):
            raise Conflict("INVALID_RECEIPT", "Unrecognized tool receipt.", 403)
        expected = self.receipts.get((thread, tool_call_id))
        if expected is None or actual_digest != canonical(expected):
            raise Conflict(
                "INVALID_RECEIPT",
                "Only the app-owned approval receipt can continue this tool.",
                403,
            )

    def prompt(self, thread):
        state = self.get(thread)
        rows = aggregate(state)
        return {
            **state,
            "measurement": MEASUREMENT,
            "computedChart": rows,
            "computedTotals": chart_totals(rows),
        }

    def execute(self, raw):
        cmd = validate(raw, COMMAND)
        thread, op = cmd["threadId"], cmd["op"]
        if op == "init":
            if thread in self.states:
                state = self.get(thread)
                if state["workflow"] != cmd["workflow"]:
                    raise Conflict("WORKFLOW_MISMATCH", "Start a new workspace to change workflow.")
                return {"state": state}
            if len(self.states) >= 24:
                raise Conflict("CAPACITY", "Workspace capacity reached; restart the demo.", 429)
            self.states[thread] = initial_state(cmd["workflow"])
            return {"state": self.get(thread)}
        state = self.get(thread)
        if op == "read":
            return {"state": state}
        if len(state["audit"]) >= 150:
            raise Conflict("CAPACITY", "Demo change limit reached; start a new workspace.", 429)
        if op == "stage":
            issued = self.issued.get((thread, cmd["toolCallId"]))
            plan = cmd["plan"]
            assert_view(state["workflow"], plan)
            if not issued or canonical(plan) != issued["args"]:
                raise Conflict(
                    "UNISSUED_PLAN", "Only a plan requested by the live model can be staged.", 403
                )
            if "result" in issued:
                return deepcopy(issued["result"])
            if state["proposal"]:
                raise Conflict(
                    "PENDING_REVIEW", "Complete the current review before proposing more work."
                )
            if len({a["id"] for a in plan["actions"]}) != len(plan["actions"]):
                raise Conflict("INVALID_PLAN", "Proposal action IDs must be unique.", 400)
            for action in plan["actions"]:
                if not any(
                    i["id"] == action["target"] and i["status"] == "open" for i in state["items"]
                ):
                    raise Conflict(
                        "INVALID_PLAN", "Proposal must reference an open fictional item.", 400
                    )
                if (state["workflow"] == "release") != (action["kind"] == "task"):
                    raise Conflict(
                        "INVALID_PLAN", "Action kind does not belong to this workflow.", 400
                    )
            state["revision"] += 1
            state["view"] = {key: plan[key] for key in ("chart", "metric", "group", "filter")}
            state["proposal"] = {
                **plan,
                "id": str(uuid4()),
                "toolCallId": cmd["toolCallId"],
                "basedOn": state["revision"],
            }
            state["audit"].append(
                f"Agent proposed {len(plan['actions'])} actions; review required."
            )
            self.states[thread] = state
            issued["result"] = {"state": deepcopy(state)}
            return deepcopy(issued["result"])
        if op == "commit":
            key, digest = (thread, cmd["submissionId"]), canonical(cmd)
            previous = self.submissions.get(key)
            if previous:
                if previous["digest"] != digest:
                    raise Conflict(
                        "DUPLICATE_CONFLICT",
                        "This submission ID was already used with different decisions.",
                    )
                return {"state": state, "receipt": deepcopy(previous["receipt"]), "duplicate": True}
            expect_revision(state, cmd["expectedRevision"])
            proposal = state["proposal"]
            if not proposal or proposal["id"] != cmd["proposalId"]:
                raise Conflict(
                    "NO_PENDING_PROPOSAL",
                    "This proposal has already been decided or is no longer current.",
                )
            decisions = {d["actionId"]: d for d in cmd["decisions"]}
            if len(decisions) != len(cmd["decisions"]) or set(decisions) != {
                a["id"] for a in proposal["actions"]
            }:
                raise Conflict(
                    "INVALID_DECISIONS", "Each proposal needs exactly one explicit decision.", 400
                )
            accepted = []
            for action in proposal["actions"]:
                edit = decisions[action["id"]]
                if edit["accept"]:
                    accepted.append(
                        {
                            **action,
                            "id": f"{proposal['id']}:{action['id']}",
                            "owner": edit["owner"],
                            "title": edit["title"],
                            "status": "open",
                        }
                    )
            receipt = {
                "nonce": str(uuid4()),
                "proposalId": proposal["id"],
                "revision": state["revision"] + 1,
                "accepted": [{k: a[k] for k in ("id", "title", "owner")} for a in accepted],
                "rejected": [d["actionId"] for d in cmd["decisions"] if not d["accept"]],
                "draftSaved": cmd["saveDraft"] and state["workflow"] == "support",
                "view": deepcopy(state["view"]),
            }
            state.update(revision=receipt["revision"], proposal=None)
            state["work"].extend(accepted)
            for item in state["items"]:
                assignment = next(
                    (a for a in accepted if a["kind"] == "assign" and a["target"] == item["id"]),
                    None,
                )
                if assignment:
                    item["owner"] = assignment["owner"]
            if receipt["draftSaved"]:
                state["draft"] = cmd["draft"]
            state["receipts"].append(receipt)
            state["audit"].append(
                f"{len(receipt['accepted'])} approved, {len(receipt['rejected'])} rejected. "
                + ("Draft saved only; not sent." if receipt["draftSaved"] else "No reply sent.")
            )
            self.states[thread] = state
            self.submissions[key] = {"digest": digest, "receipt": deepcopy(receipt)}
            self.receipts[(thread, proposal["toolCallId"])] = deepcopy(receipt)
            return {"state": deepcopy(state), "receipt": deepcopy(receipt)}
        expect_revision(state, cmd["expectedRevision"])
        if op == "view":
            assert_view(state["workflow"], cmd["view"])
            state["view"] = deepcopy(cmd["view"])
            view = state["view"]
            state["audit"].append(
                f"User changed chart to {view['metric']} / {view['chart']} / {view['group']} / {view['filter']}."
            )
        else:
            target = cmd["target"]
            if not any(i["id"] == target and i["status"] == "open" for i in state["items"]):
                raise Conflict("ALREADY_COMPLETE", "Item is missing or already complete.")
            for item in state["items"]:
                if item["id"] == target:
                    item["status"] = "done"
            for work in state["work"]:
                if work["target"] == target:
                    work["status"] = "done"
            state["audit"].append(
                f"User manually {'resolved' if state['workflow'] == 'support' else 'completed'} {target}."
            )
        state["revision"] += 1
        self.states[thread] = state
        return {"state": deepcopy(state)}
