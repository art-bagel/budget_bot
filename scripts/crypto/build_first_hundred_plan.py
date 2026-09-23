"""Compose all main events with chronological funding and owned-wallet dependencies."""

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo

from build_first_block_replay import BASE, PIN, TON, USDT, build
from build_history_inventory import ROOT, git
from compile_first_hundred import compile_all
from compile_main_commands import ref


def build_plan():
    plan = build()
    compiled = compile_all()
    assert compiled["summary"]["command_mapped"] == 100
    events = json.loads(
        (
            ROOT / "outputs/crypto-history-inventory-2026-09-23-v2/main-events.json"
        ).read_text()
    )[:100]
    movements = json.loads(
        (
            ROOT / "outputs/crypto-history-inventory-2026-09-23-v2/main-movements.json"
        ).read_text()
    )[:295]
    rows = list(plan["rows"])
    balances = defaultdict(Decimal)
    checkpoints = {}
    for m in movements:
        balances[m["master"]] += Decimal(m["quantity_delta"])
        checkpoints[m["event_no"]] = {k: str(v) for k, v in balances.items()}
    for r in compiled["events"][11:]:
        n = r["event_no"]
        rows.append(
            dict(
                source_id="main:" + r["event_id"],
                event_no=n,
                occurred_at=r["occurred_at"],
                accounting_date=r["accounting_date"],
                order_in_timestamp=int(events[n - 1]["lt"]),
                commands=r["commands"],
                evidence=r["evidence"],
                expected_main={} if n == 60 else checkpoints[60 if n==61 else n],
            )
        )

    def cmd(kind, **payload):
        return dict(kind=kind, payload=payload)

    def pos(wallet, asset):
        return ref("position", wallet, "ton", asset)

    def source(source_id, date, time, order, evidence, commands, funding=None):
        when = (
            datetime.fromisoformat(date + "T" + time)
            .replace(tzinfo=ZoneInfo("Europe/Moscow"))
            .astimezone(timezone.utc)
        )
        row = dict(
            source_id=source_id,
            occurred_at=when.isoformat(),
            accounting_date=date,
            order_in_timestamp=order,
            evidence=evidence,
            commands=commands,
        )
        if funding is not None:
            row["funding_RUB"] = funding
        rows.append(row)

    def buy(source_id, date, time, order, wallet, asset, quantity, money, evidence):
        source(
            source_id,
            date,
            time,
            order,
            evidence,
            [
                cmd(
                    "bank_buy",
                    bank_account_id=ref("account", "primary_cash"),
                    crypto_asset_id=ref("asset", "ton", asset),
                    quantity=quantity,
                    fiat_currency_code="RUB",
                    fiat_amount=money,
                    comment="Покупка за рубли: " + source_id,
                ),
                cmd(
                    "bank_to_portfolio",
                    bank_account_id=ref("account", "primary_cash"),
                    investment_account_id=ref("account", wallet),
                    crypto_asset_id=ref("asset", "ton", asset),
                    quantity=quantity,
                ),
            ],
            money,
        )

    purchases = json.loads(
        (
            ROOT
            / "outputs/crypto-telegram-history-2026-09-23-v2/telegram-purchases.json"
        ).read_text()
    )
    for p in purchases:
        if not 21 < p["source_row"] <= 65:
            continue
        assert p["basis_quality"] == "known"
        qty = Decimal(p["quantity"])
        # One feasible nearest-cent scenario, NOT claimed exact quantities.
        # Without uncertainty handling nominal rounded rows create -0.02 USDT.
        adjustment = (
            Decimal("0.0025")
            if p["asset"] == "USDT" and p["source_row"] <= 51
            else Decimal(0)
        )
        if adjustment:
            assert (qty + adjustment).quantize(Decimal("0.01")) == qty
        evidence = {
            "purchase": p,
            "quantity_scenario_adjustment": str(adjustment),
            "quantity_quality": "bounded_rounding_scenario"
            if adjustment
            else "source_nominal",
            "time_quality": "source_minute"
            if p["time_as_in_source"]
            else "date_only_before_withdrawals_ordering_placeholder",
            "limitation": "A feasible rounded-quantity scenario; not an exact cost estimate or interval extremes",
        }
        buy(
            p["source_key"],
            p["date"],
            p["time_as_in_source"] or "00:00",
            p["source_row"],
            "telegram",
            TON if p["asset"] == "TON" else USDT,
            str(qty + adjustment),
            p["fiat_amount"],
            evidence,
        )
    bybit = json.loads(
        (
            ROOT / "outputs/crypto-history-inventory-2026-09-23-v2/bybit-rows.json"
        ).read_text()
    )
    br = {r["_source_line"]: r for r in bybit}
    for n in (2, 12, 15):
        r = dict(br[n])
        local=datetime.fromisoformat(r['Дата']+'T'+r['Время']).replace(tzinfo=timezone.utc).astimezone(ZoneInfo('Europe/Moscow'))
        r['Дата'],r['Время']=local.date().isoformat(),local.time().isoformat()
        buy(
            "bybit:line:" + str(n),
            r["Дата"],
            r["Время"],
            n,
            "exchange_source",
            USDT,
            r["Изменение"].replace(",", "."),
            r["₽"].replace(",", "."),
            {
                "source": r,
                "presentation": "internal calculation; no detailed Bybit user feed",
            },
        )
    for group in [(7, 8), (18, 19, 20, 21)]:
        rs = [dict(br[n]) for n in group]
        local=datetime.fromisoformat(rs[0]['Дата']+'T'+rs[0]['Время']).replace(tzinfo=timezone.utc).astimezone(ZoneInfo('Europe/Moscow'))
        for r in rs:
            r['Дата'],r['Время']=local.date().isoformat(),local.time().isoformat()
        net_ton = sum(
            Decimal(r["Изменение"].replace(",", ".")) for r in rs if r["Актив"] == "TON"
        )
        spent = -sum(
            Decimal(r["Изменение"].replace(",", "."))
            for r in rs
            if r["Актив"] == "USDT"
        )
        fee = Decimal("0.018738") if group[0] == 7 else Decimal("0.030410")
        source(
            "bybit:trade-group:" + str(group[0]),
            rs[0]["Дата"],
            rs[0]["Время"],
            group[0],
            {
                "rows": rs,
                "fee_asset_assumption": "TON as accepted in previous audit",
                "presentation": "internal calculation",
            },
            [
                cmd(
                    "swap",
                    position_id=pos("exchange_source", USDT),
                    from_amount=str(spent),
                    to_crypto_asset_id=ref("asset", "ton", TON),
                    to_amount=str(net_ton + fee),
                    value_in_base=None,
                )
            ],
        )
        # Separate timestamp is necessary to bind the newly created TON position.
        source(
            "bybit:trade-fee:" + str(group[0]),
            rs[0]["Дата"],
            rs[0]["Время"],
            group[0] + 1,
            {"rows": rs, "fee_asset_assumption": "TON"},
            [
                cmd(
                    "fee",
                    source_position_id=pos("exchange_source", TON),
                    quantity=str(fee),
                )
            ],
        )
    facts = json.loads(git("show", PIN + ":" + BASE + "closure-facts.json"))[
        "intermediate72_73"
    ]
    swap = facts["swap"]
    at = datetime.fromtimestamp(swap["timestamp"], ZoneInfo("Europe/Moscow"))
    source(
        "intermediate:" + swap["event_id"],
        at.date().isoformat(),
        at.time().isoformat(),
        0,
        {
            "swap": swap,
            "final_allocation": facts["allocation_after_excess"],
            "policy": "net technical cost after confirmed excess; not a market valuation",
        },
        [
            cmd(
                "swap",
                position_id=pos("intermediate", TON),
                from_amount=swap["ton_in"],
                to_crypto_asset_id=ref("asset", "ton", swap["jetton_master"]),
                to_amount=swap["jetton_out"],
                value_in_base=None,
            ),
            cmd(
                "expense",
                source_position_id=pos("intermediate", TON),
                quantity=facts["allocation_after_excess"][
                    "separate_second_transfer_TON"
                ],
                comment="Внешний платёж с промежуточного кошелька, назначение неизвестно",
            ),
            cmd(
                "fee",
                source_position_id=pos("intermediate", TON),
                quantity=facts["allocation_after_excess"][
                    "swap_and_wallet_technical_cost_TON"
                ],
            ),
        ],
    )
    # Exact final 18 nano-TON adjustment is dated at the boundary only, not
    # silently assigned a made-up earlier timestamp.
    last = events[-1]
    at = datetime.fromtimestamp(last["timestamp"], ZoneInfo("Europe/Moscow"))
    source(
        "intermediate:boundary100-network",
        at.date().isoformat(),
        at.time().isoformat(),
        int(last["lt"]) + 1,
        {
            "evidence": facts["at_event100"],
            "time_quality": "boundary adjustment; original transaction timestamp requires retrieval",
        },
        [
            cmd(
                "fee",
                source_position_id=pos("intermediate", TON),
                quantity=facts["at_event100"]["additional_network_TON"],
            )
        ],
    )
    rows.sort(key=lambda r: (r["occurred_at"], r["order_in_timestamp"]))
    assert len({r["source_id"] for r in rows}) == len(rows)
    for event in plan["events"]:
        event["status"] = "command_mapped"
    plan["rows"] = rows
    plan["summary"]["command_counts"] = dict(Counter(c["kind"] for r in rows for c in r["commands"]))
    plan["summary"].update(
        compiled_contiguous_prefix=100,
        source_events=len(rows),
        first_unimplemented_event=None,
        first_unimplemented_kind=None,
        block_closed=False,
    )
    plan["summary"]["documented_funding_RUB"] = str(
        sum(Decimal(r.get("funding_RUB", "0")) for r in rows)
    )
    assert Decimal(plan["summary"]["documented_funding_RUB"]) == 682424
    plan["internal_accounts"] = [
        "exchange_source",
        "battery",
        "redemption_47",
        "redemption_64",
    ]
    plan["limitations"] = [
        "Rounded Telegram quantities are one feasible scenario, not exact",
        "Internal Bybit presentation still requires suppression in UI",
        "Intermediate final 18 nano-TON time assigned to boundary explicitly",
        "EVAA residuals are last-observed values; boundary100 index not provided",
        "Missing historical swap/loan valuations stay unknown",
        "Event60 checkpoint deferred to combined event61",
    ]
    for name in (
        "scripts/crypto/compile_first_hundred.py",
        "scripts/crypto/build_first_hundred_plan.py",
        "scripts/crypto/verify_first_evaa_rates.py",
    ):
        plan["inputs"].append(
            dict(
                path=name,
                sha256=hashlib.sha256((ROOT / name).read_bytes()).hexdigest(),
                commit=None,
            )
        )
    return plan


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    result = build_plan()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result["summary"], ensure_ascii=False))
