// Use the same valuation rules as Dashboard and Portfolio for the frozen export.
import fs from 'node:fs';
import path from 'node:path';
import { protocolMarketValue, walletMarketValue, isEmptyProtocolPosition, knownProtocolValues } from '../../frontend/src/utils/cryptoProtocolValuation.ts';
const snapshotPath = process.argv[2];
const data = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const prices = new Map(data.prices.map(p => [p.crypto_asset_id, p]));
const accounts = data.accounts.filter(a => !a.is_archived && a.include_in_statistics).map(a => {
  const wallets = data.wallets.filter(w => w.investment_account_id === a.id);
  const protocols = data.protocols.filter(p => p.investment_account_id === a.id && p.status === 'open' && !isEmptyProtocolPosition(p));
  const values = [...wallets.map(w => ({ value: walletMarketValue(Number(w.quantity), w.crypto_asset_id, prices, 'RUB') })), ...protocols.map(p => protocolMarketValue(p, prices, 'RUB'))];
  return { id: a.id, name: a.name, ...knownProtocolValues(values), cost: wallets.reduce((s,w) => s+Number(w.remaining_cost_basis ?? 0),0)+protocols.reduce((s,p) => s+Number(p.cost_basis_in_base ?? 0),0) };
});
const result = { accounts, knownMarketRUB: accounts.reduce((s,a)=>s+a.value,0), incomplete: accounts.some(a=>a.incomplete), protocols: data.protocols.filter(p=>p.included && p.status==='open' && !isEmptyProtocolPosition(p)).map(p=>({id:p.id,name:p.protocol_name,...protocolMarketValue(p,prices,'RUB')})) };
fs.writeFileSync(path.join(path.dirname(snapshotPath),'valuation.json'),JSON.stringify(result,null,2));
let lines = ['','## Сверка оценки счетов (общая функция интерфейса)','','| Счёт | Учтённые затраты RUB | Известная оценка RUB | Оценка неполная |','|---|---:|---:|---|'];
for(const a of accounts) lines.push(`| ${a.name} | ${a.cost.toFixed(2)} | ${a.value.toFixed(2)} | ${a.incomplete?'да':'нет'} |`);
lines.push('',`Известная часть рыночной оценки: **${result.knownMarketRUB.toFixed(2)} RUB**. Полная оценка ${result.incomplete?'не определена':'определена'}.`,'','| DeFi ID | Инструмент | Рынок RUB | Причина отсутствия |','|---|---|---:|---|');
for(const p of result.protocols) lines.push(`| ${p.id} | ${p.name} | ${p.value===null?'—':p.value.toFixed(2)} | ${p.reason??'—'} |`);
fs.appendFileSync(path.join(path.dirname(snapshotPath),'report.md'),lines.join('\n')+'\n');
console.log(JSON.stringify({knownMarketRUB:result.knownMarketRUB,incomplete:result.incomplete,accounts:accounts.length}));
