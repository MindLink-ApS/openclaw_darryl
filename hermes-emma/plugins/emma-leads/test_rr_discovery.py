"""Offline tests for the deterministic RR discovery+enrichment engine.

Run:  python3 -m unittest test_rr_discovery -v
No network: a fake RR (search/lookup/account) + a fake leads DB are injected.
"""

import unittest

import rr_discovery as RD


# ── fakes ────────────────────────────────────────────────────────────────────

class FakeRR:
    def __init__(self, profiles, contacts, credits_seq):
        self._profiles = profiles                # returned by search(start=1)
        self._contacts = contacts                # rr_id -> {email, phone}
        self._credits = list(credits_seq)        # consumed by account() calls
        self._i = 0
        self.search_calls = 0
        self.lookup_ids = []

    def account(self):
        c = self._credits[self._i] if self._i < len(self._credits) else self._credits[-1]
        self._i += 1
        return {"credit_usage": [{"credit_type": "premium_lookup", "used": 0, "remaining": c}]}

    def search(self, q, order_by="relevance", page_size=25, start=1):
        self.search_calls += 1
        return list(self._profiles) if start == 1 else []   # one page

    def lookup(self, person):
        rid = person.get("rr_id")
        self.lookup_ids.append(rid)
        c = self._contacts.get(rid, {})
        return {"email": c.get("email"), "phone": c.get("phone"),
                "status": "complete", "rr_id": rid}


class FakeDB:
    def __init__(self, existing_names=None):
        self.existing = set(existing_names or [])
        self.upserts = []

    def find_existing(self, name, company, linkedin, email):
        return name in self.existing

    def upsert(self, fields):
        self.upserts.append(fields)
        return len(self.upserts)


def prof(pid, name, title="Underwriter", emp="Acme Insurance Group", cc="US", li=None):
    return {"id": pid, "name": name, "current_title": title,
            "current_employer": emp, "country_code": cc, "linkedin_url": li,
            "location": "New York, NY, US"}


# ── ICP filter ───────────────────────────────────────────────────────────────

class TestICP(unittest.TestCase):
    def test_keeps_us_pc(self):
        self.assertTrue(RD.is_icp(prof(1, "Al Pace", emp="RT Specialty", cc="US")))

    def test_excludes_non_us(self):
        self.assertFalse(RD.is_icp(prof(1, "Al Pace", emp="RT Specialty", cc="GB")))

    def test_excludes_life_health(self):
        self.assertFalse(RD.is_icp(prof(1, "B C", emp="UnitedHealthcare", cc="US")))
        self.assertFalse(RD.is_icp(prof(1, "B C", emp="MetLife", cc="US")))
        self.assertFalse(RD.is_icp(prof(1, "B C", emp="Aetna Health Plan", cc="US")))

    def test_excludes_empty_employer(self):
        self.assertFalse(RD.is_icp(prof(1, "B C", emp="", cc="US")))


# ── the run loop ─────────────────────────────────────────────────────────────

class TestRun(unittest.TestCase):
    def _profiles(self):
        return [prof(10, "Al Pace"), prof(11, "Bea Lin"), prof(12, "Cy Ng")]

    def test_happy_path_telemetry(self):
        rr = FakeRR(self._profiles(),
                    {10: {"email": "al@acme.com", "phone": "+1"},
                     11: {"email": "bea@acme.com", "phone": "+1"},
                     12: {"email": "cy@acme.com"}},          # email only -> awaiting_phone
                    credits_seq=[325, 322])
        db = FakeDB()
        s = RD.run(db, rr, max_lookups=25, credit_floor=25)
        self.assertEqual(s["searched"], 3)
        self.assertEqual(s["icp_passed"], 3)
        self.assertEqual(s["new_after_dedup"], 3)
        self.assertEqual(s["looked_up"], 3)
        self.assertEqual(s["delivered_new"], 2)
        self.assertEqual(s["awaiting_phone"], 1)
        self.assertEqual(s["credits_before"], 325)
        self.assertEqual(s["credits_after"], 322)
        self.assertEqual(s["credits_spent"], 3)
        self.assertFalse(s["zero_yield"])
        self.assertEqual(len(db.upserts), 3)

    def test_dedup_skips_before_spend(self):
        rr = FakeRR(self._profiles(), {10: {"email": "al@acme.com", "phone": "+1"}}, [325, 324])
        db = FakeDB(existing_names={"Bea Lin", "Cy Ng"})   # only Al is new
        s = RD.run(db, rr, max_lookups=25, credit_floor=25)
        self.assertEqual(s["new_after_dedup"], 1)
        self.assertEqual(s["looked_up"], 1)
        self.assertEqual(rr.lookup_ids, [10])              # never looked up the dupes

    def test_icp_filters_out_health(self):
        profs = [prof(10, "Al Pace", emp="RT Specialty"), prof(11, "Bea Lin", emp="Cigna")]
        rr = FakeRR(profs, {10: {"email": "al@acme.com", "phone": "+1"}}, [325, 324])
        s = RD.run(FakeDB(), rr, max_lookups=25, credit_floor=25)
        self.assertEqual(s["icp_passed"], 1)               # Cigna dropped
        self.assertEqual(s["looked_up"], 1)

    def test_per_run_cap(self):
        rr = FakeRR(self._profiles(),
                    {10: {"email": "a@x.com", "phone": "+1"}, 11: {"email": "b@x.com", "phone": "+1"},
                     12: {"email": "c@x.com", "phone": "+1"}}, [325, 323])
        s = RD.run(FakeDB(), rr, max_lookups=2, credit_floor=25)
        self.assertEqual(s["looked_up"], 2)
        self.assertTrue(s["capped"])

    def test_budget_floor_blocks_all_spend(self):
        rr = FakeRR(self._profiles(), {}, credits_seq=[20])   # below floor 25
        s = RD.run(FakeDB(), rr, max_lookups=25, credit_floor=25)
        self.assertTrue(s["budget_floor_hit"])
        self.assertTrue(s["zero_yield"])
        self.assertEqual(s["looked_up"], 0)
        self.assertEqual(rr.lookup_ids, [])
        self.assertEqual(rr.search_calls, 0)                 # didn't even search

    def test_budget_caps_to_remaining(self):
        # 27 remaining, floor 25 -> only 2 lookups allowed even though cap=25
        rr = FakeRR(self._profiles(),
                    {10: {"email": "a@x.com", "phone": "+1"}, 11: {"email": "b@x.com", "phone": "+1"},
                     12: {"email": "c@x.com", "phone": "+1"}}, [27, 25])
        s = RD.run(FakeDB(), rr, max_lookups=25, credit_floor=25)
        self.assertEqual(s["looked_up"], 2)
        self.assertTrue(s["capped"])

    def test_zero_yield_alert_when_no_contacts(self):
        rr = FakeRR(self._profiles(), {}, [325, 325])         # no contacts found
        s = RD.run(FakeDB(), rr, max_lookups=25, credit_floor=25)
        self.assertEqual(s["delivered_new"], 0)
        self.assertEqual(s["no_contact"], 3)
        self.assertTrue(s["zero_yield"])


if __name__ == "__main__":
    unittest.main()
