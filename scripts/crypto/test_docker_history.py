"""Regression checks for replacement funding and fixed-price server payments."""

from collections import defaultdict
from decimal import Decimal as D
import json
import os
from datetime import date, datetime, timezone

import asyncpg
import unittest

from prepare_docker_history import ROOT, UID, connect, corrected_plan


class DockerHistoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = ROOT / "outputs/crypto-final-block-dev/plan-1049.json"
        if not path.exists():
            raise unittest.SkipTest("Private historical plan not present")
        cls.original = json.loads(path.read_text())
        cls.plan = corrected_plan(cls.original)

    def test_each_payment_is_2835_including_split_receipts(self):
        groups = defaultdict(lambda: D(0))
        changes = self.plan["docker_migration"]["server_corrections"]
        for c in changes:
            groups[c["server_date"]] += D(c["actual_RUB"])
        self.assertEqual(len(changes), 17)
        self.assertEqual(len(groups), 16)
        self.assertEqual(set(groups.values()), {D("2835")})
        self.assertEqual(groups["2025-10-24"], D("2835"))

    def test_no_quantity_change_or_duplicate_august_swap(self):
        self.assertEqual(len(self.plan["rows"]), len(self.original["rows"]))
        for old, new in zip(self.original["rows"], self.plan["rows"], strict=True):
            self.assertEqual(old["source_id"], new["source_id"])
            self.assertEqual(old.get("expected_main"), new.get("expected_main"))
            self.assertEqual(len(old["commands"]), len(new["commands"]))
            for a, b in zip(old["commands"], new["commands"], strict=True):
                if a["kind"] == "expense" and a["payload"].get("comment") == "Telegram Stars":
                    self.assertEqual(b["kind"], "transfer")
                    self.assertEqual(a["payload"]["quantity"], b["payload"]["amount"])
                    continue
                if old["source_id"] == "bybit:row:597":
                    self.assertEqual(b["kind"], "bank_withdraw")
                else:
                    self.assertEqual(a["kind"], b["kind"])
                for key in ["quantity", "from_amount", "to_amount", "amount"]:
                    self.assertEqual(a["payload"].get(key), b["payload"].get(key))

    def test_stars_remain_gifts_and_excursion_is_bank_balance(self):
        stars = [c for r in self.plan["rows"] for c in r["commands"]
                 if c["payload"].get("target_investment_account_id") == {"resource_ref": "account:gifts_stars"}]
        self.assertEqual(len(stars), 25)
        self.assertEqual(sum(D(c["payload"]["amount"]) for c in stars), D("231.4944"))
        self.assertEqual(self.plan["expected_accounts"]["gifts_stars"], {"native TON": "231.4944"})
        excursion = next(r for r in self.plan["rows"] if r["source_id"] == "bybit:row:597")
        self.assertEqual(excursion["commands"][0]["kind"], "bank_withdraw")
        self.assertEqual(excursion["commands"][0]["payload"]["quantity"], "110")

    def test_exact_funding_replaces_estimates_not_income(self):
        total = sum(D(r.get("funding_RUB", "0")) for r in self.plan["rows"])
        self.assertEqual(total, D("2476475.43"))
        self.assertEqual(total - D("228671"), D("2247804.43"))
        self.assertEqual(
            sum(D(r.get("funding_RUB", "0")) for r in self.original["rows"]),
            D("2481653.33"),
        )
        self.assertFalse(
            any(c["kind"] == "income" for r in self.plan["rows"] for c in r["commands"])
        )


