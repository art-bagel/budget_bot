"""Read-only matching of a bank backup against the chronological crypto plan.

Candidates are review evidence, never authorization to delete or skip operations.
Money is calculated with Decimal; reversed operations and post-cutoff data remain
explicitly separate. Inputs and generated reports are private local artifacts.
"""

import argparse
from datetime import date
from decimal import Decimal
import json
from pathlib import Path


def amount(value):
    return Decimal(str(value))


def audit(inventory, plan):
    operations = {o["id"]: o for o in inventory["operations"]}
    reversed_ids = {
        o["reversal_of_operation_id"]
        for o in operations.values()
        if o.get("reversal_of_operation_id") is not None
    }
    cutoff = max(r["accounting_date"] for r in plan["rows"])
    purchases, cards, friend_sales = [], [], []
    for row in plan["rows"]:
        for command in row["commands"]:
            payload = command["payload"]
            item = dict(source_id=row["source_id"], date=row["accounting_date"], **payload)
            if command["kind"] == "bank_buy":
                purchases.append(item)
            elif command["kind"] == "sell_fiat":
                cards.append(item)
            elif command["kind"] == "bank_sell":
                friend_sales.append(item)

    def active(op):
        return op["id"] not in reversed_ids and op["type"] != "reversal"

    purchase_matches, card_matches, after_cutoff = [], [], []
    crypto_by_operation = {}
    for entry in inventory["crypto_bank_entries"]:
        crypto_by_operation.setdefault(entry["operation_id"], []).append(entry)
    for op in operations.values():
        entries = crypto_by_operation.get(op["id"], [])
        if not entries or not active(op):
            continue
        if op["operated_on"] > cutoff:
            after_cutoff.append(dict(operation=op, crypto_entries=entries))
            continue
        rub = -sum(
            (amount(e["amount"]) for e in inventory["bank_entries"]
             if e["operation_id"] == op["id"] and e["currency_code"] == "RUB"),
            Decimal(0),
        )
        if op["type"] == "exchange" and rub > 0:
            candidates = []
            for p in purchases:
                days = abs((date.fromisoformat(p["date"]) - date.fromisoformat(op["operated_on"])).days)
                if days <= 1:
                    delta = amount(p["fiat_amount"]) - rub
                    # Include nonmatching server estimates, but don't bless them.
                    candidates.append(dict(source_id=p["source_id"], date=p["date"],
                        rub=p["fiat_amount"], quantity=p["quantity"], rub_difference=str(delta)))
            purchase_matches.append(dict(operation_id=op["id"], date=op["operated_on"],
                existing_RUB=str(rub), crypto_entries=entries, candidates=candidates,
                status="review_required"))
        elif op["type"] == "expense":
            spent = -sum((amount(e["amount"]) for e in entries), Decimal(0))
            candidates = []
            for c in cards:
                days = abs((date.fromisoformat(c["date"]) - date.fromisoformat(op["operated_on"])).days)
                delta = amount(c["fiat_amount"]) - spent
                if days <= 8 and abs(delta) <= Decimal("0.21"):
                    candidates.append(dict(source_id=c["source_id"], date=c["date"],
                        paid_USD=c["fiat_amount"], debited_crypto=c["quantity"],
                        nominal_difference=str(delta)))
            card_matches.append(dict(operation_id=op["id"], date=op["operated_on"],
                comment=op["comment"], existing_crypto_amount=str(spent),
                budget_entries=[e for e in inventory["budget_entries"] if e["operation_id"] == op["id"]],
                candidates=candidates, status="review_required"))

    return dict(
        mode="read_only_candidates_no_mutations", cutoff=cutoff,
        purchase_matches=purchase_matches, card_matches=card_matches,
        post_cutoff_preserve=after_cutoff,
        reversals_preserve=sorted(reversed_ids),
        existing_purchase_RUB=str(sum((amount(p["existing_RUB"]) for p in purchase_matches), Decimal(0))),
        full_plan_funding_RUB=str(sum((amount(r.get("funding_RUB", 0)) for r in plan["rows"]), Decimal(0))),
        friend_sale_receipts_RUB=str(sum((amount(p["fiat_amount"]) for p in friend_sales), Decimal(0))),
        card_conversions_USD=str(sum((amount(c["fiat_amount"]) for c in cards), Decimal(0))),
        unmatched_cards=[c for c in cards if not any(
            x["source_id"] == c["source_id"] for m in card_matches for x in m["candidates"])],
        policy={
            "income": "Do not create income or isolated funding fixtures",
            "funding": "Release only missing funding from expense 19911; preserve other 2025-12-31 expenses",
            "friend_receipts": "Bank exchange proceeds, then expense in original unaccounted category on 2025-12-31",
            "cards": "Keep existing categories once; leave unallocated USD on bank account; no portfolio pending widget",
            "legacy": "Do not retain duplicate crypto holdings; preserve original audit and replacement links",
            "future": "Preserve purchases/expenses after cutoff; do not claim cutoff holdings are today's balance",
        },
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = audit(json.loads(args.inventory.read_text()), json.loads(args.plan.read_text()))
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({k: v for k, v in result.items() if k.endswith(("RUB", "USD"))}, ensure_ascii=False))
