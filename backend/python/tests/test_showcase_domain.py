import json
import unittest
from copy import deepcopy
from uuid import uuid4

from jsonschema import ValidationError

from showcase_domain import (
    MEASUREMENT,
    Conflict,
    Store,
    age_bucket,
    aggregate,
    initial_state,
    is_overdue,
)


def staged(workflow="release"):
    store, thread = Store(), str(uuid4())
    store.execute({"op": "init", "threadId": thread, "workflow": workflow})
    ids = (
        ["REL-CAT-01", "REL-CAT-02", "REL-PAY-01"]
        if workflow == "release"
        else ["SUP-BLA-03", "SUP-BLA-04", "SUP-DAN-04"]
    )
    kinds = ["task"] * 3 if workflow == "release" else ["assign", "assign", "escalate"]
    view = (
        {"chart": "bars", "metric": "failure-rate", "group": "product", "filter": "urgent"}
        if workflow == "release"
        else {"chart": "bars", "metric": "age-distribution", "group": "owner", "filter": "open"}
    )
    plan = {
        **view,
        "rationale": "Prioritize open issues.",
        "draft": "",
        "actions": [
            {
                "id": str(i),
                "target": target,
                "kind": kinds[i],
                "title": f"Investigate {target}",
                "owner": "Avery",
            }
            for i, target in enumerate(ids)
        ],
    }
    store.issued_tool(thread, "call-1", plan)
    state = store.execute(
        {"op": "stage", "threadId": thread, "toolCallId": "call-1", "plan": plan}
    )["state"]
    command = {
        "op": "commit",
        "threadId": thread,
        "submissionId": str(uuid4()),
        "proposalId": state["proposal"]["id"],
        "expectedRevision": state["revision"],
        "saveDraft": workflow == "support",
        "draft": "Saved locally. Next update tomorrow.",
        "decisions": [
            {
                "actionId": action["id"],
                "title": action["title"],
                "owner": "Dana" if i == 0 else "Avery",
                "accept": i < 2,
            }
            for i, action in enumerate(plan["actions"])
        ],
    }
    return store, thread, state, plan, command


