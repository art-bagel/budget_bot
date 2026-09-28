"""Settle matched expenses and retain post-cutoff activity in Docker preview."""

import asyncio
from datetime import date
from decimal import Decimal as D
import json

import asyncpg
from prepare_docker_history import OUT, UID, connect, credentials

CARD_MATCHES = {
    20021: 790,
    20036: 795,
    20062: 801,
    20186: 837,
    20240: 861,
    20493: 887,
    20555: 912,
    20854: 938,
    20900: 959,
    20903: 966,
    20936: 973,
    21038: 1005,
}


async def main():
    state = json.loads((OUT / "state-preview.json").read_text())
    assert state["block_closed"] and state["verified_through"] == 1049
    inv = json.loads((OUT / "inventory.json").read_text())
    operations = {o["id"]: o for o in inv["operations"]}
    db = await connect()
    baseline = await asyncpg.connect(**{**credentials(), "database": "crypto_before_20260924"})
    await baseline.execute("set default_transaction_read_only=on")
    try:
        async with db.transaction():
            await db.execute("select pg_advisory_xact_lock($1)", UID)
            prepared = await db.fetchval(
                "select payload from crypto_migration_audit.preparation where id=1"
            )
            plan = prepared["plan"]
            policy = plan["docker_migration"]
            previous = await db.fetchval(
                "select payload from crypto_migration_audit.preparation where id=2"
            )
            if previous:
                print("Already finalized; verification only")
                result = previous
            else:
                matches = []
                # Archived categories remain archived after the transaction.
                archived_categories = [
                    c["id"] for c in inv["categories"] if not c["is_active"]
                ]
                await db.execute(
                    "update budgeting.categories set is_active=true where id=any($1::bigint[]) and owner_user_id=$2",
                    archived_categories,
                    UID,
                )
                for old_id, line in CARD_MATCHES.items():
                    source_id = f"bybit:row:{line}"
                    posted = state["posted"][source_id]
                    # Source results include the exact sale event id; identify by
                    # its source-linked operation, not amount/date resemblance.
                    source = await db.fetchval(
                        "select to_jsonb(s) from budgeting.crypto_source_events s where anchor_account_id=92 and source_id=$1",
                        source_id,
                    )
                    assert source["result"] == posted["response"]
                    candidates = await db.fetch(
                        "select e.id,e.event_at,e.amount,e.currency_code from budgeting.portfolio_events e where e.id=any($1::bigint[]) and e.metadata->>'action'='fiat_sell'",
                        [
                            link["ledger_id"]
                            for link in source["result"]["links"]
                            if link["ledger_table"] == "portfolio_events"
                        ],
                    )
                    assert len(candidates) == 1
                    sale = candidates[0]
                    budgets = [
                        e for e in inv["budget_entries"] if e["operation_id"] == old_id
                    ]
                    assert len(budgets) == 1
                    category = budgets[0]["category_id"]
                    day = max(
                        date.fromisoformat(operations[old_id]["operated_on"]),
                        sale["event_at"],
                    )
                    result_settle = await db.fetchval(
                        "select budgeting.put__settle_crypto_fiat_sale($1,$2,$3,$4,$5,$6)",
                        UID,
                        state["accounts"]["exchange_source"],
                        sale["id"],
                        category,
                        operations[old_id]["comment"],
                        day,
                    )
                    matches.append(
                        dict(
                            old_operation_id=old_id,
                            source_id=source_id,
                            sale_event_id=sale["id"],
                            category_id=category,
                            original_date=operations[old_id]["operated_on"],
                            effective_date=str(day),
                            paid_USD=str(sale["amount"]),
                            result=result_settle,
                        )
                    )
                friend = await db.fetchval(
                    "select budgeting.put__record_expense($1,73,$2,$3,'RUB','Неучтённое использование выручки от продаж криптовалюты другу','2025-12-31'::date)",
                    UID,
                    policy["category_id"],
                    D(policy["friend_receipts_RUB"]),
                )
                tail = []
                # Preserve the actual 17 September purchase and its expenses;
                # they are beyond the imported historical cutoff.
                op = operations[21183]
                tail.append(
                    dict(
                        old_operation_id=21183,
                        result=await db.fetchval(
                            "select budgeting.put__buy_crypto_asset($1,73,'RUB',19400,2,225.45,$2,$3)",
                            UID,
                            op["comment"],
                            date.fromisoformat(op["operated_on"]),
                        ),
                    )
                )
                for old_id in [21184, 21185]:
                    op = operations[old_id]
                    entries = [
                        e
                        for e in inv["crypto_bank_entries"]
                        if e["operation_id"] == old_id
                    ]
                    budgets = [
                        e for e in inv["budget_entries"] if e["operation_id"] == old_id
                    ]
                    assert len(entries) == len(budgets) == 1
                    tail.append(
                        dict(
                            old_operation_id=old_id,
                            result=await db.fetchval(
                                "select budgeting.put__record_crypto_expense($1,73,$2,2,$3,$4,$5)",
                                UID,
                                budgets[0]["category_id"],
                                -D(str(entries[0]["amount"])),
                                op["comment"],
                                date.fromisoformat(op["operated_on"]),
                            ),
                        )
                    )
                result = dict(
                    card_matches=matches, friend_expense=friend, post_cutoff=tail
                )
                await db.execute(
                    "update budgeting.categories set is_active=false where id=any($1::bigint[]) and owner_user_id=$2",
                    archived_categories,
                    UID,
                )
                await db.execute(
                    "insert into crypto_migration_audit.preparation values (2,$1)",
                    result,
                )
            original_ids = await baseline.fetchval(
                "select array_agg(id order by id) from budgeting.operations where not(id=any($1::bigint[]))",
                prepared["original_operation_ids"],
            )
            query = "select md5(string_agg(to_jsonb(o)::text, chr(10) order by id)) from budgeting.operations o where id=any($1::bigint[])"
            assert await baseline.fetchval(query, original_ids) == await db.fetchval(
                query, original_ids
            )
            for table in ("bank_entries", "budget_entries"):
                query = f"select jsonb_agg(to_jsonb(t) order by id) from budgeting.{table} t where operation_id=any($1::bigint[])"
                assert json.loads(
                    await baseline.fetchval(query, original_ids)
                ) == await db.fetchval(query, original_ids), table
            for table in (
                "users",
                "categories",
                "families",
                "income_sources",
                "scheduled_expenses",
            ):
                query = f"select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from budgeting.{table} t"
                assert json.loads(await baseline.fetchval(query)) == await db.fetchval(
                    query
                ), table
            # Migration widens numeric scale, so compare values, not the text
            # spelling of e.g. 1.00000000 versus 1.000000000000000000.
            query = "select jsonb_agg(to_jsonb(p) order by id) from budgeting.portfolio_positions p where asset_type_code <> 'crypto'"
            assert json.loads(await baseline.fetchval(query)) == await db.fetchval(
                query
            )
            assert await db.fetchval(
                "select amount from budgeting.current_bank_balances where bank_account_id=73 and currency_code='RUB'"
            ) == D(policy["original_bank_RUB"])
            assert await db.fetchval(
                "select count(*) from budgeting.operations where type='income'"
            ) == await baseline.fetchval(
                "select count(*) from budgeting.operations where type='income'"
            )
            balances = await db.fetch(
                "select currency_code,amount,historical_cost_in_base from budgeting.current_bank_balances where bank_account_id=73 order by currency_code"
            )
            assert await db.fetchval(
                "select amount from budgeting.current_crypto_balances where bank_account_id=73 and crypto_asset_id=2"
            ) == D("109.35")
            excursion_asset = state["assets"]["0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe"]
            excursion = await db.fetchrow("""select sum(amount_remaining) quantity,
                sum(cost_base_remaining) cost from budgeting.crypto_lots
                where bank_account_id=73 and crypto_asset_id=$1
                and metadata->>'reserved_for_manual_expense'='true'""", excursion_asset)
            assert excursion["quantity"] == D("110")
            assert excursion["cost"] == D("8580.94")
            stars = await db.fetchval("""select budgeting.get__crypto_position_entry_summary(id)
                from budgeting.portfolio_positions where investment_account_id=$1 and status='open'""", state["accounts"]["gifts_stars"])
            assert D(str(stars["quantity_now"])) == D("231.4944")
            assert await db.fetchval("""select count(*) from budgeting.portfolio_events
                where created_by_user_id=$1 and comment='Telegram Stars' and metadata->>'target_kind'='expense'""", UID) == 0
            result["verification"] = dict(
                stars_gift_asset=stars,
                excursion_bank_USDT=str(excursion["quantity"]),
                excursion_bank_cost_RUB=str(excursion["cost"]),
                no_new_income=True,
                unrelated_operations_unchanged=True,
                other_positions_unchanged=True,
                bank_RUB_unchanged=True,
                bank_balances=[dict(r) for r in balances],
                post_cutoff_bank_USDT="109.35",
                history_through=1049,
                capital=state["capital_reconciliation"],
            )
        (OUT / "final-verification.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2, default=str) + "\n"
        )
        print(json.dumps(result["verification"], ensure_ascii=False, default=str))
    finally:
        await baseline.close()
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
