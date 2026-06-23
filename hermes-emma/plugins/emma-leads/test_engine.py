"""Offline tests for the leads DB + dedup + RSS discovery (stdlib unittest).

Run:  python3 -m unittest test_engine -v
"""

import os
import tempfile
import unittest

import db as D
import discovery as DISC

RSS_SAMPLE = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Executives on the Move</title>
  <item>
    <title>RSUI Names Jane Smith Chief Development Officer</title>
    <link>https://www.carriermanagement.com/news/2026/06/18/289203.htm</link>
    <pubDate>Thu, 18 Jun 2026 12:09:33 +0000</pubDate>
    <guid>https://www.carriermanagement.com/?p=289203</guid>
    <description>RSUI announced Jane Smith joined as CDO.</description>
  </item>
  <item>
    <title>Acme Re Appoints Bob Lee VP Business Development</title>
    <link>https://www.carriermanagement.com/news/2026/06/15/289100.htm</link>
    <pubDate>Mon, 15 Jun 2026 09:00:00 +0000</pubDate>
    <guid>https://www.carriermanagement.com/?p=289100</guid>
    <description>Bob Lee named VP.</description>
  </item>
</channel></rss>"""


class TestDedup(unittest.TestCase):
    def test_identity_key_job_changer(self):
        # Same person, NEW company → different key (a new lead — the whole point).
        self.assertNotEqual(
            D.person_identity_key("Jane Smith", "Old Carrier"),
            D.person_identity_key("Jane Smith", "New Carrier"),
        )
        # Punctuation / legal-suffix robust.
        self.assertEqual(
            D.person_identity_key("Jane Q. Smith", "Acme, Inc."),
            D.person_identity_key("jane q smith", "Acme"),
        )

    def test_dedup_check_new_vs_seen(self):
        db = D.LeadsDB(":memory:")
        db.upsert({"full_name": "Jane Smith", "current_company": "Acme"})
        out = db.dedup_check([
            {"name": "Jane Smith", "company": "Acme"},       # seen
            {"name": "Bob Lee", "company": "Beta Re"},        # new
        ])
        self.assertEqual(out["new_count"], 1)
        self.assertEqual(out["seen_count"], 1)
        self.assertEqual(out["new"][0]["name"], "Bob Lee")


class TestLeadsCRUD(unittest.TestCase):
    def setUp(self):
        self.db = D.LeadsDB(":memory:")

    def test_status_derives_from_completeness(self):
        cid = self.db.candidate_upsert({"full_name": "A B", "current_company": "C", "qualification_score": 75})
        self.assertEqual(self.db.get(cid)["status_pipeline"], "candidate")
        # add email only → awaiting_phone
        self.db.upsert({"full_name": "A B", "current_company": "C", "email_address": "a@c.com"})
        self.assertEqual(self.db.get(cid)["status_pipeline"], "awaiting_phone")
        # add phone → new (delivery-ready)
        self.db.upsert({"full_name": "A B", "current_company": "C", "mobile_phone": "+1555"})
        self.assertEqual(self.db.get(cid)["status_pipeline"], "new")

    def test_export_csv_requires_both_email_and_phone(self):
        self.db.upsert({"full_name": "Complete Carl", "current_company": "X",
                        "email_address": "c@x.com", "mobile_phone": "+1"})
        self.db.upsert({"full_name": "Partial Pat", "current_company": "Y", "email_address": "p@y.com"})  # no phone
        out_path = os.path.join(tempfile.mkdtemp(), "report.csv")
        res = self.db.export_csv(out_path)
        self.assertEqual(res["rows"], 1)  # only the complete lead ships
        with open(out_path) as f:
            content = f.read()
        self.assertIn("Complete Carl", content)
        self.assertNotIn("Partial Pat", content)
        self.assertIn("full_name,current_title", content)  # header order

    def test_pipeline_and_contact(self):
        i = self.db.upsert({"full_name": "D E", "current_company": "F"})
        self.assertTrue(self.db.update_pipeline(i, "do_not_contact", "competitor"))
        self.assertFalse(self.db.update_pipeline(i, "bogus_status"))
        self.assertTrue(self.db.record_contact(i))
        self.assertEqual(self.db.get(i)["contact_count"], 1)

    def test_stats(self):
        self.db.upsert({"full_name": "A A", "current_company": "C", "email_address": "a@c.com", "mobile_phone": "+1"})
        self.db.candidate_upsert({"full_name": "B B", "current_company": "C"})
        s = self.db.stats()
        self.assertEqual(s["total"], 2)
        self.assertEqual(s["by_status"].get("new"), 1)
        self.assertEqual(s["by_status"].get("candidate"), 1)


class TestDiscovery(unittest.TestCase):
    def test_parse_rss(self):
        items = DISC.parse_feed(RSS_SAMPLE, "carrier_management_execs", "Carrier Management")
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["title"], "RSUI Names Jane Smith Chief Development Officer")
        self.assertTrue(items[0]["published_at"].startswith("2026-06-18"))

    def test_poll_only_new_since_last_run(self):
        db = D.LeadsDB(":memory:")
        feed = DISC.PC_PEOPLE_MOVE_FEEDS[0]
        r1 = DISC.poll_feed(db, feed, fetch=lambda url: RSS_SAMPLE)
        self.assertEqual(len(r1["new_items"]), 2)  # first run: both new
        r2 = DISC.poll_feed(db, feed, fetch=lambda url: RSS_SAMPLE)
        self.assertEqual(len(r2["new_items"]), 0)  # unchanged feed → ZERO redundancy

    def test_poll_surfaces_only_newer_item(self):
        db = D.LeadsDB(":memory:")
        feed = DISC.PC_PEOPLE_MOVE_FEEDS[0]
        DISC.poll_feed(db, feed, fetch=lambda url: RSS_SAMPLE)
        newer = RSS_SAMPLE.replace("<item>", """<item>
            <title>New Hire Pat Ray AVP Underwriting</title>
            <link>https://www.carriermanagement.com/news/2026/06/20/289300.htm</link>
            <pubDate>Sat, 20 Jun 2026 08:00:00 +0000</pubDate>
            <guid>https://www.carriermanagement.com/?p=289300</guid>
            <description>Pat Ray joins.</description>
        </item><item>""", 1)
        r = DISC.poll_feed(db, feed, fetch=lambda url: newer)
        self.assertEqual([i["title"] for i in r["new_items"]], ["New Hire Pat Ray AVP Underwriting"])

    def test_broken_feed_no_throw(self):
        db = D.LeadsDB(":memory:")
        r = DISC.poll_feed(db, DISC.PC_PEOPLE_MOVE_FEEDS[0], fetch=lambda url: (_ for _ in ()).throw(Exception("502")))
        self.assertIn("502", r["error"])


if __name__ == "__main__":
    unittest.main()