@unittest.skipUnless(os.environ.get("CRYPTO_TEST_DOCKER_PREVIEW") == "1", "Local preview integration test is opt-in")
class BankWithdrawalTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = await connect()
        self.tx = self.db.transaction()
        await self.tx.start()
        self.position = await self.db.fetchrow("""
            SELECT p.id, p.quantity, (p.metadata->>'crypto_asset_id')::bigint asset_id
            FROM budgeting.portfolio_positions p
            JOIN budgeting.bank_accounts a ON a.id=p.investment_account_id
            WHERE p.owner_user_id=$1 AND p.status='open' AND p.quantity>=1
            AND a.investment_asset_type='crypto'
            AND NOT EXISTS(SELECT 1 FROM jsonb_each_text(COALESCE(p.metadata->'funding_units','{}')) u WHERE u.value::numeric<>0)
            ORDER BY p.id LIMIT 1""", UID)
        self.assertIsNotNone(self.position)

    async def asyncTearDown(self):
        await self.tx.rollback()
        await self.db.close()

    async def post(self, **overrides):
        payload = dict(position_id=self.position['id'], bank_account_id=73, quantity="0.1")
        payload.update(overrides)
        return await self.db.fetchval(
            "select budgeting.put__crypto_source_event($1,92,'withdraw-regression','one',$2,1,$3,$4,'{}')",
            UID, datetime(2090, 1, 1, tzinfo=timezone.utc), date(2090, 1, 1),
            [dict(kind='bank_withdraw', payload=payload)],
        )

    async def test_bank_receives_same_coin_cost_and_repeat_has_no_effect(self):
        before = await self.db.fetchval("select coalesce(sum(amount),0) from budgeting.crypto_bank_entries where bank_account_id=73 and crypto_asset_id=$1", self.position['asset_id'])
        result = await self.post()
        self.assertEqual(await self.post(), result)
        after = await self.db.fetchval("select coalesce(sum(amount),0) from budgeting.crypto_bank_entries where bank_account_id=73 and crypto_asset_id=$1", self.position['asset_id'])
        self.assertEqual(after-before, D("0.1"))
        event_id = next(x['ledger_id'] for x in result['links'] if x['ledger_table']=='portfolio_events')
        row = await self.db.fetchrow("""select e.metadata, l.cost_base_initial, l.amount_remaining
            from budgeting.portfolio_events e join budgeting.crypto_lots l on l.opened_by_operation_id=e.linked_operation_id where e.id=$1""", event_id)
        self.assertEqual(D(str(row['metadata']['consumed_cost_basis'])), row['cost_base_initial'])
        self.assertEqual(row['amount_remaining'], D('0.1'))
        self.assertEqual(row['metadata']['target_kind'], 'bank')

    async def test_pending_expense_lot_is_not_reinvested(self):
        result = await self.post(defer_manual_expense=True)
        operation = result['results'][0]['operation_id']
        # Isolate the reserved lot; all changes roll back after the test.
        await self.db.execute("update budgeting.crypto_lots set amount_remaining=0,cost_base_remaining=0 where bank_account_id=73 and crypto_asset_id=$1 and opened_by_operation_id<>$2", self.position['asset_id'], operation)
        with self.assertRaisesRegex(asyncpg.RaiseError, 'остаток'):
            await self.db.fetchval("select budgeting.put__transfer_crypto_to_investment($1,73,92,$2,0.1)", UID, self.position['asset_id'])

    async def test_unsettled_financing_is_rejected(self):
        await self.db.execute("update budgeting.portfolio_positions set metadata=jsonb_set(metadata,'{funding_units}','{\"999999\":1}') where id=$1", self.position['id'])
        with self.assertRaisesRegex(asyncpg.RaiseError, 'Settle financing'):
            await self.post(quantity=str(self.position['quantity']))

    async def test_other_owner_bank_is_rejected(self):
        other = await self.db.fetchval("select id from budgeting.bank_accounts where account_kind='cash' and owner_user_id is distinct from $1 order by id limit 1", UID)
        self.assertIsNotNone(other)
        with self.assertRaisesRegex(asyncpg.RaiseError, 'owner'):
            await self.post(bank_account_id=other)

    async def test_negative_quantity_is_rejected(self):
        with self.assertRaises(asyncpg.RaiseError):
            await self.post(quantity='-1')


if __name__ == "__main__":
    unittest.main()
