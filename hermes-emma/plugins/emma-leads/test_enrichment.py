"""Offline tests for the enrichment waterfall (stdlib unittest, no network).

Run:  python3 -m unittest test_enrichment -v
"""

import unittest

import enrichment as E


class TestHelpers(unittest.TestCase):
    def test_pick_best_email_prefers_valid_professional(self):
        emails = [
            {"email": "jane.personal@gmail.com", "smtp_valid": "valid", "type": "personal"},
            {"email": "jane@acme.com", "smtp_valid": "valid", "type": "professional"},
        ]
        self.assertEqual(E.pick_best_email(emails)["email"], "jane@acme.com")

    def test_pick_best_email_empty(self):
        self.assertIsNone(E.pick_best_email([]))

    def test_pick_phone_prefers_recommended(self):
        phones = [
            {"e164": "+1555111", "recommended": False},
            {"e164": "+1555222", "recommended": True},
        ]
        self.assertEqual(E.pick_phone(phones), "+1555222")

    def test_delivery_gate(self):
        self.assertEqual(E.apply_delivery_gate("e@x.com", "+1555"), "new")
        self.assertEqual(E.apply_delivery_gate("e@x.com", None), "awaiting_phone")
        self.assertEqual(E.apply_delivery_gate(None, None), "needs_human_review")


class TestRocketReachClient(unittest.TestCase):
    def test_immediate_complete(self):
        def transport(method, url, headers, params=None, json_body=None):
            assert headers.get("Api-Key") == "k"
            return 200, {
                "id": 1, "status": "complete",
                "emails": [{"email": "j@acme.com", "smtp_valid": "valid", "type": "professional"}],
                "phones": [{"e164": "+1555", "recommended": True}],
            }
        rr = E.RocketReachClient("k", transport=transport)
        res = rr.lookup({"rr_id": 1})
        self.assertEqual(res["email"], "j@acme.com")
        self.assertEqual(res["phone"], "+1555")

    def test_polls_when_searching(self):
        calls = {"n": 0}

        def transport(method, url, headers, params=None, json_body=None):
            if url.endswith("/person/lookup"):
                return 200, {"id": 7, "status": "searching", "emails": [], "phones": []}
            # checkStatus → now complete
            calls["n"] += 1
            return 200, [{"id": 7, "status": "complete",
                          "emails": [{"email": "p@x.com", "smtp_valid": "valid"}],
                          "phones": [{"number": "+199"}]}]
        rr = E.RocketReachClient("k", transport=transport, poll_wait=0, poll_attempts=3)
        res = rr.lookup({"linkedin_url": "li/p"})
        self.assertEqual(res["email"], "p@x.com")
        self.assertEqual(res["phone"], "+199")
        self.assertGreaterEqual(calls["n"], 1)  # actually polled

    def test_search_then_lookup_by_id(self):
        # name+company has no rr_id/linkedin -> must SEARCH for the id, then lookup by id
        def transport(method, url, headers, params=None, json_body=None):
            if method == "POST" and url.endswith("/person/search"):
                assert json_body["query"]["name"] == ["Jane Smith"]
                return 201, {"profiles": [{"id": 42, "linkedin_url": "li/jane"}], "pagination": {"total": 1}}
            if method == "GET" and url.endswith("/person/lookup"):
                assert params.get("id") == 42  # used the searched id, NOT name+employer
                return 200, {"id": 42, "status": "complete",
                             "emails": [{"email": "jane@acme.com", "smtp_valid": "valid", "type": "professional"}],
                             "phones": [{"e164": "+1555", "recommended": True}]}
            return 404, {}
        rr = E.RocketReachClient("k", transport=transport)
        res = rr.lookup({"name": "Jane Smith", "company": "Acme"})
        self.assertEqual(res["email"], "jane@acme.com")
        self.assertEqual(res["phone"], "+1555")

    def test_search_no_match_returns_no_match(self):
        # RR has no profile -> no_match, never a guessed/wrong contact
        def transport(method, url, headers, params=None, json_body=None):
            if url.endswith("/person/search"):
                return 201, {"profiles": [], "pagination": {"total": 0}}
            return 404, {}
        rr = E.RocketReachClient("k", transport=transport)
        res = rr.lookup({"name": "Nobody Here", "company": "Nowhere"})
        self.assertEqual(res["status"], "no_match")
        self.assertIsNone(res["email"])


class TestApolloClient(unittest.TestCase):
    def test_match_returns_email_and_phone(self):
        def transport(method, url, headers, params=None, json_body=None):
            assert headers.get("X-Api-Key") == "ak"
            assert json_body["first_name"] == "Jane"
            return 200, {"person": {"email": "j@acme.com",
                                    "phone_numbers": [{"sanitized_number": "+1555"}]}}
        ap = E.ApolloClient("ak", transport=transport)
        res = ap.match({"name": "Jane Smith", "company": "Acme"})
        self.assertEqual(res["email"], "j@acme.com")
        self.assertEqual(res["phone"], "+1555")

    def test_locked_email_is_dropped(self):
        def transport(method, url, headers, params=None, json_body=None):
            return 200, {"person": {"email": "email_not_unlocked@domain.com", "phone_numbers": []}}
        ap = E.ApolloClient("ak", transport=transport)
        self.assertIsNone(ap.match({"name": "A B", "company": "C"})["email"])


# Tiny fakes for orchestration tests
class FakeRR:
    def __init__(self, res):
        self.res, self.calls = res, 0
    def lookup(self, person):
        self.calls += 1
        return {"email": None, "phone": None, "status": "complete", "rr_id": None, "email_status": None, **self.res}


class FakeApollo:
    def __init__(self, res):
        self.res, self.calls = res, 0
    def match(self, person, reveal_email=True, reveal_phone=True):
        self.calls += 1
        return {"email": None, "phone": None, **self.res}


class TestWaterfall(unittest.TestCase):
    def test_rr_returns_both_apollo_not_called(self):
        rr = FakeRR({"email": "e@x.com", "phone": "+1"})
        ap = FakeApollo({})
        res = E.run_waterfall({"name": "A B", "company": "C"}, rr, ap)
        self.assertEqual(res["status"], "new")
        self.assertEqual(ap.calls, 0)  # no credit spent on a complete RR result
        self.assertEqual(res["sources"], ["rocketreach:email", "rocketreach:phone"])

    def test_apollo_fills_missing_phone(self):
        rr = FakeRR({"email": "e@x.com", "phone": None})
        ap = FakeApollo({"phone": "+199"})
        res = E.run_waterfall({"name": "A B", "company": "C"}, rr, ap)
        self.assertEqual(res["status"], "new")
        self.assertEqual(res["phone"], "+199")
        self.assertIn("apollo:phone", res["sources"])

    def test_email_only_holds_as_awaiting_phone(self):
        rr = FakeRR({})
        ap = FakeApollo({"email": "e@x.com"})
        res = E.run_waterfall({"name": "A B", "company": "C"}, rr, ap)
        self.assertEqual(res["status"], "awaiting_phone")

    def test_neither_found_needs_review(self):
        res = E.run_waterfall({"name": "A B", "company": "C"}, FakeRR({}), FakeApollo({}))
        self.assertEqual(res["status"], "needs_human_review")

    def test_no_apollo_key_degrades_gracefully(self):
        rr = FakeRR({"email": "e@x.com"})
        res = E.run_waterfall({"name": "A B", "company": "C"}, rr, None)
        self.assertEqual(res["status"], "awaiting_phone")


if __name__ == "__main__":
    unittest.main()
