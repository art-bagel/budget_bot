"""Audit EVAA account identities and fifth-block prerequisites from pinned evidence.

Read only. Symbols are display aliases; grouping uses owner + master contract.
A protocol-position id remains a loan-episode id, NOT a separate EVAA account.
"""

import argparse
import base64
import binascii
from collections import Counter
import hashlib
import json
from pathlib import Path

from build_first_block_replay import PIN
from build_history_inventory import BLOCKS, git

WORK = "crypto-task/crypto-reconciliation/work/"
MASTER_A = "0:bcad466a47fa565750729565253cd073ca24d856804499090c2100d95c809f9e"
MASTER_B = "0:489595f65115a45c24a0dd0176309654fb00b95e40682f0c3e85d5a4d86dfb25"
USER_A = "0:5d91ed4b48349e0d1d742a6501ef0ae564e699da405f6eb184c7684a1ca5fc6c"
USER_B = "0:213d65fc95c60289d8f5d5b24fd34f9fe8e7f49588095cbf5c5c618f8fd28a1d"
STTON = "0:cd872fa7c5816052acdf5332260443faec9aacc8c21cca4d92e7f47034d11892"


def friendly(raw):
    wc, digest = raw.split(":")
    payload = bytes([0x51, int(wc) & 255]) + bytes.fromhex(digest)
    return base64.urlsafe_b64encode(
        payload + binascii.crc_hqx(payload, 0).to_bytes(2, "big")
    ).decode()


def audit():
    inputs = []

    def read(path):
        raw = git("show", PIN + ":" + path)
        inputs.append(dict(path=path, sha256=hashlib.sha256(raw).hexdigest()))
        return json.loads(raw)

    scope = read(WORK + "evaa-debt-lifecycle/result.json")["scope"]
    assert scope["user_contract"] == USER_A and scope["master_contract"] == MASTER_A
    ledger = read(WORK + "evaa-debt-lifecycle/account-ledger.json")
    history = read(WORK + "evaa-debt-lifecycle/account-history.json")
    txs = {t["hash"]: t for t in history["transactions"]}
    for row in ledger:
        tx = txs[row["transaction"]]
        assert tx["account"] == USER_A
        assert tx["success"] and not tx["aborted"]
    # Distinct episodes on the same account: the old USDT debt was closed
    # before the TON loan, itself closed before the later USDT borrowings.
    early_close = next(
        r
        for r in ledger
        if r.get("principal_before") == -490 and r.get("principal_after") == 0
    )
    ton_borrow = next(
        r for r in ledger if r.get("kind") == "debt_borrow" and r["asset"] == "TON"
    )
    ton_close = next(
        r for r in ledger if r.get("kind") == "debt_repayment" and r["asset"] == "TON"
    )
    late_borrow = next(
        r
        for r in ledger
        if r.get("kind") == "debt_borrow" and r.get("amount") == "1058.469413"
    )
    assert (
        early_close["timestamp"]
        < ton_borrow["timestamp"]
        < ton_close["timestamp"]
        < late_borrow["timestamp"]
    )
    assert ton_close["principal_after"] == 0
    events = []
    for block, version in BLOCKS[:5]:
        events.extend(
            read(
                f"crypto-task/chronological-rebuild/blocks/{block}/accepted/{version}/events-source.json"
            )
        )
    assert len(events) == 500
    owner = events[0]["account"]["address"]
    matches = []
    for number, event in enumerate(events, 1):
        assert event["account"]["address"] == owner
        masters = set()
        for action in event["actions"]:
            if action["status"] != "ok":
                continue
            detail = action.get(action["type"], {})
            for role in ("contract", "sender", "recipient"):
                address = detail.get(role, {}).get("address")
                if address in (MASTER_A, MASTER_B):
                    masters.add(address)
            if (
                action["type"] == "JettonTransfer"
                and detail["jetton"]["address"] == STTON
            ):
                assert detail["jetton"]["symbol"] in ("stTON", "stGRAM")
        if masters:
            assert len(masters) == 1
            matches.append(
                dict(
                    event_no=number,
                    event_id=event["event_id"],
                    master=masters.pop(),
                    timestamp=event["timestamp"],
                )
            )
    by_no = {r["event_no"]: r["master"] for r in matches}
    for n in (326, 330, 331, 424, 445, 495):
        assert by_no[n] == MASTER_A
    for n in (443, 444, 458, 459, 494, 499):
        assert by_no[n] == MASTER_B
    borrow = next(
        a["JettonTransfer"]
        for a in events[443]["actions"]
        if a["type"] == "JettonTransfer"
    )
    repay = next(
        a["JettonTransfer"]
        for a in events[444]["actions"]
        if a["type"] == "JettonTransfer"
    )
    assert borrow["amount"] == repay["amount"] == "700000000"
    assert borrow["jetton"]["address"] == repay["jetton"]["address"]
    assert (
        borrow["sender"]["address"] == MASTER_B
        and repay["recipient"]["address"] == MASTER_A
    )
    assert borrow["recipient"]["address"] == repay["sender"]["address"] == owner
    assert any(
        a["type"] == "TonTransfer" and a["TonTransfer"]["sender"]["address"] == USER_B
        for a in events[443]["actions"]
    )
    reviews = read(
        "crypto-task/chronological-rebuild/blocks/0401-0500/accepted/v1/economic-review.json"
    )
    return dict(
        source_commit=PIN,
        source_files=inputs,
        status="identity_audit_passed_not_a_replay",
        inspected_main_events=500,
        main_events_applied=400,
        grouping_key=["owner", "network", "master_contract", "user_contract"],
        accounts=[
            dict(
                owner=friendly(owner),
                master=friendly(m),
                user_contract=friendly(u),
                master_raw=m,
                user_raw=u,
            )
            for m, u in [(MASTER_A, USER_A), (MASTER_B, USER_B)]
        ],
        aliases={"native TON": ["TON", "GRAM"], STTON: ["stTON", "stGRAM"]},
        evidence=matches,
        early_USDT_closed_at=early_close["date_UTC"],
        December_TON_closed_at=ton_close["date_UTC"],
        refinance=dict(
            borrow_event=444,
            repayment_event=445,
            quantity="700",
            asset="USDT",
            source_master=MASTER_B,
            target_master=MASTER_A,
            new_own_fiat="0",
        ),
        fifth_block_categories=dict(Counter(r["category"] for r in reviews)),
        remaining_before_accepting_500=[
            "Shared-account collateral representation; no duplicated debt per collateral",
            "Compile exact indexed EVAA accruals/withdrawals/repayments and refinance",
            "Carry LP, gift-service returns, own-wallet movements, Bybit sources and PT/YT split",
            "Run 401-500 independently, compare every checkpoint, then append visible user and repeat",
        ],
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = audit()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(
        f"PASS: 500 source events inspected; {len(report['evidence'])} EVAA events mapped to 2 accounts. Applied boundary remains 400."
    )
