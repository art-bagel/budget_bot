"""Export one consistent local dev snapshot; never writes to the database."""
import argparse
import asyncio
from datetime import datetime, timezone
from decimal import Decimal as D
import json
import os
import subprocess
import xml.etree.ElementTree as ET
from unittest.mock import AsyncMock, patch

import asyncpg
import httpx

from prepare_docker_history import ROOT, UID, credentials
from check_user_history import fingerprint


def num(value, places=2):
    return '—' if value is None else f'{D(str(value)):,.{places}f}'.replace(',', ' ')


async def run(database):
    db = await asyncpg.connect(**{**credentials(), 'database': database})
    await db.set_type_codec('jsonb', encoder=json.dumps, decoder=json.loads, schema='pg_catalog')
    out = ROOT / 'outputs/crypto-final'
    out.mkdir(parents=True, exist_ok=True)
    try:
        async with db.transaction(isolation='repeatable_read', readonly=True):
            before = await fingerprint(db)
            accounts = await db.fetchval('select budgeting.get__bank_accounts($1,NULL,NULL)', UID)
            accounts = [a for a in accounts if a['account_kind'] == 'investment' and a['investment_asset_type'] == 'crypto']
            assets = await db.fetchval('select budgeting.get__crypto_assets()')
            wallets = []
            for account in accounts:
                rows = await db.fetchval('select budgeting.get__crypto_account_assets($1,$2)', UID, account['id'])
                wallets.extend(dict(row, archived=account['is_archived'], included=not account['is_archived'] and account['include_in_statistics']) for row in rows)
            protocols = await db.fetchval('select budgeting.get__crypto_protocol_positions($1)', UID)
            by_account = {a['id']: a for a in accounts}
            for p in protocols:
                a = by_account[p['investment_account_id']]
                p.update(archived=a['is_archived'], included=not a['is_archived'] and a['include_in_statistics'])
            bank = [dict(r) for r in await db.fetch('''select b.*,a.name from budgeting.current_bank_balances b
                join budgeting.bank_accounts a on a.id=b.bank_account_id where a.owner_user_id=$1 and a.account_kind='cash' ''', UID)]
            crypto_bank = [dict(r) for r in await db.fetch('''select b.*,a.name from budgeting.current_crypto_balances b
                join budgeting.bank_accounts a on a.id=b.bank_account_id where a.owner_user_id=$1 and a.account_kind='cash' ''', UID)]
            summary = await db.fetchval('select budgeting.get__portfolio_summary($1)', UID)
            assert before == await fingerprint(db)
    finally:
        await db.close()
    # Reuse the product quote resolver, including contract identity and stale flags.
    os.environ.setdefault('APP_PORT', '8000')
    os.environ.setdefault('DB_PORT', '5432')
    from backend.app.routers.crypto import get_crypto_prices, reports
    ids = {int(w['crypto_asset_id']) for w in wallets if w['quantity']}
    for p in protocols:
        if p['status'] == 'open':
            ids.add(p['crypto_asset_id'])
            ids.update(int(p['metadata'][key]) for key in ('token1_crypto_asset_id', 'borrowed_crypto_asset_id') if p['metadata'].get(key))
    with patch.object(reports, 'get__crypto_assets', new=AsyncMock(return_value=assets)):
        prices = [p.model_dump(mode='json') for p in await get_crypto_prices(','.join(map(str, sorted(ids))), 'rub', None)]
    fx = None
    async with httpx.AsyncClient(timeout=20) as client:
        try:
            response = await client.get('https://www.cbr.ru/scripts/XML_daily.asp')
            response.raise_for_status()
            root = ET.fromstring(response.content)
            usd = next(v for v in root.findall('Valute') if v.findtext('CharCode') == 'USD')
            fx = dict(rub_per_usd=str(D(usd.findtext('Value').replace(',', '.')) / D(usd.findtext('Nominal'))), date=root.attrib['Date'], source='https://www.cbr.ru/scripts/XML_daily.asp')
        except (httpx.HTTPError, ET.ParseError, StopIteration) as exc:
            fx = dict(error=type(exc).__name__)
    open_protocols = [p for p in protocols if p['status'] == 'open']
    totals = {}
    for key, condition in [('all', lambda r: True), ('included', lambda r: r['included']), ('archived', lambda r: r['archived']), ('excluded', lambda r: not r['archived'] and not r['included'])]:
        totals[key] = sum((D(str(w['remaining_cost_basis'] or 0)) for w in wallets if condition(w)), D(0)) + sum((D(str(p['cost_basis_in_base'] or 0)) for p in open_protocols if condition(p)), D(0))
    assert totals['all'] == totals['included'] + totals['archived'] + totals['excluded']
    data = dict(generated_at=datetime.now(timezone.utc).isoformat(), database=database,
                base_commit=(await asyncio.to_thread(subprocess.check_output, ['git', 'rev-parse', 'HEAD'], text=True)).strip(),
                history_cutoff='2026-09-06T18:13:53+03:00', accounts=accounts, wallets=wallets,
                protocols=protocols, bank=bank, crypto_bank=crypto_bank, summary=summary,
                prices=prices, fx=fx, totals=totals, financial_fingerprints=before)
    (out / 'snapshot.json').write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str))
    prices_by_id = {p['crypto_asset_id']: D(str(p['price'])) for p in prices if not p['is_stale'] and p['vs_currency'] == 'RUB'}
    usd_rate = D(fx['rub_per_usd']) if 'rub_per_usd' in fx else None
    lines = ['# Итоговая выгрузка криптоучёта', '', f"Снимок dev: {data['generated_at']}. Исторические количества до 06.09.2026 18:13:53 МСК.",
             'Котировки получены при выгрузке; это не рыночная оценка на дату исторического среза.',
             'USD — справочный перевод рублёвой себестоимости по указанному курсу, а не исторические долларовые затраты.', '',
             f"Курс USD: {json.dumps(fx, ensure_ascii=False)}", '', '| Раздел | Себестоимость RUB |', '|---|---:|']
    for key, label in [('included','Включено в статистику'),('excluded','Исключено из статистики: подарки'),('archived','Архив'),('all','Всего сохранённой стоимости')]:
        lines.append(f'| {label} | {num(totals[key])} |')
    lines += ['', '## Монеты по счетам', '', 'Заёмные единицы приводятся отдельно; средняя цена при них не окончательная. ID актива различает одинаковые тикеры. Рынок исключённых счетов не включён; историческое финансирование подарков не является их рыночной стоимостью.', '', '| Счёт / актив ID | Монета | Количество | Затраты RUB | На монету RUB | На монету USD | Рынок RUB | Финансирование (ID займа: единицы) |', '|---|---|---:|---:|---:|---:|---:|---|']
    for w in wallets:
        if not w['quantity'] and not w['remaining_cost_basis'] and not w['funding_units']:
            continue
        quantity = D(str(w['quantity']))
        basis = None if w['remaining_cost_basis'] is None else D(str(w['remaining_cost_basis']))
        avg = basis / quantity if basis is not None and quantity else None
        market = quantity * prices_by_id[w['crypto_asset_id']] if w['included'] and w['crypto_asset_id'] in prices_by_id else None
        suffix = ' [архив]' if w['archived'] else ' [вне статистики]' if not w['included'] else ''
        lines.append(f"| {w['investment_account_name']}{suffix} / {w['crypto_asset_id']} | {w['symbol']} | {quantity} | {num(basis)} | {num(avg,6)} | {num(avg/usd_rate if avg is not None and usd_rate else None,6)} | {num(market)} | {json.dumps(w['funding_units'],ensure_ascii=False)} |")
    lines += ['', '## Открытые DeFi', '', 'Стоимость дана на всю позицию: разделение цены единицы двух монет LP не подменяется условной средней. Долг — обязательство протокола; это не те же единицы, что открытое финансирование активов.', '', '| Счёт | Инструмент / ID | Количество | Вторая монета / долг | Затраты RUB | Финансирование |', '|---|---|---|---|---:|---|']
    for p in open_protocols:
        m=p['metadata']
        if not p['current_quantity'] and not p['cost_basis_in_base'] and not m.get('borrowed_quantity') and not m.get('funding_units0') and not m.get('funding_units1'):
            continue
        second = f"{m.get('token1_quantity','')} {m.get('token1_symbol','')}" if p['position_type']=='liquidity_pool' else f"долг {m.get('borrowed_quantity',0)} {m.get('borrowed_asset_symbol','')}" if p['position_type']=='lending' else '—'
        lines.append(f"| {p['investment_account_name']} | {p['protocol_name']} / {p['id']} | {p.get('current_quantity_exact') or p['current_quantity']} {p['asset_symbol']} | {second} | {num(p['cost_basis_in_base'])} | {json.dumps([m.get('funding_units0',{}),m.get('funding_units1',{})])} |")
    lines += ['', '## Источники котировок', '', '| ID актива | Монета | RUB | Источник | Время UTC | Устарела |', '|---|---|---:|---|---|---|']
    for p in prices:
        lines.append(f"| {p['crypto_asset_id']} | {p['symbol']} | {p['price']} | {p['source']} | {p['fetched_at']} | {p['is_stale']} |")
    lines += ['', 'Полные остатки банка, справочники, идентичность активов, протоколы и контрольные суммы находятся в snapshot.json рядом с отчётом. Операции банка после 06.09 включены только в банковский снимок; в историческую себестоимость криптопортфеля не добавлены.', '', 'Результат продаж и общий P&L здесь не вычисляются вычитанием себестоимости из частичной оценки. Допущения и сверка вложений: docs/2026-09-28-crypto-final-acceptance.md.']
    (out / 'report.md').write_text('\n'.join(lines)+'\n')
    await asyncio.to_thread(subprocess.run, ['node', '--experimental-strip-types', str(ROOT / 'scripts/crypto/export_final_valuation.mjs'), str(out / 'snapshot.json')], check=True)
    print(json.dumps(dict(totals=totals, wallets=len(wallets), protocols=len(open_protocols), quotes=len(prices), fx=fx, output=str(out)),default=str,ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', choices=['budget_bot','crypto_merge_preview'], default='budget_bot')
    asyncio.run(run(parser.parse_args().database))
