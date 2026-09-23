"""Compile the complete hundred in one pass; unresolved dependencies stay explicit.

This is a command preparation report, never a posting or closure claim.
"""

import argparse
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
import json
from pathlib import Path
from zoneinfo import ZoneInfo

from audit_first_block_requirements import GROUPS
from build_first_block_replay import BASE, PIN, TON, USDT, build
from build_history_inventory import ROOT, git
from compile_main_commands import ref
from verify_first_evaa_rates import verify as verify_rates

ST = "0:cd872fa7c5816052acdf5332260443faec9aacc8c21cca4d92e7f47034d11892"


def compile_all():
    prefix = build()
    rates = verify_rates()
    stton = json.loads(
        git(
            "show",
            PIN
            + ":crypto-task/crypto-reconciliation/work/early-stton-capital/result.json",
        )
    )
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
    reviews = json.loads(git("show", PIN + ":" + BASE + "review.json"))
    lots = json.loads(
        git(
            "show",
            PIN
            + ":crypto-task/chronological-rebuild/blocks/0001-0100/lp-lifecycle.json",
        )
    )["lots"]
    facts = json.loads(git("show", PIN + ":" + BASE + "closure-facts.json"))
    dedust = json.loads(
        git(
            "show",
            PIN
            + ":crypto-task/crypto-reconciliation/work/early-dedust-usdt-ton/result.json",
        )
    )
    telegram = json.loads(
        (
            ROOT
            / "outputs/crypto-telegram-history-2026-09-23-v2/telegram-source-rows.json"
        ).read_text()
    )
    usdt_links = json.loads(
        (
            ROOT
            / "outputs/crypto-telegram-history-2026-09-23-v2/telegram-main-usdt-links.json"
        ).read_text()
    )
    row_event = {r["source_row"]: r["event_no"] for r in movements}
    groups = {n: g for g, ns in GROUPS.items() for n in ns}
    net = defaultdict(lambda: defaultdict(Decimal))
    for r in movements:
        net[r["event_no"]][r["master"]] += Decimal(r["quantity_delta"])
    mint = {lot["mint_event"]: lot for lot in lots}
    custody = {row_event[lot["stake_row"]]: lot for lot in lots if lot["stake_row"]}
    back = {row_event[lot["return_row"]]: lot for lot in lots if lot["return_row"]}
    symbols = prefix["assets"]
    output = []

    def pos(wallet, asset=TON):
        return ref("position", wallet, "ton", asset)

    def cmd(kind, **payload):
        return dict(kind=kind, payload=payload)

    def fee(q):
        assert q > 0
        return cmd("fee", source_position_id=pos("main"), quantity=str(q))

    def reward(asset, q):
        return cmd(
            "reward",
            investment_account_id=ref("account", "main"),
            crypto_asset_id=ref("asset", "ton", asset),
            quantity=str(q),
        )

    def protocol(lot):
        return ref("protocol", events[lot["mint_event"] - 1]["event_id"])

    for e in events:
        n = e["event_no"]
        d = net[n]
        actions = e["raw"]["actions"]
        group = groups[n]
        commands = []
        blockers = []
        principal = Decimal(0)
        incoming = Decimal(0)
        if n <= 11:
            commands = next(
                r["commands"] for r in prefix["rows"] if r.get("event_no") == n
            )
        elif n == 12:
            principal = Decimal("65")
            commands = [
                cmd(
                    "staking_convert",
                    position_id=pos("main"),
                    from_amount=str(principal),
                    to_crypto_asset_id=ref("asset", "ton", ST),
                    to_amount=str(d[ST]),
                    comment="bemo: TON → stTON с переносом стоимости",
                )
            ]
        elif n == 13:
            commands = [
                cmd(
                    "create_protocol",
                    investment_account_id=ref("account", "main"),
                    protocol_name="EVAA",
                    position_type="lending",
                    asset_symbol=symbols[ST]["symbol"],
                    quantity=str(-d[ST]),
                    source_position_id=pos("main", ST),
                    crypto_asset_id=ref("asset", "ton", ST),
                    network_code="ton",
                    metadata={
                        "source_event_id": e["event_id"],
                        "chain_collateral_principal": "78230001667",
                    },
                )
            ]
        elif n == 14:
            principal = Decimal(facts["battery"]["payment_TON"])
            commands = [
                cmd(
                    "transfer",
                    position_id=pos("main"),
                    target_investment_account_id=ref("account", "battery"),
                    amount=str(principal),
                )
            ]
        elif n == 15:
            incoming = Decimal(actions[0]["TonTransfer"]["amount"]) / 10**9
            commands = [
                cmd(
                    "receive_unknown",
                    investment_account_id=ref("account", "main"),
                    crypto_asset_id=ref("asset", "ton", TON),
                    quantity=str(incoming),
                    comment="Микропоступление: назначение и стоимость неизвестны",
                )
            ]
        elif n == 16:
            commands = [
                cmd(
                    "borrow",
                    position_id=ref("protocol", events[12]["event_id"]),
                    debt_qty="200",
                    value_in_base=None,
                    borrowed_crypto_asset_id=ref("asset", "ton", USDT),
                    comment="EVAA: 200 USDT, историческая рублёвая оценка неизвестна",
                )
            ]
        elif n == 19:
            incoming = Decimal(facts["battery"]["refund_TON"])
            commands = [
                cmd(
                    "transfer",
                    position_id=pos("battery"),
                    target_investment_account_id=ref("account", "main"),
                    amount=str(incoming),
                ),
                cmd(
                    "expense",
                    source_position_id=pos("battery"),
                    quantity=str(Decimal(facts["battery"]["unreturned_TON"])),
                    comment="Невозвращённая оплата батарейки",
                ),
            ]
        elif n in (20, 22):
            incoming = Decimal(actions[0]["TonTransfer"]["amount"]) / 10**9
            commands = [
                cmd(
                    "transfer",
                    position_id=pos("exchange_source"),
                    target_investment_account_id=ref("account", "main"),
                    amount=str(incoming),
                ),
                cmd("fee", source_position_id=pos("exchange_source"), quantity="0.1"),
            ]
        elif n == 30:
            assert (
                rates[0]["before_atomic"] == "201655462"
                and rates[0]["after_atomic"] == "402"
            )
            commands = [
                cmd(
                    "accrue",
                    position_id=ref("protocol", events[12]["event_id"]),
                    collateral_qty="0",
                    interest_qty="1.655462",
                    interest_value_in_base=None,
                    collateral_before="62.623152901",
                    debt_before="200",
                ),
                cmd(
                    "repay",
                    position_id=ref("protocol", events[12]["event_id"]),
                    source_position_id=pos("main", USDT),
                    repay_qty="201.655060",
                    interest_qty="1.655462",
                    value_in_base=None,
                ),
            ]
        elif n == 31:
            assert rates[1]["after_atomic"] == "78288"
            # One nano-token is lost in converting indexed principal to units.
            # Net accrued units equal paid units plus the exact indexed tail.
            yield_qty = (
                d[ST]
                + Decimal(rates[1]["after_atomic"]) / 10**9
                - Decimal("62.623152901")
            )
            commands = [
                cmd(
                    "accrue",
                    position_id=ref("protocol", events[12]["event_id"]),
                    collateral_qty=str(yield_qty),
                    interest_qty="0",
                    interest_value_in_base=None,
                    collateral_before="62.623152901",
                    debt_before="0.000402",
                ),
                cmd(
                    "partial_close_protocol",
                    position_id=ref("protocol", events[12]["event_id"]),
                    principal_qty=str(d[ST]),
                ),
            ]
        elif n in (53, 65):
            origin = 47 if n == 53 else 64
            incoming = (
                Decimal(stton["TON_queued_capital"])
                if n == 53
                else Decimal(facts["stTON65"]["principal_TON_atomic"]) / 10**9
            )
            quantity = "62.627103669" if n == 53 else "6.383335430"
            commands = [
                cmd(
                    "staking_convert",
                    position_id=pos("redemption_" + str(origin), ST),
                    from_amount=quantity,
                    to_crypto_asset_id=ref("asset", "ton", TON),
                    to_amount=str(incoming),
                    target_investment_account_id=ref("account", "main"),
                    comment="Погашение receipt: стоимость переносится; технический возврат отдельно",
                )
            ]
        elif group == "technical_fee_only":
            assert set(d) == {TON} and d[TON] < 0
        elif group == "lp_deposit":
            lot = mint[n]
            legs = [
                (k, -v) for k, v in d.items() if k not in (TON, lot["master"]) and v < 0
            ]
            if len(legs) == 1:
                if n == 52:
                    principal = (
                        Decimal(dedust["deposits"][0]["accepted_TON_nano"]) / 10**9
                    )
                    legs.insert(0, (TON, principal))
                else:
                    principal = (
                        Decimal(facts["dedust83"]["accepted_TON_atomic"]) / 10**9
                        if n == 83
                        else sum(
                            (
                                Decimal(a["TonTransfer"]["amount"]) / 10**9
                                for a in actions
                                if a["type"] == "TonTransfer"
                                and a["TonTransfer"]["sender"]["address"]
                                == e["raw"]["account"]["address"]
                            ),
                            Decimal(0),
                        )
                    )
                    legs.insert(0, (TON, principal))
            if len(legs) == 2:
                (a, qa), (b, qb) = legs
                commands = [
                    cmd(
                        "create_protocol",
                        investment_account_id=ref("account", "main"),
                        protocol_name="DeDust" if n in (52, 83) else "STON.fi",
                        position_type="liquidity_pool",
                        asset_symbol=symbols[a]["symbol"],
                        quantity=str(qa),
                        source_position_id=pos("main", a),
                        crypto_asset_id=ref("asset", "ton", a),
                        secondary_source_position_id=pos("main", b),
                        secondary_quantity=str(qb),
                        network_code="ton",
                        metadata={
                            "lp_receipt": dict(
                                master=lot["master"],
                                quantity=lot["quantity"],
                                custody="main",
                                event_id=e["event_id"],
                            )
                        },
                    )
                ]
        elif group == "lp_custody":
            lot = custody[n]
            commands = [
                cmd(
                    "lp_custody",
                    position_id=protocol(lot),
                    receipt_master=lot["master"],
                    quantity=lot["quantity"],
                    from_custody="main",
                    to_custody=lot["custody_address"],
                )
            ]
        elif group == "lp_return_and_separate_rewards":
            lot = back[n]
            commands = [
                cmd(
                    "lp_custody",
                    position_id=protocol(lot),
                    receipt_master=lot["master"],
                    quantity=lot["quantity"],
                    from_custody=lot["custody_address"],
                    to_custody="main",
                )
            ]
            for a in actions:
                if (
                    a["type"] == "JettonTransfer"
                    and a["JettonTransfer"]["jetton"]["symbol"] == "pTON"
                ):
                    q = Decimal(a["JettonTransfer"]["amount"]) / 10**9
                    incoming += q
                    commands.append(reward(TON, q))
            for asset, q in d.items():
                if asset not in (TON, lot["master"]) and q > 0:
                    commands.append(reward(asset, q))
        elif group == "lp_redemption_two_assets":
            burned = [
                lot
                for lot in lots
                if lot["burn_row"] and row_event[lot["burn_row"]] == n
            ]
            assert burned
            first = output[burned[0]["mint_event"] - 1]["commands"][0]["payload"]
            primary = first["crypto_asset_id"]["resource_ref"].split("asset:ton:", 1)[1]
            secondary = first["secondary_source_position_id"]["resource_ref"].split(
                "position:main:ton:", 1
            )[1]
            if TON in (primary, secondary):
                incoming = (
                    Decimal(dedust["exit"]["TON_capital_nano"]) / 10**9
                    if n == 89
                    else sum(
                        (
                            Decimal(a["JettonTransfer"]["amount"]) / 10**9
                            for a in actions
                            if a["type"] == "JettonTransfer"
                            and a["JettonTransfer"]["jetton"]["address"]
                            == "0:8cdc1d7640ad5ee326527fc1ad0514f468b30dc84b0173f0e155f451b4e11f7c"
                        ),
                        Decimal(0),
                    )
                )
            returned = {
                asset: incoming if asset == TON else d[asset]
                for asset in (primary, secondary)
            }
            remaining = dict(returned)
            total = sum(Decimal(lot["quantity"]) for lot in burned)
            for i, lot in enumerate(burned):
                allocation = {
                    asset: (
                        remaining[asset]
                        if i == len(burned) - 1
                        else (
                            returned[asset] * Decimal(lot["quantity"]) / total
                        ).quantize(Decimal(1).scaleb(-symbols[asset]["decimals"]))
                    )
                    for asset in returned
                }
                for asset, q in allocation.items():
                    remaining[asset] -= q
                commands.append(
                    cmd(
                        "close_protocol",
                        position_id=protocol(lot),
                        return_quantity=str(allocation[primary]),
                        secondary_return_quantity=str(allocation[secondary]),
                        allocation_policy="equal",
                        comment="Полный выход LP: историческая стоимость 50/50 по принятому правилу",
                    )
                )
        elif group == "swap_unknown_historical_value" or n == 63:
            swap = next(a["JettonSwap"] for a in actions if a["type"] == "JettonSwap")

            def leg(side, swap=swap):
                if swap.get("ton_" + side):
                    return TON, Decimal(swap["ton_" + side]) / 10**9
                token = swap["jetton_master_" + side]
                master = (
                    TON
                    if token["address"]
                    == "0:8cdc1d7640ad5ee326527fc1ad0514f468b30dc84b0173f0e155f451b4e11f7c"
                    else token["address"]
                )
                return master, Decimal(swap["amount_" + side]) / Decimal(
                    10 ** token["decimals"]
                )

            a, qa = leg("in")
            b, qb = leg("out")
            principal = qa if a == TON else Decimal(0)
            incoming = qb if b == TON else Decimal(0)
            commands = [
                cmd(
                    "swap",
                    position_id=pos("main", a),
                    from_amount=str(qa),
                    to_crypto_asset_id=ref("asset", "ton", b),
                    to_amount=str(qb),
                    value_in_base=None,
                )
            ]
        elif group == "reward":
            for asset, q in d.items():
                if asset != TON and q > 0:
                    commands.append(reward(asset, q))
            if n == 88:
                incoming = Decimal(facts["reward88"]["amount_TON"])
                commands.append(reward(TON, incoming))
        elif n in (72, 73, 76, 77):
            asset = (
                TON
                if n in (72, 73)
                else next(k for k, v in d.items() if k != TON and v < 0)
            )
            qty = Decimal(1) if asset == TON else -d[asset]
            wallet = {
                72: "intermediate",
                73: "intermediate",
                76: "second",
                77: "fourth",
            }[n]
            commands = [
                cmd(
                    "transfer",
                    position_id=pos("main", asset),
                    target_investment_account_id=ref("account", wallet),
                    amount=str(qty),
                )
            ]
            if asset == TON:
                principal = qty
        elif group == "telegram_source_transfer":
            if USDT in d:
                link = next(r for r in usdt_links if r["event_no"] == n)
                assert Decimal(link["chain_received"]) == d[USDT]
                commands = [
                    cmd(
                        "transfer",
                        position_id=pos("telegram", USDT),
                        target_investment_account_id=ref("account", "main"),
                        amount=str(d[USDT]),
                    )
                ]
            else:
                row = {21: 27, 29: 37, 34: 45, 41: 50, 48: 53}[n]
                source = next(r for r in telegram if r["source_row"] == row)
                incoming = Decimal(actions[0]["TonTransfer"]["amount"]) / 10**9
                assert Decimal(source["quantity"]) - incoming == Decimal("0.05")
                commands = [
                    cmd(
                        "transfer",
                        position_id=pos("telegram"),
                        target_investment_account_id=ref("account", "main"),
                        amount=str(incoming),
                    ),
                    cmd("fee", source_position_id=pos("telegram"), quantity="0.05"),
                ]
        elif n in (47, 64):
            commands = [
                cmd(
                    "transfer",
                    position_id=pos("main", ST),
                    target_investment_account_id=ref("account", "redemption_" + str(n)),
                    amount=str(-d[ST]),
                )
            ]
        elif n == 27:
            principal = Decimal("9.4")
            commands = [
                cmd(
                    "transfer",
                    position_id=pos("main"),
                    target_investment_account_id=ref("account", "telegram"),
                    amount=str(principal),
                )
            ]
        elif n == 75:
            asset = next(k for k, v in d.items() if k != TON and v < 0)
            commands = [
                cmd(
                    "expense",
                    source_position_id=pos("main", asset),
                    quantity=str(-d[asset]),
                    comment="Адрес не подтверждён своим; назначение неизвестно",
                )
            ]
        else:
            blockers.append(group + ": explicit source/dependency mapping required")
        if n > 11 and not blockers:
            technical = incoming - principal - d.get(TON, Decimal(0))
            if technical > 0:
                commands.append(fee(technical))
            elif technical < 0:
                commands.append(
                    cmd(
                        "fee_refund",
                        investment_account_id=ref("account", "main"),
                        crypto_asset_id=ref("asset", "ton", TON),
                        quantity=str(-technical),
                        comment="Технический возврат: средняя стоимость ранее списанных сетевых сумм",
                    )
                )
        output.append(
            dict(
                event_no=n,
                event_id=e["event_id"],
                group=group,
                commands=commands,
                blockers=blockers,
                occurred_at=datetime.fromtimestamp(
                    e["timestamp"], timezone.utc
                ).isoformat(),
                accounting_date=datetime.fromtimestamp(
                    e["timestamp"], ZoneInfo("Europe/Moscow")
                )
                .date()
                .isoformat(),
                evidence={
                    **reviews[n - 1],
                    **(
                        {
                            "historical_rate_evidence": rates,
                            "collateral_rounding_policy": "net yield excludes 1 nano-token principal conversion remainder",
                        }
                        if n in (30, 31)
                        else {}
                    ),
                },
                ready_for_dependency_binding=not blockers,
                posted=False,
            )
        )
    return dict(
        events=output,
        summary=dict(
            total=100,
            command_mapped=sum(not r["blockers"] for r in output),
            remaining=[
                dict(event_no=r["event_no"], blockers=r["blockers"])
                for r in output
                if r["blockers"]
            ],
            posted_by_this_tool=0,
            block_closed=False,
        ),
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = compile_all()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result["summary"], ensure_ascii=False))
