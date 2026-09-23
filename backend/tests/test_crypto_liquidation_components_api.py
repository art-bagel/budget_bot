"""Real API regression: liquidation redistributes cost and financing, disposable DB."""

import asyncio
from datetime import date, timedelta
from decimal import Decimal as D
import os
from pathlib import Path
import sys

socket = Path(sys.argv[1]).resolve()
assert str(socket).startswith("/private/tmp/crypto-portfolio-audit.")
assert sys.argv[3].startswith("boundary_")
os.environ.update(
    APP_ENV="development",
    APP_PORT="8000",
    DB_HOST=str(socket),
    DB_PORT=sys.argv[2],
    DB_DATABASE=sys.argv[3],
    DB_SCHEMA="budgeting",
    POSTGRES_USER="audit",
    POSTGRES_PASSWORD="",
    TELEGRAM_BOT_TOKEN="",
)
import asyncpg  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
import httpx  # noqa: E402
from backend.app.dependencies import CurrentUser, get_current_user  # noqa: E402
from backend.app.routers import crypto  # noqa: E402


async def main():
    pool = await crypto.ledger._get_pool()

    async def sql(q, *a):
        async with pool.acquire() as db:
            return await db.fetchval(q, *a)

    try:
        uid = await sql(
            "INSERT INTO budgeting.users(base_currency_code) VALUES('RUB') RETURNING id"
        )
        await sql(
            "INSERT INTO budgeting.categories(owner_type,owner_user_id,name,kind) VALUES('user',$1,'Unallocated','system') RETURNING id",
            uid,
        )
        bank = await sql(
            "INSERT INTO budgeting.bank_accounts(owner_type,owner_user_id,name) VALUES('user',$1,'Liquidation fixture') RETURNING id",
            uid,
        )
        inv = await sql(
            "INSERT INTO budgeting.bank_accounts(owner_type,owner_user_id,name,account_kind,investment_asset_type) VALUES('user',$1,'Liquidation portfolio','investment','crypto') RETURNING id",
            uid,
        )
        tokens = []
        for symbol in ("LCOLL", "LDEBT"):
            tokens.append(
                await sql(
                    "INSERT INTO budgeting.crypto_assets(symbol,name,network_code,contract_address,decimals) VALUES($1,$1,'testnet',$2,18) RETURNING id",
                    symbol,
                    str(uid) + symbol,
                )
            )
        collateral, debt = tokens
        await sql("SELECT budgeting.put__record_income($1,$2,10000,'RUB')", uid, bank)
        app = FastAPI()
        app.include_router(crypto.router)
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id=uid)

        @app.exception_handler(asyncpg.RaiseError)
        async def business_error(request, exc):
            return JSONResponse({"detail": str(exc)}, status_code=400)

        def c(kind, **payload):
            return dict(kind=kind, payload=payload)

        def body(n, commands):
            day = str(date(2024, 1, 1) + timedelta(days=n))
            return dict(
                anchor_account_id=inv,
                source_namespace="liquidation-components-test",
                source_id=str(n),
                occurred_at=day + "T12:00:00Z",
                accounting_date=day,
                order_in_timestamp=0,
                commands=commands,
            )

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:

            async def post(n, commands, code=200):
                r = await client.post(
                    "/api/v1/crypto/source-events", json=body(n, commands)
                )
                assert r.status_code == code, r.text
                return r.json()

            r = await post(
                1,
                [
                    c(
                        "bank_buy",
                        bank_account_id=bank,
                        crypto_asset_id=collateral,
                        quantity="100",
                        fiat_currency_code="RUB",
                        fiat_amount="10000",
                    ),
                    c(
                        "bank_to_portfolio",
                        bank_account_id=bank,
                        investment_account_id=inv,
                        crypto_asset_id=collateral,
                        quantity="100",
                    ),
                ],
            )
            pos = r["results"][1]["position_id"]
            r = await post(
                2,
                [
                    c(
                        "create_protocol",
                        investment_account_id=inv,
                        protocol_name="Synthetic lending",
                        position_type="lending",
                        asset_symbol="LCOLL",
                        quantity="50",
                        source_position_id=pos,
                        crypto_asset_id=collateral,
                    )
                ],
            )
            loan = r["results"][0]["id"]
            r = await post(
                3,
                [
                    c(
                        "borrow",
                        position_id=loan,
                        borrowed_crypto_asset_id=debt,
                        debt_qty="20",
                        funding_policy="components",
                    )
                ],
            )
            debtpos = r["results"][0]["metadata"]["borrowed_position_id"]
            await post(
                4,
                [
                    c(
                        "swap",
                        position_id=debtpos,
                        from_amount="20",
                        to_crypto_asset_id=collateral,
                        to_amount="10",
                        basis_policy="carry",
                    )
                ],
            )
            await post(
                5,
                [
                    c(
                        "top_up_protocol",
                        position_id=loan,
                        source_position_id=pos,
                        quantity="30",
                    )
                ],
            )
            protocol = await sql(
                "SELECT to_jsonb(p) FROM budgeting.crypto_protocol_positions p WHERE id=$1",
                loan,
            )
            assert D(str(protocol["cost_basis_in_base"])) == 7500
            assert D(str(protocol["metadata"]["funding_units0"][str(loan)])) == 10
            liquidation = c(
                "liquidate",
                position_id=loan,
                collateral_qty="8",
                debt_qty="4",
                collateral_fee_qty="2",
            )
            before = await sql(
                "SELECT to_jsonb(p) FROM budgeting.crypto_protocol_positions p WHERE id=$1",
                loan,
            )
            await post(
                6,
                [
                    {
                        **liquidation,
                        "payload": {**liquidation["payload"], "debt_qty": "21"},
                    }
                ],
                400,
            )
            assert before == await sql(
                "SELECT to_jsonb(p) FROM budgeting.crypto_protocol_positions p WHERE id=$1",
                loan,
            )
            result = await post(6, [liquidation])
            assert await post(6, [liquidation]) == result
            protocol = await sql(
                "SELECT to_jsonb(p) FROM budgeting.crypto_protocol_positions p WHERE id=$1",
                loan,
            )
            assert D(str(protocol["quantity"])) == 72
            assert D(str(protocol["metadata"]["borrowed_quantity"])) == 16
            summary = await sql(
                "SELECT budgeting.get__crypto_position_entry_summary($1)", pos
            )
            expense = await sql(
                "SELECT sum((metadata->>'funding_interest_cost')::numeric+COALESCE((metadata->>'funding_confirmed_cost')::numeric,0)) FROM budgeting.portfolio_events WHERE created_by_user_id=$1 AND metadata->>'funding_policy'='components'",
                uid,
            )
            assert (
                D(str(summary["remaining_cost_basis"]))
                + D(str(protocol["cost_basis_in_base"]))
                + expense
                == 10000
            )
            assert expense > D("187.5"), (
                "Expense financing receives its share of principal cost too"
            )
            event = await sql(
                "SELECT to_jsonb(e) FROM budgeting.crypto_liability_events e WHERE protocol_position_id=$1 AND event_kind='liquidation'",
                loan,
            )
            assert event["realized_in_base"] == 0
            assert D(str(protocol["metadata"]["cost_basis_carried"])) == D(
                str(protocol["cost_basis_in_base"])
            )
            # Funded fiat sale without an explicit pending settlement remains rejected.
            before = await sql(
                "SELECT quantity FROM budgeting.portfolio_positions WHERE id=$1", pos
            )
            await post(
                7,
                [
                    c(
                        "sell_fiat",
                        investment_account_id=inv,
                        bank_account_id=bank,
                        crypto_asset_id=collateral,
                        quantity="1",
                        fiat_currency_code="RUB",
                        fiat_amount="100",
                    )
                ],
                400,
            )
            assert before == await sql(
                "SELECT quantity FROM budgeting.portfolio_positions WHERE id=$1", pos
            )
            # Concentrated LP can return only one leg. Both cash and loan units
            # from the exhausted leg must move to the returned asset.
            r = await post(
                8,
                [
                    c(
                        "borrow",
                        position_id=loan,
                        borrowed_crypto_asset_id=debt,
                        debt_qty="10",
                        funding_policy="components",
                    )
                ],
            )
            dp = r["results"][0]["metadata"]["borrowed_position_id"]
            before_basis = await sql(
                "SELECT (budgeting.get__crypto_position_entry_summary($1)->>'remaining_cost_basis')::numeric",
                pos,
            )
            r = await post(
                9,
                [
                    c(
                        "create_protocol",
                        investment_account_id=inv,
                        protocol_name="One-sided LP",
                        position_type="liquidity_pool",
                        asset_symbol="LCOLL",
                        quantity="5",
                        source_position_id=pos,
                        crypto_asset_id=collateral,
                        secondary_source_position_id=dp,
                        secondary_quantity="10",
                    )
                ],
            )
            lp = r["results"][0]["id"]
            close = c(
                "close_protocol",
                position_id=lp,
                return_quantity="6",
                secondary_return_quantity="0",
                allocation_policy="net_composition",
            )
            await post(
                10,
                [{**close, "payload": {**close["payload"], "return_quantity": "0"}}],
                400,
            )
            closed = await post(10, [close])
            assert await post(10, [close]) == closed
            after_basis = await sql(
                "SELECT (budgeting.get__crypto_position_entry_summary($1)->>'remaining_cost_basis')::numeric",
                pos,
            )
            assert before_basis == after_basis
            assert (
                await sql(
                    "SELECT COALESCE(sum(quantity),0) FROM budgeting.portfolio_positions WHERE investment_account_id=$1 AND metadata->>'crypto_asset_id'=$2",
                    inv,
                    str(debt),
                )
                == 0
            )
            await post(
                11,
                [
                    c(
                        "accrue",
                        position_id=loan,
                        collateral_qty="0",
                        interest_qty="0.5",
                        interest_value_in_base="0",
                        collateral_before="72",
                        debt_before="26",
                    )
                ],
            )
            result = await post(
                12,
                [
                    c(
                        "liquidate",
                        position_id=loan,
                        collateral_qty="3",
                        debt_qty="4.5",
                        interest_qty="0.5",
                        collateral_fee_qty="1",
                    )
                ],
            )
            assert result["results"][0]["realized_in_base"] == 0
            protocol = await sql(
                "SELECT to_jsonb(p) FROM budgeting.crypto_protocol_positions p WHERE id=$1",
                loan,
            )
            assert D(str(protocol["metadata"]["borrowed_quantity"])) == 22
            assert D(str(protocol["metadata"]["debt_interest_quantity"])) == 0
            cash = await sql(
                "SELECT sum((budgeting.get__crypto_position_entry_summary(id)->>'remaining_cost_basis')::numeric) FROM budgeting.portfolio_positions WHERE owner_user_id=$1 AND status='open'",
                uid,
            )
            expense = await sql(
                "SELECT sum((metadata->>'funding_interest_cost')::numeric+COALESCE((metadata->>'funding_confirmed_cost')::numeric,0)) FROM budgeting.portfolio_events WHERE created_by_user_id=$1 AND metadata->>'funding_policy'='components'",
                uid,
            )
            assert cash + D(str(protocol["cost_basis_in_base"])) + expense == 10000
            history = await sql(
                "SELECT budgeting.get__crypto_protocol_history($1,$2,200,0)", uid, loan
            )
            expense_rows = [
                row for row in history["entries"] if row["kind"] == "external_expense"
            ]
            fee_rows = [
                row for row in history["entries"] if row["kind"] == "liquidation_fee"
            ]
            assert sorted(D(str(row["quantity"])) for row in fee_rows) == [D(1), D(2)]
            assert all("не дополнительное" in row["comment"] for row in fee_rows)
            interest_rows = [
                row
                for row in history["entries"]
                if row["kind"] == "liquidation_interest"
            ]
            assert sum(D(str(row["quantity"])) for row in interest_rows) == D("0.5")
            assert len(expense_rows) == 2
            assert all(row["quantity"] is None for row in expense_rows)
            assert sum(D(str(row["cost_basis"])) for row in expense_rows) == expense
            assert expense > 0
            # Refinance part of the old loan, including interest, from a new loan.
            r = await post(
                13,
                [
                    c(
                        "create_protocol",
                        investment_account_id=inv,
                        protocol_name="Second lending account",
                        position_type="lending",
                        asset_symbol="LCOLL",
                        quantity="1",
                        source_position_id=pos,
                        crypto_asset_id=collateral,
                    )
                ],
            )
            other_loan = r["results"][0]["id"]
            r = await post(
                14,
                [
                    c(
                        "borrow",
                        position_id=other_loan,
                        borrowed_crypto_asset_id=debt,
                        debt_qty="12",
                        funding_policy="components",
                    )
                ],
            )
            other_debtpos = r["results"][0]["metadata"]["borrowed_position_id"]
            await post(
                15,
                [
                    c(
                        "accrue",
                        position_id=loan,
                        collateral_qty="0",
                        interest_qty="1",
                        interest_value_in_base="0",
                        collateral_before="69",
                        debt_before="22",
                    )
                ],
            )
            repayment = c(
                "repay",
                position_id=loan,
                source_position_id=other_debtpos,
                repay_qty="11",
                interest_qty="1",
            )
            await post(
                16,
                [{**repayment, "payload": {**repayment["payload"], "repay_qty": "24"}}],
                400,
            )
            assert (
                await sql(
                    "SELECT (metadata->>'borrowed_quantity')::numeric FROM budgeting.crypto_protocol_positions WHERE id=$1",
                    loan,
                )
                == 23
            )
            result = await post(16, [repayment])
            assert await post(16, [repayment]) == result
            old_balance = await sql(
                "SELECT (metadata->>'borrowed_quantity')::numeric FROM budgeting.crypto_protocol_positions WHERE id=$1",
                loan,
            )
            assert old_balance == 12
            new_balance = await sql(
                "SELECT (metadata->>'borrowed_quantity')::numeric FROM budgeting.crypto_protocol_positions WHERE id=$1",
                other_loan,
            )
            assert new_balance == 12
            refinance_expense = await sql(
                "SELECT metadata FROM budgeting.portfolio_events WHERE position_id=$1 AND metadata->>'target_kind'='lending_repay' ORDER BY id DESC LIMIT 1",
                other_debtpos,
            )
            assert D(str(refinance_expense["funding_interest_cost"])) == 0
            assert D(str(refinance_expense["funding_units"][str(other_loan)])) == 1
            assert (
                D(str(refinance_expense["funding_refinanced_units"][str(other_loan)]))
                == 10
            )
            # Every holder class must receive replacement units, including prior expenses.
            for table, field, where in [
                ("portfolio_positions", "funding_units", "owner_user_id"),
                ("crypto_protocol_positions", "funding_units0", "owner_user_id"),
                ("portfolio_events", "funding_units", "created_by_user_id"),
            ]:
                count = await sql(
                    f"SELECT count(*) FROM budgeting.{table} WHERE {where}=$1 AND (metadata->$2->>$3)::numeric>0 AND (metadata->$2->>$4)::numeric>0",
                    uid,
                    field,
                    str(loan),
                    str(other_loan),
                )
                assert count > 0, (table, field)
            # Pay the new debt with purchased coins. Replacement units must then
            # resolve into actual RUB at the old holders, not disappear with debt.
            await sql(
                "SELECT budgeting.put__record_income($1,$2,1200,'RUB')", uid, bank
            )
            await post(
                17,
                [
                    c(
                        "bank_buy",
                        bank_account_id=bank,
                        crypto_asset_id=debt,
                        quantity="11",
                        fiat_currency_code="RUB",
                        fiat_amount="1200",
                    ),
                    c(
                        "bank_to_portfolio",
                        bank_account_id=bank,
                        investment_account_id=inv,
                        crypto_asset_id=debt,
                        quantity="11",
                    ),
                ],
            )
            await post(
                18,
                [
                    c(
                        "repay",
                        position_id=other_loan,
                        source_position_id=other_debtpos,
                        repay_qty="12",
                        interest_qty="0",
                    )
                ],
            )
            assert (
                await sql(
                    "SELECT (metadata->>'borrowed_quantity')::numeric FROM budgeting.crypto_protocol_positions WHERE id=$1",
                    other_loan,
                )
                == 0
            )
            cash = await sql(
                "SELECT sum((budgeting.get__crypto_position_entry_summary(id)->>'remaining_cost_basis')::numeric) FROM budgeting.portfolio_positions WHERE owner_user_id=$1 AND status='open'",
                uid,
            )
            protocol_cash = await sql(
                "SELECT sum(cost_basis_in_base) FROM budgeting.crypto_protocol_positions WHERE owner_user_id=$1 AND status='open'",
                uid,
            )
            expense = await sql(
                "SELECT sum(COALESCE((metadata->>'funding_interest_cost')::numeric,0)+COALESCE((metadata->>'funding_confirmed_cost')::numeric,0)) FROM budgeting.portfolio_events WHERE created_by_user_id=$1",
                uid,
            )
            assert cash + protocol_cash + expense == 11200
            assert (
                await sql(
                    "SELECT (metadata->'funding_units'->>$2)::numeric FROM budgeting.portfolio_events WHERE position_id=$1 AND metadata->>'target_kind'='lending_repay' ORDER BY id LIMIT 1",
                    other_debtpos,
                    str(other_loan),
                )
                is None
            )
            # Group collateral legs by on-chain account without changing money.
            master = "0:" + "a" * 64
            user_contract = "0:" + "b" * 64
            for number, protocol in [(30, loan), (31, other_loan)]:
                await post(
                    number,
                    [
                        c(
                            "tag_lending_account",
                            position_id=protocol,
                            master_contract=master,
                            user_contract=user_contract,
                        )
                    ],
                )
            await post(
                32,
                [
                    c(
                        "tag_lending_account",
                        position_id=loan,
                        master_contract=master,
                        user_contract="0:" + "c" * 64,
                    )
                ],
                400,
            )
            r = await post(
                33,
                [
                    c(
                        "create_protocol",
                        investment_account_id=inv,
                        protocol_name="Unsecured technical loan",
                        position_type="lending",
                        asset_symbol="LCOLL",
                        crypto_asset_id=collateral,
                        quantity="0",
                        cost_basis_in_base="0",
                    )
                ],
            )
            empty_loan = r["results"][0]["id"]
            assert D(str(r["results"][0]["cost_basis_in_base"])) == 0
            await post(
                34,
                [
                    c(
                        "create_protocol",
                        investment_account_id=inv,
                        protocol_name="Invalid unbacked capital",
                        position_type="lending",
                        asset_symbol="LCOLL",
                        quantity="0",
                        cost_basis_in_base="1",
                    )
                ],
                400,
            )
            await post(
                35,
                [
                    c(
                        "tag_lending_account",
                        position_id=empty_loan,
                        master_contract=master,
                        user_contract=user_contract,
                    )
                ],
            )
            await post(
                36,
                [
                    c(
                        "borrow",
                        position_id=empty_loan,
                        borrowed_crypto_asset_id=debt,
                        debt_qty="1",
                        funding_policy="components",
                    )
                ],
            )
            await post(
                37,
                [
                    c(
                        "borrow",
                        position_id=other_loan,
                        borrowed_crypto_asset_id=debt,
                        debt_qty="1",
                        funding_policy="components",
                    )
                ],
                400,
            )
            assert (
                await sql(
                    "SELECT count(*) FROM budgeting.crypto_source_events WHERE anchor_account_id=$1 AND source_id='37'",
                    inv,
                )
                == 0
            )
            debt_position = await sql(
                "SELECT (metadata->>'borrowed_position_id')::bigint FROM budgeting.crypto_protocol_positions WHERE id=$1",
                empty_loan,
            )
            sale_qty = await sql(
                "SELECT quantity FROM budgeting.portfolio_positions WHERE id=$1",
                debt_position,
            )
            sale = await post(
                38,
                [
                    c(
                        "sell_fiat",
                        investment_account_id=inv,
                        bank_account_id=bank,
                        crypto_asset_id=debt,
                        quantity=str(sale_qty),
                        fiat_currency_code="USD",
                        fiat_amount="1",
                        historical_value_in_base="90",
                        valuation_source="Synthetic historical rate",
                        defer_manual_expense=True,
                    )
                ],
            )
            sale_id = sale["results"][0]["event_id"]
            sale_before = await sql(
                "SELECT metadata FROM budgeting.portfolio_events WHERE id=$1", sale_id
            )
            assert D(str(sale_before["funding_units"][str(empty_loan)])) == 1
            await sql("SELECT budgeting.put__record_income($1,$2,100,'RUB')", uid, bank)
            bought = await post(
                39,
                [
                    c(
                        "bank_buy",
                        bank_account_id=bank,
                        crypto_asset_id=debt,
                        quantity="1",
                        fiat_currency_code="RUB",
                        fiat_amount="100",
                    ),
                    c(
                        "bank_to_portfolio",
                        bank_account_id=bank,
                        investment_account_id=inv,
                        crypto_asset_id=debt,
                        quantity="1",
                    ),
                ],
            )
            await post(
                40,
                [
                    c(
                        "repay",
                        position_id=empty_loan,
                        source_position_id=bought["results"][1]["position_id"],
                        repay_qty="1",
                        interest_qty="0",
                    )
                ],
            )
            sale_after = await sql(
                "SELECT metadata FROM budgeting.portfolio_events WHERE id=$1", sale_id
            )
            assert sale_after["funding_units"] == {}
            assert D(str(sale_after["funding_confirmed_cost"])) == 100
            assert (
                D(str(sale_before["realized_in_base"]))
                - D(str(sale_after["realized_in_base"]))
                == 100
            )
            assert (
                await sql(
                    "SELECT amount FROM budgeting.current_bank_balances WHERE bank_account_id=$1 AND currency_code='USD'",
                    bank,
                )
                == 1
            )
            print(
                "PASS: funded card conversion retains financing; payoff refines cost/result without changing fiat proceeds"
            )
            print(
                "PASS: immutable lending identity, empty loan, no unbacked cash, duplicate account debt rejected atomically"
            )
            print(
                "PASS: refinancing replaces principal units across assets/protocols/expenses; interest remains expense; new-loan payoff resolves costs; retry and RUB conservation"
            )
            print(
                "PASS: funded collateral top-up, liquidation self-cancellation, expense allocation, cash conservation, rollback, retry, unsupported funded sale guard"
            )
    finally:
        await pool.close()


asyncio.run(main())
