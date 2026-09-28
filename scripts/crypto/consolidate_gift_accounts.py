"""Local dev: owner-approved ordinary transfers, old histories retained. Dry run by default."""

import argparse
import asyncio
from datetime import date
from decimal import Decimal
import json
import os
from unittest.mock import patch
from uuid import NAMESPACE_URL, uuid5

import asyncpg
import httpx
from fastapi import FastAPI
from prepare_docker_history import ROOT, UID, credentials
from check_user_history import fingerprint

SOURCES = {
    102: "Подарки через Stars — вложенные TON",
    123: "Общий счёт — переданные TON",
}
TARGET = 101
DAY = date(2026, 9, 27)


async def balances(db):
    result = {}
    for row in await db.fetch(
        """select p.id,p.investment_account_id,p.quantity,
        p.metadata->>'crypto_asset_id' asset,
        budgeting.get__crypto_position_entry_summary(p.id)::text basis
        from budgeting.portfolio_positions p where p.investment_account_id=any($1::bigint[])
        and p.asset_type_code='crypto' order by p.id""",
        [TARGET, *SOURCES],
    ):
        summary = json.loads(row["basis"], parse_float=Decimal)
        assert summary["remaining_cost_basis"] is not None
        asset = result.setdefault(
            row["asset"], {"quantity": Decimal(0), "cost": Decimal(0), "funding": {}}
        )
        asset["quantity"] += row["quantity"]
        asset["cost"] += Decimal(summary["remaining_cost_basis"])
        for loan, qty in summary["funding_units"].items():
            asset["funding"][loan] = asset["funding"].get(loan, Decimal(0)) + Decimal(
                qty
            )
    return result


