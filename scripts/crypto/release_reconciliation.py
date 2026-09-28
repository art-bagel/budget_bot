"""Read-only production / review / candidate reconciliation for the crypto release.

Every budget difference is attributed to the operation that causes it; the
columns must add up exactly. Writes private evidence to outputs/.
"""

import asyncio
import json
from collections import defaultdict
from decimal import Decimal

import asyncpg
import prepare_docker_history as prep
import rehearse_release as release

OUT = release.OUT.parent


async def connect(name):
    db = await asyncpg.connect(**{**prep.credentials(), "database": name})
    await db.execute("set default_transaction_read_only=on")
    return db


async def main():
    prod, review, cand = [await connect(n) for n in (release.SNAPSHOT, release.JOURNAL, release.DB)]
    try:
        names = {r["id"]: r["name"] for r in await cand.fetch("select id,name from budgeting.categories")}
        budget = "select category_id k,amount from budgeting.current_budget_balances where currency_code='RUB'"
        balances = {n: {r["k"]: r["amount"] for r in await db.fetch(budget)} for n, db in
                    (("production", prod), ("review", review), ("candidate", cand))}
        preparation = json.loads(await cand.fetchval("select payload::text from crypto_migration_audit.preparation where id=1"))
        replaced = preparation["original_operation_ids"] + [release.SERVER]
        parts = defaultdict(lambda: defaultdict(Decimal))
        for r in await prod.fetch("select category_id,amount from budgeting.budget_entries where operation_id=any($1::bigint[]) and currency_code='RUB'", replaced):
            parts["old_crypto_ops_removed"][r["category_id"]] -= r["amount"]
        # Classify every candidate entry that production does not have by the source that created its operation.
        repair = defaultdict(Decimal)
        for r in await cand.fetch("""select (coalesce(after_row,before_row)->>'id')::bigint id,
            coalesce((after_row->>'amount')::numeric,0)-coalesce((before_row->>'amount')::numeric,0) delta
            from budgeting.crypto_source_mutations where source_event_id=$1 and table_name='budget_entries'""", release.REPAIR_SOURCE):
            repair[r["id"]] += r["delta"]
        entries = await cand.fetch("""select e.id,e.category_id,e.amount,o.reversal_of_operation_id,o.comment,
            s.id source,s.source_namespace from budgeting.budget_entries e join budgeting.operations o on o.id=e.operation_id
            left join lateral (select min(m.source_event_id) id from budgeting.crypto_source_mutations m where m.table_name='operations'
             and m.before_row is null and (m.after_row->>'id')::bigint=o.id) m on true
            left join budgeting.crypto_source_events s on s.id=m.id
            where e.currency_code='RUB'""")
        prod_ids = {r["id"] for r in await prod.fetch("select id from budgeting.budget_entries")}
        prod_entries = {r["id"]: r["amount"] for r in await prod.fetch("select id,amount from budgeting.budget_entries")}
        for e in entries:
            if e["id"] in prod_ids and e["source"] is None:
                assert prod_entries[e["id"]] == e["amount"], e["id"]
                continue
            delta = repair.get(e["id"], Decimal(0))
            if e["source"] is None:
                assert e["reversal_of_operation_id"] == 19911 or "замена 19911" in (e["comment"] or ""), e["id"]
                key = "unaccounted_19911_reversal_and_residual"
            elif e["source_namespace"] == "bank-posting-v1":
                key = "owner_review_actions"
            else:
                key = "crypto_history_journal"
            parts[key][e["category_id"]] += e["amount"] - delta
            parts["linked_fx_repair_2289"][e["category_id"]] += delta
        rows = []
        for k in sorted(set().union(*balances.values(), *parts.values())):
            p, r, c = (balances[n].get(k, Decimal(0)) for n in ("production", "review", "candidate"))
            split = {name: col.get(k, Decimal(0)) for name, col in parts.items()}
            assert sum(split.values()) == c - p, (k, c - p, split)
            if p != c or p != r:
                rows.append(dict(category_id=k, name=names.get(k), production=p, review=r, candidate=c,
                                 candidate_minus_production=c - p, candidate_minus_review=c - r, **split))
        free = {n: sum(v for k, v in balances[n].items() if k in (88, 89)) for n in balances}
        bank = "select bank_account_id,currency_code,amount from budgeting.current_bank_balances where bank_account_id=73"
        crypto_bank = "select crypto_asset_id,amount,cost_base_remaining from budgeting.current_crypto_balances where bank_account_id=73 and amount<>0"
        portfolio_prod = await prod.fetch("""select p.investment_account_id,a.name,count(*) n,sum(p.amount_in_currency) cost from budgeting.portfolio_positions p
            join budgeting.bank_accounts a on a.id=p.investment_account_id where p.asset_type_code='crypto' and p.status='open' group by 1,2 order by 1""")
        portfolio = """select a.include_in_statistics s,count(*) n,sum((budgeting.get__crypto_position_entry_summary(p.id)->>'remaining_cost_basis')::numeric) cost
            from budgeting.portfolio_positions p join budgeting.bank_accounts a on a.id=p.investment_account_id
            where p.asset_type_code='crypto' and p.status='open' group by 1 order by 1 desc"""
        report = dict(
            databases=dict(production=release.SNAPSHOT, review=release.JOURNAL, candidate=release.DB),
            categories=rows, free_with_fx=free,
            bank_73={n: [dict(x) for x in await db.fetch(bank)] for n, db in (("production", prod), ("review", review), ("candidate", cand))},
            bank_73_crypto={n: [dict(x) for x in await db.fetch(crypto_bank)] for n, db in (("production", prod), ("candidate", cand))},
            portfolio_production=[dict(x) for x in portfolio_prod],
            portfolio_review=[dict(x) for x in await review.fetch(portfolio)],
            portfolio_candidate=[dict(x) for x in await cand.fetch(portfolio)],
            income_operations={n: await db.fetchval("select count(*) from budgeting.operations where type='income'") for n, db in (("production", prod), ("candidate", cand))},
        )
        (OUT / "reconciliation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str))
        print(json.dumps(report, ensure_ascii=False, indent=1, default=str))
    finally:
        for db in (prod, review, cand):
            await db.close()


if __name__ == "__main__":
    asyncio.run(main())