class DomainTests(unittest.TestCase):
    def test_release_aggregation(self):
        state = initial_state("release")
        self.assertEqual(len(state["items"]), 40)
        self.assertEqual(sum(i["buildAttempts"] for i in state["items"]), 840)
        self.assertEqual(sum(i["failedBuilds"] for i in state["items"]), 95)
        self.assertTrue(all(0 <= i["failedBuilds"] <= i["buildAttempts"] for i in state["items"]))
        self.assertGreater(len({i["buildAttempts"] for i in state["items"]}), 15)
        self.assertEqual(
            [[r["label"], r["count"], r["attempts"], r["failures"]] for r in aggregate(state)],
            [
                ["Checkout", 14, 420, 42],
                ["Catalog", 12, 300, 27],
                ["Identity", 8, 80, 16],
                ["Payments", 6, 40, 10],
            ],
        )
        self.assertEqual(
            MEASUREMENT["releaseWindow"],
            {"start": "2026-09-11T06:00:00Z", "end": "2026-09-18T06:00:00Z"},
        )

    def test_rate_scope_reversal_and_sample_caution(self):
        state = initial_state("release")
        state["view"]["metric"] = "failure-rate"
        rows = aggregate(state)
        self.assertEqual(
            [r["label"] for r in rows], ["Payments", "Identity", "Checkout", "Catalog"]
        )
        all_rows = {r["label"]: r for r in rows}
        cat, chk = all_rows["Catalog"], all_rows["Checkout"]
        self.assertLess(cat["failures"] * chk["attempts"], chk["failures"] * cat["attempts"])
        self.assertFalse(all_rows["Payments"]["smallSample"])
        state["view"]["filter"] = "urgent"
        urgent = aggregate(state)
        self.assertEqual(
            [[r["label"], r["failures"], r["attempts"]] for r in urgent],
            [["Catalog", 18, 60], ["Identity", 5, 20], ["Payments", 3, 12], ["Checkout", 9, 90]],
        )
        self.assertGreater(
            urgent[0]["failures"] * urgent[3]["attempts"],
            urgent[3]["failures"] * urgent[0]["attempts"],
        )
        self.assertTrue(urgent[2]["smallSample"])
        self.assertEqual(
            [cat["failures"] - urgent[0]["failures"], cat["attempts"] - urgent[0]["attempts"]],
            [9, 240],
        )

    def test_zero_denominators_and_caution_boundary(self):
        state = initial_state("release")
        state["items"] = []
        self.assertTrue(
            all(
                r["attempts"] == r["failures"] == 0 and not r["smallSample"]
                for r in aggregate(state)
            )
        )
        for n in (0, 24, 25):
            row = deepcopy(initial_state("release")["items"][0])
            row.update(buildAttempts=n, failedBuilds=0)
            state["items"] = [row]
            actual = next(r for r in aggregate(state) if r["label"] == "Checkout")
            self.assertEqual(actual["smallSample"], 0 < n < 25)

    def test_support_aggregation(self):
        state = initial_state("support")
        self.assertEqual(len(state["items"]), 36)
        self.assertEqual(
            {
                owner: [
                    i["ageHours"]
                    for i in state["items"]
                    if i["owner"] == owner and i["status"] == "open" and i["priority"] == "P1"
                ]
                for owner in ("Avery", "Blair", "Casey", "Dana")
            },
            {"Avery": [2], "Blair": [10, 12], "Casey": [3], "Dana": [6, 7, 9, 20]},
        )
        self.assertEqual(
            [
                [r["label"], r["count"], r["ageHoursSum"], r["overdue"], r["ageBuckets"]]
                for r in aggregate(state)
            ],
            [
                ["Dana", 9, 117, 4, [2, 7, 0, 0]],
                ["Avery", 8, 64, 0, [3, 5, 0, 0]],
                ["Blair", 8, 272, 6, [0, 4, 2, 2]],
                ["Casey", 7, 84, 0, [1, 6, 0, 0]],
            ],
        )
        self.assertEqual(
            [
                sum(r[field] for r in aggregate(state))
                for field in ("count", "ageHoursSum", "overdue")
            ],
            [32, 537, 10],
        )
        state["view"].update(metric="age-distribution")
        self.assertEqual(aggregate(state)[0]["label"], "Blair")
        state["view"].update(metric="overdue-tickets", filter="urgent")
        self.assertEqual(
            [[r["label"], r["count"], r["ageHoursSum"], r["overdue"]] for r in aggregate(state)],
            [["Dana", 4, 42, 4], ["Blair", 2, 22, 2], ["Avery", 1, 2, 0], ["Casey", 1, 3, 0]],
        )
        for item in state["items"]:
            item["status"] = "done"
        self.assertTrue(
            all(r["count"] == r["ageHoursSum"] == r["overdue"] == 0 for r in aggregate(state))
        )

    def test_age_and_sla_boundaries_and_closed_exclusion(self):
        self.assertEqual(MEASUREMENT["ageBucketEdgesHours"], [0, 8, 24, 72])
        self.assertEqual(
            [age_bucket(age) for age in [0, 7, 8, 23, 24, 71, 72, 200]], [0, 0, 1, 1, 2, 2, 3, 3]
        )
        state = initial_state("support")
        for priority, hours in [("P1", 4), ("P2", 24), ("P3", 72)]:
            base = {**state["items"][0], "priority": priority, "ageHours": hours}
            self.assertFalse(is_overdue(base))
            self.assertTrue(is_overdue({**base, "ageHours": hours + 1}))
            self.assertFalse(is_overdue({**base, "ageHours": hours + 1, "status": "done"}))
        before = aggregate(state)
        for item in state["items"]:
            if item["status"] == "done":
                item["ageHours"] = 9999
        self.assertEqual(aggregate(state), before)

    def test_release_partial_approval(self):
        store, _, _, _, command = staged()
        result = store.execute(command)
        self.assertEqual(len(result["state"]["work"]), 2)
        self.assertEqual(result["state"]["work"][0]["owner"], "Dana")
        self.assertEqual(result["receipt"]["rejected"], ["2"])
        self.assertIsNone(result["state"]["proposal"])

    def test_support_draft_and_manual_followup(self):
        store, thread, _, _, command = staged("support")
        result = store.execute(command)
        self.assertEqual(
            next(i for i in result["state"]["items"] if i["id"] == "SUP-BLA-03")["owner"], "Dana"
        )
        self.assertFalse(any(work["kind"] == "escalate" for work in result["state"]["work"]))
        self.assertTrue(result["receipt"]["draftSaved"])
        rows = {r["label"]: r for r in aggregate(result["state"])}
        self.assertEqual(
            [sum(r[field] for r in rows.values()) for field in ("count", "ageHoursSum", "overdue")],
            [32, 537, 10],
        )
        self.assertEqual(rows["Dana"]["ageBuckets"], [2, 7, 1, 0])
        self.assertEqual(rows["Avery"]["ageBuckets"], [3, 5, 1, 0])
        self.assertEqual(rows["Blair"]["ageBuckets"], [0, 4, 0, 2])
        store.execute(
            {
                "op": "complete",
                "threadId": thread,
                "target": "SUP-BLA-03",
                "expectedRevision": result["state"]["revision"],
            }
        )
        fresh = store.prompt(thread)
        self.assertEqual(
            next(i for i in fresh["items"] if i["id"] == "SUP-BLA-03")["status"], "done"
        )
        self.assertEqual(
            [
                sum(r[field] for r in aggregate(fresh))
                for field in ("count", "ageHoursSum", "overdue")
            ],
            [31, 501, 9],
        )
        self.assertEqual(
            fresh["computedTotals"],
            {"count": 31, "failures": 0, "attempts": 0, "ageHoursSum": 501, "overdue": 9},
        )
        self.assertEqual(fresh["work"][0]["status"], "done")
        self.assertEqual(fresh["revision"], 3)
        self.assertEqual(fresh["draft"], command["draft"])

    def test_stale_approval(self):
        store, thread, state, _, command = staged()
        store.execute(
            {
                "op": "view",
                "threadId": thread,
                "expectedRevision": state["revision"],
                "view": {**state["view"], "filter": "all"},
            }
        )
        with self.assertRaises(Conflict) as failure:
            store.execute(command)
        self.assertEqual(failure.exception.code, "STALE_REVISION")
        self.assertEqual(store.get(thread)["work"], [])
        self.assertEqual(
            store.execute({**command, "expectedRevision": 2})["receipt"]["revision"], 3
        )

    def test_duplicate_idempotence(self):
        store, thread, _, _, command = staged()
        first = store.execute(command)
        store.execute(
            {
                "op": "complete",
                "threadId": thread,
                "target": "REL-CAT-01",
                "expectedRevision": first["state"]["revision"],
            }
        )
        second = store.execute(command)
        self.assertTrue(second["duplicate"])
        self.assertEqual(second["receipt"], first["receipt"])
        self.assertEqual(second["state"]["revision"], 3)
        self.assertEqual(len(second["state"]["work"]), 2)

    def test_changed_duplicate(self):
        store, _, _, _, command = staged()
        store.execute(command)
        with self.assertRaises(Conflict) as failure:
            store.execute({**command, "draft": "different"})
        self.assertEqual(failure.exception.code, "DUPLICATE_CONFLICT")
        with self.assertRaises(Conflict) as failure:
            store.execute({**command, "submissionId": str(uuid4()), "expectedRevision": 2})
        self.assertEqual(failure.exception.code, "NO_PENDING_PROPOSAL")

    def test_exact_native_receipt_only(self):
        store, thread, _, _, command = staged()
        receipt = store.execute(command)["receipt"]
        store.verify_tool_result(thread, "call-1", json.dumps(receipt))
        for call, value in [("unknown", receipt), ("call-1", {**receipt, "nonce": str(uuid4())})]:
            with self.assertRaises(Conflict):
                store.verify_tool_result(thread, call, json.dumps(value))

    def test_unissued_wrong_target_and_duplicate_actions(self):
        store, thread, _, plan, _ = staged()
        with self.assertRaises(Conflict):
            store.execute({"op": "stage", "threadId": thread, "toolCallId": "fake", "plan": plan})
        for actions in [
            [plan["actions"][0]] * 2,
            [{**plan["actions"][0], "target": "REAL-TICKET"}],
            [{**plan["actions"][0], "kind": "escalate"}],
        ]:
            fresh, identity = Store(), str(uuid4())
            fresh.execute({"op": "init", "threadId": identity, "workflow": "release"})
            malformed = {**plan, "actions": actions}
            fresh.issued_tool(identity, "bad", malformed)
            with self.assertRaises(Conflict):
                fresh.execute(
                    {"op": "stage", "threadId": identity, "toolCallId": "bad", "plan": malformed}
                )
            self.assertEqual(fresh.get(identity)["revision"], 0)

    def test_explicit_decisions_and_valid_owner(self):
        store, _, _, _, command = staged()
        for decisions in [
            command["decisions"][:2],
            [command["decisions"][0]] * 3,
            [{**d, "owner": "Unknown"} for d in command["decisions"]],
        ]:
            with self.assertRaises((Conflict, ValidationError)):
                store.execute({**command, "decisions": decisions})

    def test_isolated_read_and_completed_guard(self):
        store, thread, state, _, _ = staged()
        changed = store.get(thread)
        changed["items"][0]["title"] = "tampered"
        self.assertNotEqual(store.get(thread)["items"][0]["title"], "tampered")
        store.execute(
            {
                "op": "complete",
                "threadId": thread,
                "target": "REL-CAT-01",
                "expectedRevision": state["revision"],
            }
        )
        historical = store.get(thread)
        historical["view"]["filter"] = "all"
        self.assertEqual(
            [sum(r[field] for r in aggregate(historical)) for field in ("failures", "attempts")],
            [95, 840],
        )
        catalog = next(r for r in aggregate(store.get(thread)) if r["label"] == "Catalog")
        self.assertEqual([catalog["failures"], catalog["attempts"]], [10, 36])
        with self.assertRaises(Conflict):
            store.execute(
                {
                    "op": "complete",
                    "threadId": thread,
                    "target": "REL-CAT-01",
                    "expectedRevision": 2,
                }
            )

    def test_malformed_shapes_are_validation_errors(self):
        store, thread, _, plan, command = staged()
        for actions in [None, {}, [None], ["invalid"]]:
            with self.assertRaises(ValidationError):
                store.issued_tool(thread, "invalid", {**plan, "actions": actions})
        for decisions in [None, {}, [None]]:
            with self.assertRaises(ValidationError):
                store.execute({**command, "decisions": decisions})

    def test_rationale_bound_and_required_draft_are_not_weakened(self):
        store, thread, _, plan, _ = staged()
        missing = {k: v for k, v in plan.items() if k != "draft"}
        for invalid in [missing, {**plan, "rationale": "x" * 701}]:
            with self.assertRaises(ValidationError):
                store.issued_tool(thread, "invalid-contract", invalid)
            self.assertEqual(store.get(thread)["work"], [])


if __name__ == "__main__":
    unittest.main()