async def run(apply):
    os.environ.setdefault("APP_PORT", "8000")
    os.environ.setdefault("DB_PORT", "5432")
    from backend.app.dependencies import CurrentUser, get_current_user
    from backend.app.routers import crypto, portfolio

    db = await asyncpg.connect(**{**credentials(), "database": "budget_bot"})
    await db.set_type_codec(
        "jsonb", schema="pg_catalog", encoder=json.dumps, decoder=json.loads
    )
    tx = db.transaction()
    await tx.start()
    try:
        for aid, name in SOURCES.items():
            assert (
                await db.fetchval(
                    "select name from budgeting.bank_accounts where id=$1 and owner_user_id=$2",
                    aid,
                    UID,
                )
                == name
            )
        assert (
            await db.fetchval(
                "select owner_user_id from budgeting.bank_accounts where id=$1", TARGET
            )
            == UID
        )
        assert not await db.fetchval(
            "select include_in_statistics from budgeting.bank_accounts where id=$1",
            TARGET,
        )
        before = await balances(db)
        before_fingerprint = await fingerprint(db)
        max_source = await db.fetchval(
            "select max(id) from budgeting.crypto_source_events"
        )
        old_journal = await db.fetchval(
            "select md5(string_agg(to_jsonb(s)::text,'' order by id)) from budgeting.crypto_source_events s where id<=$1",
            max_source,
        )
        plan_path = ROOT / "outputs/account-statistics/gift-transfers.json"
        if plan_path.exists():
            plan = json.loads(plan_path.read_text())
        else:
            rows = await db.fetch(
                """select id,investment_account_id,quantity from budgeting.portfolio_positions
                where investment_account_id=any($1::bigint[]) and asset_type_code='crypto'
                and status='open' and quantity>0 order by id""",
                list(SOURCES),
            )
            plan = [
                dict(
                    request_id=str(
                        uuid5(NAMESPACE_URL, f"gift-consolidation-2026-09-27:{r['id']}")
                    ),
                    position_id=r["id"],
                    target_investment_account_id=TARGET,
                    amount=str(r["quantity"]),
                    operated_at=str(DAY),
                    comment=f"Объединение вложений в подарки и стикеры. Источник: {SOURCES[r['investment_account_id']]}",
                )
                for r in rows
            ]
            assert plan, "No balances to consolidate"
            plan_path.parent.mkdir(parents=True, exist_ok=True)
            plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2))
        app = FastAPI()
        app.include_router(crypto.router)
        app.include_router(portfolio.router)
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=UID)

        async def call(function, *args):
            params = ",".join(f"${i + 1}" for i in range(len(args)))
            async with db.transaction():
                return await db.fetchval(f"select {function}({params})", *args)

        results = []
        with (
            patch.object(crypto.ledger, "call_function", side_effect=call),
            patch.object(crypto.reports, "call_function", side_effect=call),
        ):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://local-test"
            ) as client:
                for payload in plan:
                    response = await client.post(
                        "/api/v1/crypto/transfer-between-investment-accounts",
                        json=payload,
                    )
                    assert response.status_code == 200, response.text
                    results.append(response.json())
                applied = await fingerprint(db)
                for payload, expected in zip(plan, results, strict=True):
                    response = await client.post(
                        "/api/v1/crypto/transfer-between-investment-accounts",
                        json=payload,
                    )
                    assert response.status_code == 200 and response.json() == expected
                assert applied == await fingerprint(db), "Repeat changed ledger"
        assert before == await balances(db), "Quantity, cost or financing changed"
        assert not await db.fetchval(
            "select exists(select 1 from budgeting.portfolio_positions where investment_account_id=any($1::bigint[]) and quantity<>0)",
            list(SOURCES),
        )
        after = await fingerprint(db)
        changed = {
            "portfolio_positions",
            "portfolio_events",
            "operations",
            "crypto_source_events",
            "crypto_source_event_links",
        }
        assert all(
            before_fingerprint[t] == after[t]
            for t in before_fingerprint
            if t not in changed
        )
        assert old_journal == await db.fetchval(
            "select md5(string_agg(to_jsonb(s)::text,'' order by id)) from budgeting.crypto_source_events s where id<=$1",
            max_source,
        )
        # Check that the latest transfer remains correctable with its new snapshots.
        sid = await db.fetchval(
            "select id from budgeting.crypto_source_events where source_namespace='manual-portfolio-v1' and source_id=$1",
            plan[-1]["request_id"],
        )
        preview_before = await fingerprint(db)
        correction = [
            dict(
                command_index=0,
                field="amount",
                value=str(Decimal(plan[-1]["amount"]) - Decimal("0.01")),
            )
        ]
        await db.fetchval(
            "select budgeting.put__correct_crypto_source($1,$2,1,$3,$4,$5,false)",
            UID,
            sid,
            uuid5(NAMESPACE_URL, "gift-consolidation-check"),
            correction,
            "Проверка предварительного пересчёта перевода",
        )
        assert preview_before == await fingerprint(db), (
            "Correction preview changed data"
        )
        # Exercise future ordinary return + reward without leaving test movements.
        probe = db.transaction()
        await probe.start()
        try:
            source = await db.fetchrow(
                "select id,quantity from budgeting.portfolio_positions where investment_account_id=$1 and quantity>1 order by id limit 1",
                TARGET,
            )
            main = await db.fetchrow(
                "select id,quantity from budgeting.portfolio_positions where investment_account_id=92 and metadata->>'crypto_asset_id'='1' and status='open' order by id limit 1"
            )
            old_basis = await db.fetchval(
                "select budgeting.get__crypto_position_entry_summary($1)::text",
                source["id"],
            )
            old_main_basis = await db.fetchval(
                "select budgeting.get__crypto_position_entry_summary($1)::text",
                main["id"],
            )
            with (
                patch.object(crypto.ledger, "call_function", side_effect=call),
                patch.object(crypto.reports, "call_function", side_effect=call),
            ):
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app), base_url="http://local-test"
                ) as client:
                    response = await client.post(
                        "/api/v1/crypto/transfer-between-investment-accounts",
                        json=dict(
                            request_id=str(uuid5(NAMESPACE_URL, "gift-return-probe")),
                            position_id=source["id"],
                            target_investment_account_id=92,
                            amount="1",
                            operated_at=str(DAY),
                            comment="Проверка возврата",
                        ),
                    )
                    assert response.status_code == 200, response.text
                    returned_basis = json.loads(
                        await db.fetchval(
                            "select budgeting.get__crypto_position_entry_summary($1)::text",
                            main["id"],
                        ),
                        parse_float=Decimal,
                    )
                    from decimal import ROUND_HALF_UP

                    expected = (
                        Decimal(
                            json.loads(old_basis, parse_float=Decimal)[
                                "remaining_cost_basis"
                            ]
                        )
                        / source["quantity"]
                    ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                    assert (
                        Decimal(returned_basis["remaining_cost_basis"])
                        - Decimal(
                            json.loads(old_main_basis, parse_float=Decimal)[
                                "remaining_cost_basis"
                            ]
                        )
                        == expected
                    )
                    response = await client.post(
                        f"/api/v1/portfolio/positions/{main['id']}/income",
                        json=dict(
                            request_id=str(uuid5(NAMESPACE_URL, "gift-reward-probe")),
                            amount=0,
                            currency_code="RUB",
                            quantity="1",
                            destination="position",
                            income_kind="reward",
                            received_at=str(DAY),
                        ),
                    )
                    assert response.status_code == 200, response.text
                    rewarded_basis = json.loads(
                        await db.fetchval(
                            "select budgeting.get__crypto_position_entry_summary($1)::text",
                            main["id"],
                        ),
                        parse_float=Decimal,
                    )
                    assert (
                        rewarded_basis["remaining_cost_basis"]
                        == returned_basis["remaining_cost_basis"]
                    )
                    assert (
                        rewarded_basis["funding_units"]
                        == returned_basis["funding_units"]
                    )
                    assert (
                        await db.fetchval(
                            "select quantity from budgeting.portfolio_positions where id=$1",
                            main["id"],
                        )
                        == main["quantity"] + 2
                    )
        finally:
            await probe.rollback()
        assert preview_before == await fingerprint(db), (
            "Return/reward probe changed data"
        )
        report = dict(
            applied=apply,
            day=str(DAY),
            target_account=TARGET,
            transfers=plan,
            results=results,
            totals=await balances(db),
            financial_totals_preserved=True,
            repeat_unchanged=True,
            correction_preview_unchanged=True,
            old_history_unchanged=True,
            return_and_reward_verified=True,
        )
        if apply:
            await tx.commit()
        else:
            await tx.rollback()
        (
            ROOT
            / f"outputs/account-statistics/gift-transfers-{'applied' if apply else 'preview'}.json"
        ).write_text(json.dumps(report, ensure_ascii=False, default=str, indent=2))
        print(
            json.dumps(
                {k: v for k, v in report.items() if k not in ("transfers", "results")},
                ensure_ascii=False,
                default=str,
            )
        )
    except BaseException:
        await tx.rollback()
        raise
    finally:
        await db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    asyncio.run(run(parser.parse_args().apply))
