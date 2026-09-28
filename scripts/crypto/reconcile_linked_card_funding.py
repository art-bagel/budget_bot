"""Repair linked card expense funding on local copies; default is rollback."""
import argparse
import asyncio
import json
from uuid import UUID

import asyncpg

from prepare_docker_history import ROOT, UID, credentials
from check_user_history import fingerprint

FUNCTIONS = ('put__reconcile_linked_fx_expenses', 'put__settle_crypto_fiat_sale')
REQUEST = UUID('213c9075-73ac-434a-9877-3f5e15cbe1c2')


async def run(database, apply):
    assert database in ('crypto_review_20260928', 'budget_bot', 'crypto_release_20260928_134135')
    db = await asyncpg.connect(**{**credentials(), 'database': database})
    tx = db.transaction()
    await tx.start()
    closed = False
    async def amounts():
        return {r['category_id']: r['amount'] for r in await db.fetch("select category_id,amount from budgeting.current_budget_balances where currency_code='RUB'")}
    try:
        before = await fingerprint(db)
        events_before = await db.fetchval("select md5(string_agg((to_jsonb(e)||jsonb_build_object('metadata',e.metadata-'manual_expense_settlement'))::text,'' order by e.id)) from budgeting.portfolio_events e")
        expenses_before = {r['operation_id']: r['cost'] for r in await db.fetch("select c.operation_id,sum(c.cost_base) cost from budgeting.lot_consumptions c join budgeting.fx_lots f on f.id=c.lot_id where f.bank_account_id=73 and f.currency_code='USD' group by c.operation_id")}
        budgets_before = await amounts()
        costs_before = await db.fetchval("select coalesce(sum(cost_base_remaining),0)+(select coalesce(sum(lc.cost_base),0) from budgeting.lot_consumptions lc join budgeting.fx_lots f on f.id=lc.lot_id where f.bank_account_id=73 and f.currency_code='USD') from budgeting.fx_lots where bank_account_id=73 and currency_code='USD'")
        for function in FUNCTIONS:
            await db.execute((ROOT / f'infra/db/Scripts/budgeting/func/{function}.sql').read_text())
        payload = json.dumps(dict(investment_account_id=97, sale_event_id=16864, category_id=102, operated_at='2026-05-03', comment='Подарок Сергею'))
        sql = "select budgeting.put__journal_bank_operation($1,97,'bank_settle_sale',$2::jsonb,$3)"
        result = json.loads(await db.fetchval(sql, UID, payload, REQUEST))
        after = await fingerprint(db)
        assert result == json.loads(await db.fetchval(sql, UID, payload, REQUEST))
        assert after == await fingerprint(db), 'Duplicate request mutated accounting'
        # Repeating the ordinary settlement call must also be a no-op.
        await db.fetchval("select budgeting.put__settle_crypto_fiat_sale($1,97,16864,102,'Подарок Сергею','2026-05-03')", UID)
        assert after == await fingerprint(db), 'Repeated settlement mutated accounting'
        for table in ('bank_entries','crypto_bank_entries','current_crypto_balances','crypto_lots','crypto_lot_consumptions','portfolio_positions','crypto_protocol_positions'):
            assert before[table] == after[table], table
        costs_after = await db.fetchval("select coalesce(sum(cost_base_remaining),0)+(select coalesce(sum(lc.cost_base),0) from budgeting.lot_consumptions lc join budgeting.fx_lots f on f.id=lc.lot_id where f.bank_account_id=73 and f.currency_code='USD') from budgeting.fx_lots where bank_account_id=73 and currency_code='USD'")
        assert costs_before == costs_after, 'Total historical FX cost changed'
        wrong = await db.fetchval("""select count(*) from budgeting.portfolio_events e where e.metadata->>'action'='fiat_sell'
            and e.metadata->>'target_bank_account_id'='73' and e.currency_code='USD' and e.metadata ? 'manual_expense_settlement'
            and (select coalesce(sum(c.amount),0) from budgeting.lot_consumptions c where c.operation_id=(e.metadata#>>'{manual_expense_settlement,result,operation_id}')::bigint and c.lot_id=(e.metadata->>'fx_lot_id')::bigint)<>e.amount""")
        assert wrong == 0, 'An explicitly linked expense consumed another payment lot'
        assert await db.fetchval("select count(*) from budgeting.fx_lots where bank_account_id=73 and (amount_remaining<0 or cost_base_remaining<0)") == 0
        assert await db.fetchval("select amount from budgeting.current_bank_balances where bank_account_id=73 and currency_code='USD'") == await db.fetchval("select sum(amount_remaining) from budgeting.fx_lots where bank_account_id=73 and currency_code='USD'")
        assert await db.fetchval("select historical_cost_in_base from budgeting.current_bank_balances where bank_account_id=73 and currency_code='USD'") == await db.fetchval("select sum(cost_base_remaining) from budgeting.fx_lots where bank_account_id=73 and currency_code='USD'")
        denied = db.transaction()
        await denied.start()
        try:
            await db.fetchval("select budgeting.put__settle_crypto_fiat_sale(-987654321,97,16864,102,'Подарок Сергею','2026-05-03')")
            raise AssertionError('Another owner was accepted')
        except asyncpg.RaiseError as exc:
            assert 'Access denied' in str(exc)
        finally:
            await denied.rollback()
        assert events_before == await db.fetchval("select md5(string_agg((to_jsonb(e)||jsonb_build_object('metadata',e.metadata-'manual_expense_settlement'))::text,'' order by e.id)) from budgeting.portfolio_events e")
        expenses_after = {r['operation_id']: r['cost'] for r in await db.fetch("select c.operation_id,sum(c.cost_base) cost from budgeting.lot_consumptions c join budgeting.fx_lots f on f.id=c.lot_id where f.bank_account_id=73 and f.currency_code='USD' group by c.operation_id")}
        expenses_changed = [dict(operation_id=k,before=str(v),after=str(expenses_after[k])) for k,v in expenses_before.items() if v!=expenses_after[k]]
        budgets_after = await amounts()
        changes = [dict(category_id=k, before=str(budgets_before.get(k,0)), after=str(budgets_after.get(k,0)), delta=str(budgets_after.get(k,0)-budgets_before.get(k,0))) for k in sorted(set(budgets_before)|set(budgets_after)) if budgets_before.get(k,0)!=budgets_after.get(k,0)]
        report = dict(database=database, applied=apply, gift=result, expense_changes=expenses_changed, budget_changes=changes, total_cost_unchanged=True, bank_quantities_and_portfolio_unchanged=True, all_existing_payment_links_verified=True, duplicate_verified=True)
        if apply:
            await tx.commit()
            closed = True
        else:
            await tx.rollback()
            closed = True
            assert before == await fingerprint(db), 'Preview did not roll back'
        out=ROOT/'outputs/crypto-update-2026-09-28/release/linked-card-funding'
        out.mkdir(exist_ok=True)
        (out/f'{database}-{"applied" if apply else "preview"}.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
        print(json.dumps(report,ensure_ascii=False))
    except BaseException:
        if not closed:
            await tx.rollback()
        raise
    finally:
        await db.close()


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--database',required=True)
    p.add_argument('--apply',action='store_true')
    args=p.parse_args()
    asyncio.run(run(args.database,args.apply))
