"""Decode historical per-operation EVAA rates, rather than today's contract state."""

import hashlib
import json
from build_first_block_replay import PIN
from build_history_inventory import git
from verify_evaa_liquidations import nodes, command


def verify():
    records = []
    for name, tx, op, symbol, principal, tail in [
        (
            "trace-74",
            "e70e056242b4f3fab64372d27aa4befc2929c0ac476244eb35536d095133fb2c",
            0x11,
            "USDT",
            245592042,
            490,
        ),
        (
            "trace-78",
            "680a28f1269585461d2a91294052b7d19ddcf25979aea633b77ea304585aee47",
            0x21,
            "stTON",
            78230001667,
            97793,
        ),
    ]:
        path = (
            "crypto-task/crypto-reconciliation/work/evaa-early-repayment/sources/"
            + name
            + ".json"
        )
        raw = git("show", PIN + ":" + path)
        trace = json.loads(raw)
        assert trace["emulated"] is False
        transaction = next(
            n["transaction"] for n in nodes(trace) if n["transaction"]["hash"] == tx
        )
        assert transaction["success"] and not transaction["aborted"]
        assert (
            transaction["account"]["address"]
            == "0:5d91ed4b48349e0d1d742a6501ef0ae564e699da405f6eb184c7684a1ca5fc6c"
        )
        _, bits, version, upgrade, actual_op, query = command(
            transaction["in_msg"]["raw_body"]
        )
        assert version == 4 and actual_op == op and query == 0
        asset, requested, supply, borrow = (
            bits.u(256),
            bits.u(64),
            bits.u(64),
            bits.u(64),
        )
        assert asset == int(hashlib.sha256(symbol.encode()).hexdigest(), 16)
        rate = borrow if symbol == "USDT" else supply
        before = principal * rate // 10**12
        after = tail * rate // 10**12
        if symbol == "USDT":
            assert requested == 201655060 and before - requested == after == 402
        else:
            assert requested == 2**64 - 1 and after == 78288
            assert (
                before - 62627103669 - after == 1
            )  # integer principal conversion remainder
        records.append(
            dict(
                asset=symbol,
                source=path,
                sha256=hashlib.sha256(raw).hexdigest(),
                transaction=tx,
                supply_rate=str(supply),
                borrow_rate=str(borrow),
                principal_before=str(principal),
                principal_after=str(tail),
                before_atomic=str(before),
                after_atomic=str(after),
                rate_scale="1000000000000",
                valid_at=transaction.get("utime"),
                boundary_quantity_current_at_event100=False,
            )
        )
    return records


if __name__ == "__main__":
    print(json.dumps(verify(), ensure_ascii=False, indent=2))
