import { useEffect, useState } from 'react';
import BottomSheet from './BottomSheet';
import { correctCryptoSource, fetchCryptoCorrectionHistory, type CryptoCorrectionResult, type CryptoEditableSource } from '../api';
import { useCryptoRequestKey } from '../hooks/useCryptoRequestKey';
import { sanitizeDecimalInput } from '../utils/validation';
import { currencySymbol, formatNumericAmount } from '../utils/format';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const fields: Record<string, string> = {
  crypto_quantity: 'Количество монет', amount_in_currency: 'Сумма покупки', close_amount_in_currency: 'Сумма продажи',
  share_percent: 'Доля позиции, %',
  from_amount: 'Отдано монет', to_amount: 'Получено монет', quantity: 'Количество', amount: 'Количество',
  debt_qty: 'Тело займа', repay_qty: 'Погашение', interest_qty: 'Проценты', collateral_qty: 'Изъято залога',
  collateral_fee_qty: 'Штраф в монетах залога', principal_qty: 'Возврат основной монеты',
  secondary_principal_qty: 'Возврат второй монеты', rewards_qty: 'Награда основной монеты',
  secondary_rewards_qty: 'Награда второй монеты', return_quantity: 'Получено основной монеты',
  secondary_return_quantity: 'Получено второй монеты', secondary_quantity: 'Вторая монета', fiat_amount: 'Сумма оплаты',
};
const kinds: Record<string,string> = { swap:'Обмен',transfer:'Перевод',create_protocol:'Размещение в DeFi',
  top_up_protocol:'Пополнение DeFi',close_protocol:'Закрытие DeFi',partial_close_protocol:'Вывод из DeFi',
  borrow:'Заём',repay:'Погашение',accrue_interest:'Проценты по долгу',liquidate:'Ликвидация',
  lp_snapshot:'Состав пула',lp_withdraw:'Вывод ликвидности',lp_reward:'Награда пула',reward:'Награда',expense:'Расход',receive_unknown:'Поступление',fee_refund:'Возврат комиссии',quantity_correction:'Уточнение количества',staking_convert:'Обмен стейкингового токена',accrue:'Начисление',tag_lending_account:'Счёт протокола',buy_fiat:'Покупка',sell_fiat:'Продажа',bank_sell:'Продажа через банк',settle_fiat_sale:'Категория расхода',position_income:'Награда',protocol_yield:'Начисление в DeFi',linked_fee_refund:'Возврат комиссии',fee:'Комиссия',group_lending:'Общий счёт протокола',
  bank_purchase:'Покупка через банк',bank_settle_sale:'Категория карточной оплаты',budget_allocate:'Распределение бюджета',bank_expense:'Расход',bank_crypto_expense:'Расход в криптовалюте',observation:'Примечание',lp_custody:'Передача LP',collectible_buy:'Покупка предмета',collectible_sell:'Продажа предмета',collectible_fiat_buy:'Покупка предмета',collectible_fiat_close:'Продажа предмета',collectible_fiat_topup:'Доплата',collectible_fiat_fee:'Комиссия',collectible_coin_topup:'Доплата',collectible_coin_fee:'Комиссия',collectible_transfer:'Перевод коллекций',collectible_receive:'Получение предмета',collectible_details:'Параметры предмета',bank_buy:'Покупка через банк',bank_to_portfolio:'Ввод в портфель',bank_withdraw:'Вывод в банк',bank_cash_sell:'Продажа в банке' };

type Props = { assetType?:'crypto'|'collectible'; open:boolean; anchorAccountId:number; accounts:{id:number;name:string}[]; baseCurrencyCode:string; onClose:()=>void; onSuccess:()=>void };

const qty=(value:unknown)=>formatNumericAmount(Number(value??0),12);
const dateLabel=(iso:string)=>new Date(`${iso}T00:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'});
const commandTitle=(commands:{kind:string}[])=>commands.map(c=>kinds[c.kind]??'Операция').join(' + ');
const editedValues=(row:CryptoEditableSource)=>row.commands.flatMap(c=>Object.entries(c.payload)
  .filter(([k,v])=>c.editable_fields?.includes(k) && k in fields && v!=null)
  .map(([k,v])=>`${row.commands.length>1&&(k==='quantity'||k==='amount')?kinds[c.kind]??fields[k]:fields[k]} ${qty(v)}`)).join(' · ');

export default function CryptoCorrectionSheet({assetType='crypto',open,anchorAccountId,accounts,baseCurrencyCode,onClose,onSuccess}:Props) {
  const [anchorId,setAnchorId]=useState(anchorAccountId);
  const [rows,setRows]=useState<CryptoEditableSource[]>([]);
  const [selected,setSelected]=useState<CryptoEditableSource|null>(null);
  const [values,setValues]=useState<Record<string,string>>({});
  const [reason,setReason]=useState('');
  const [preview,setPreview]=useState<CryptoCorrectionResult|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [offset,setOffset]=useState(0);
  const request=useCryptoRequestKey(`crypto-correction:${selected?.id??0}`);
  useEffect(()=> { if(open) { setAnchorId(anchorAccountId); setRows([]); setOffset(0); setSelected(null); setPreview(null); setError(''); } },[open,anchorAccountId]);
  useEffect(()=> {
    if(!open) return;
    let active=true;
    setBusy(true);
    fetchCryptoCorrectionHistory(anchorId,offset).then(items=>{if(active)setRows(items);})
      .catch((e:unknown)=>{if(active)setError(e instanceof Error?e.message:String(e));})
      .finally(()=>{if(active)setBusy(false);});
    return ()=>{active=false;};
  },[open,anchorId,offset]);
  const editable=selected?.commands.flatMap((c,i)=>Object.entries(c.payload)
    .filter(([key,value])=>c.editable_fields?.includes(key) && key in fields && value!=null)
    .map(([key,value])=>({index:i,key,value:String(value),label:`${kinds[c.kind]??c.kind}: ${fields[key]}`})))??[];
  const changes=editable.filter(f=>values[`${f.index}:${f.key}`]!==undefined && values[`${f.index}:${f.key}`]!==f.value)
    .map(f=>({command_index:f.index,field:f.key,value:values[`${f.index}:${f.key}`]}));
  async function submit(apply:boolean) {
    if(!selected || busy) return;
    setBusy(true); setError('');
    try {
      const payload={expected_revision:selected.revision,changes,reason};
      const result=await correctCryptoSource(selected.id,{...payload,request_id:request.requestId(payload),apply,
        preview_token:apply?preview?.preview_token:undefined});
      setPreview(result);
      if(result.applied) { request.completed(); onSuccess(); }
    } catch(e:unknown) { setError(e instanceof Error?e.message:String(e)); setPreview(null); }
    finally {setBusy(false);}
  }
  const changedPositions=preview?.after.positions.filter(p=>JSON.stringify(p)!==JSON.stringify(preview.before.positions.find(b=>b.id===p.id)))??[];
  const changedProtocols=preview?.after.protocols.filter(p=>JSON.stringify(p)!==JSON.stringify(preview.before.protocols.find(b=>b.id===p.id)))??[];
  const sym=currencySymbol(baseCurrencyCode);
  const money=(value:unknown)=>value==null?'не определена':`${formatNumericAmount(Number(value))} ${sym}`;
  const changedBank=preview?.after.bank.filter(b=>JSON.stringify(b)!==JSON.stringify(preview.before.bank.find(a=>a.bank_account_id===b.bank_account_id&&a.currency_code===b.currency_code)))??[];
  const changedBudget=preview?.after.budget.filter(b=>b.amount!==preview.before.budget.find(a=>a.category_id===b.category_id&&a.currency_code===b.currency_code)?.amount)??[];
  const changedCryptoBank=preview?.after.crypto_bank.filter(b=>JSON.stringify(b)!==JSON.stringify(preview.before.crypto_bank.find(a=>a.bank_account_id===b.bank_account_id&&a.crypto_asset_id===b.crypto_asset_id)))??[];
  const nothingChanged=preview&&!changedPositions.length&&!changedProtocols.length&&!changedBank.length&&!changedBudget.length&&!changedCryptoBank.length;

  const footer=selected ? (!preview?.applied || error) && <div className="tk-foot pf-sheet-actions">
    {error&&<div className="tk-error" role="alert"><span>{error}</span></div>}
    {!preview?.applied&&<button className="sh-btn sh-btn--primary" type="button" disabled={busy||changes.length===0||!reason.trim()} onClick={()=>void submit(!!preview)}>
      {busy?(preview?'Пересчитываем историю, это займёт пару минут…':'Считаем…'):preview?'Применить исправление':'Посмотреть результат'}
    </button>}
  </div> : <div className="tk-foot pf-sheet-actions">
    {error&&<div className="tk-error" role="alert"><span>{error}</span></div>}
    {(offset>0||rows.length>=30)&&<div className="tk-foot__row">
      <button type="button" className="sh-btn sh-btn--ghost cx-page" disabled={busy||offset===0} onClick={()=>setOffset(Math.max(0,offset-30))}><ChevronLeft size={16}/> Новее</button>
      <button type="button" className="sh-btn sh-btn--ghost cx-page" disabled={busy||rows.length<30} onClick={()=>setOffset(offset+30)}>Старее <ChevronRight size={16}/></button>
    </div>}
  </div>;

  return <BottomSheet open={open} tag={assetType === 'collectible' ? 'Коллекции' : 'Криптовалюта'} title={selected?commandTitle(selected.commands):'Исправить операцию'} onClose={()=>{if(!busy)onClose();}}
    actions={footer||undefined}>
    {!selected ? <>
      <div className="field">
        <span className="fl">Счёт</span>
        <select className="picker-v2" value={anchorId} disabled={busy} onChange={e=>{setAnchorId(Number(e.target.value));setOffset(0);setError('');}}>
          {accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      {busy&&rows.length===0&&<p className="ca-sheet__hist-empty" role="status">Загружаем операции…</p>}
      {!busy&&rows.length===0&&!error&&<p className="ca-sheet__hist-empty">На этой странице нет операций, которые можно исправить.</p>}
      {rows.length>0&&<div className="cx-list">
        {rows.map(row=><button key={row.id} className="cx-row" type="button" disabled={!row.reversible||busy}
          onClick={()=>{setSelected(row);setValues({});setReason('');setPreview(null);setError('');}}>
          <span className="cx-row__top">
            <span className="cx-row__title">{commandTitle(row.commands)}</span>
            <span className="cx-row__date">{dateLabel(row.accounting_date)}</span>
          </span>
          <span className="cx-row__sub">{[row.context,editedValues(row)].filter(Boolean).join(' · ')}</span>
          {(row.revision>1||!row.reversible)&&<span className="cx-row__flags">
            {row.revision>1&&<span className="pf-grp__flag">исправлена</span>}
            {!row.reversible&&<span className="pf-grp__flag">недоступно</span>}
          </span>}
        </button>)}
      </div>}
    </> : <>
      <button type="button" className="credits-textbtn cx-back" disabled={busy} onClick={()=>{setSelected(null);setPreview(null);setError('');}}>
        <ChevronLeft strokeWidth={2}/> Все операции
      </button>
      <div className="cx-meta">{[dateLabel(selected.accounting_date),selected.context].filter(Boolean).join(' · ')}</div>
      {editable.map(f=><div className="field" key={`${f.index}:${f.key}`}>
        <span className="fl">{f.label}</span>
        <input className="inp-v2" inputMode="decimal" disabled={busy||preview?.applied}
          value={values[`${f.index}:${f.key}`]??f.value} onChange={e=>{setValues(v=>({...v,[`${f.index}:${f.key}`]:sanitizeDecimalInput(e.target.value)}));setPreview(null);}} />
      </div>)}
      <div className="field">
        <span className="fl">Причина исправления</span>
        <input className="inp-v2" value={reason} maxLength={1000} disabled={busy||preview?.applied} onChange={e=>{setReason(e.target.value);setPreview(null);}} />
      </div>
      {selected.previous_versions.length>0&&<details className="cx-versions">
        <summary>Прошлые версии · {selected.previous_versions.length}</summary>
        {selected.previous_versions.map(v=><div className="pf-dcond__row" key={v.revision}>
          <span className="pf-dcond__row-label">Версия {v.revision}</span>
          <span className="pf-dcond__row-value">{v.commands.map(c=>Object.entries(c.payload).filter(([k])=>k in fields).map(([k,val])=>`${fields[k]} ${qty(val)}`).join(' · ')).filter(Boolean).join('; ')}</span>
        </div>)}
      </details>}
      {preview&&<section className="pf-dcond" aria-label="Результат пересчёта">
        <div className="pf-dcond__head">
          <span className="sec-tag">{preview.applied?'Исправление применено':'Что изменится'}</span>
          <span className="cx-meta">пересчитано {preview.replayed_sources}</span>
        </div>
        {nothingChanged&&<div className="pf-dcond__row"><span className="pf-dcond__row-label">Остатки и себестоимость не меняются</span></div>}
        {changedPositions.map(p=>{const b=preview.before.positions.find(v=>v.id===p.id);return <div className="pf-dcond__row" key={`p${p.id}`}>
          <span className="pf-dcond__row-label">{p.name}</span>
          <span className="pf-dcond__row-value">{qty(b?.quantity)} → {qty(p.quantity)}
            <span className="pf-dcond__row-note">себестоимость {money(b?.cost)} → {money(p.cost)}{JSON.stringify(b?.funding)!==JSON.stringify(p.funding)?' · изменилось финансирование':''}</span>
          </span>
        </div>;})}
        {changedProtocols.map(p=>{const b=preview.before.protocols.find(v=>v.id===p.id);return <div className="pf-dcond__row" key={`d${p.id}`}>
          <span className="pf-dcond__row-label">{p.name}</span>
          <span className="pf-dcond__row-value">{qty(b?.quantity)} → {qty(p.quantity)}
            <span className="pf-dcond__row-note">себестоимость {money(b?.cost)} → {money(p.cost)} · долг {qty(b?.metadata.borrowed_quantity)} → {qty(p.metadata.borrowed_quantity)}</span>
          </span>
        </div>;})}
        {changedBank.map(b=>{const old=preview.before.bank.find(a=>a.bank_account_id===b.bank_account_id&&a.currency_code===b.currency_code);return <div className="pf-dcond__row" key={`b${b.bank_account_id}:${b.currency_code}`}>
          <span className="pf-dcond__row-label">Банковский счёт, {b.currency_code}</span>
          <span className="pf-dcond__row-value">{formatNumericAmount(old?.amount??0)} → {formatNumericAmount(b.amount)} {currencySymbol(b.currency_code)}
            <span className="pf-dcond__row-note">себестоимость {money(old?.historical_cost_in_base??0)} → {money(b.historical_cost_in_base)}</span>
          </span>
        </div>;})}
        {changedBudget.map(b=><div className="pf-dcond__row" key={`c${b.category_id}:${b.currency_code}`}>
          <span className="pf-dcond__row-label">Категория «{b.name}»</span>
          <span className="pf-dcond__row-value">{formatNumericAmount(Number(preview.before.budget.find(a=>a.category_id===b.category_id&&a.currency_code===b.currency_code)?.amount??0))} → {formatNumericAmount(Number(b.amount))} {currencySymbol(b.currency_code)}</span>
        </div>)}
        {changedCryptoBank.map(b=>{const old=preview.before.crypto_bank.find(a=>a.bank_account_id===b.bank_account_id&&a.crypto_asset_id===b.crypto_asset_id);return <div className="pf-dcond__row" key={`cb${b.bank_account_id}:${b.crypto_asset_id}`}>
          <span className="pf-dcond__row-label">{b.symbol} на банковском счёте</span>
          <span className="pf-dcond__row-value">{qty(old?.amount??0)} → {qty(b.amount)}
            <span className="pf-dcond__row-note">себестоимость {money(old?.cost_base_remaining??0)} → {money(b.cost_base_remaining)}</span>
          </span>
        </div>;})}
      </section>}
    </>}
  </BottomSheet>;
}
