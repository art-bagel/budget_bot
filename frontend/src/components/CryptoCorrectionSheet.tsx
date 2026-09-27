import { useEffect, useState } from 'react';
import BottomSheet from './BottomSheet';
import { correctCryptoSource, fetchCryptoCorrectionHistory, type CryptoCorrectionResult, type CryptoEditableSource } from '../api';
import { useCryptoRequestKey } from '../hooks/useCryptoRequestKey';
import { sanitizeDecimalInput } from '../utils/validation';

const fields: Record<string, string> = {
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
  position_income:'Награда',protocol_yield:'Начисление в DeFi',fee:'Комиссия',group_lending:'Общий счёт протокола',
  bank_buy:'Покупка через банк',bank_to_portfolio:'Ввод в портфель',bank_withdraw:'Вывод в банк',bank_cash_sell:'Продажа в банке' };

type Props = { open:boolean; anchorAccountId:number; accounts:{id:number;name:string}[]; onClose:()=>void; onSuccess:()=>void };
export default function CryptoCorrectionSheet({open,anchorAccountId,accounts,onClose,onSuccess}:Props) {
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
  useEffect(()=> { if(open) { setOffset(0); setSelected(null); setPreview(null); setError(''); } },[open]);
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
  return <BottomSheet open={open} title="Исправление криптоопераций" onClose={()=>{if(!busy)onClose();}}>
    <div className="tk-body">
      {error&&<p role="alert" className="tk-error">{error}</p>}
      {!selected ? <>
        <label className="tk-field"><span>Счёт</span><select className="tk-input" value={anchorId} disabled={busy} onChange={e=>{setAnchorId(Number(e.target.value));setOffset(0);setError('');}}>
          {accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
        </select></label>
        <p className="tk-hint">Ручные операции владельца выбранного счёта. Перед применением бот покажет результат пересчёта последующей цепочки.</p>
        {!busy&&rows.length===0&&<p>На этой странице нет ручных операций. Импортированная история хранится отдельно и пока недоступна для такого исправления.</p>}
        {rows.map(row=><button key={row.id} className="btn btn--ghost" type="button" disabled={!row.reversible||busy} onClick={()=>{setSelected(row);setValues({});setReason('');setPreview(null);}}>
          {row.accounting_date} · {row.context} · {row.commands.map(c=>kinds[c.kind]??c.kind).join(' + ')} · версия {row.revision}
          {!row.reversible?' · нет снимка для пересчёта':''}<br />
          {row.commands.flatMap(c=>Object.entries(c.payload).filter(([k])=>c.editable_fields?.includes(k)).map(([k,v])=>`${fields[k]}: ${String(v)}`)).join('; ')}
        </button>)}
        <div className="tk-foot__row"><button type="button" className="btn btn--ghost" disabled={busy||offset===0} onClick={()=>setOffset(Math.max(0,offset-30))}>Новее</button>
          <button type="button" className="btn btn--ghost" disabled={busy||rows.length<30} onClick={()=>setOffset(offset+30)}>Старее</button></div>
      </> : <>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={()=>{setSelected(null);setPreview(null);}}>К списку операций</button>
        <p>{selected.accounting_date} · {selected.context} · версия {selected.revision}</p>
        {editable.map(f=><label className="tk-field" key={`${f.index}:${f.key}`}>
          <span>{f.label}</span><input className="tk-input" inputMode="decimal" disabled={busy||preview?.applied}
            value={values[`${f.index}:${f.key}`]??f.value} onChange={e=>{setValues(v=>({...v,[`${f.index}:${f.key}`]:sanitizeDecimalInput(e.target.value)}));setPreview(null);}} />
        </label>)}
        <label className="tk-field"><span>Причина исправления</span><input className="tk-input" value={reason} maxLength={1000} disabled={busy||preview?.applied} onChange={e=>{setReason(e.target.value);setPreview(null);}} /></label>
        {selected.previous_versions.length>0&&<details><summary>Предыдущие версии ({selected.previous_versions.length})</summary>
          {selected.previous_versions.map(v=><div key={v.revision}><strong>Версия {v.revision}</strong>{v.commands.map((c)=><p key={JSON.stringify(c)}>{kinds[c.kind]??c.kind}: {Object.entries(c.payload).filter(([k])=>k in fields).map(([k,val])=>`${fields[k]} ${String(val)}`).join('; ')}</p>)}</div>)}
        </details>}
        {preview&&<section aria-label="Результат пересчёта">
          <p>{preview.applied?'Исправление применено':'Предварительный результат'} · пересчитано событий: {preview.replayed_sources}</p>
          {changedPositions.map(p=>{const b=preview.before.positions.find(v=>v.id===p.id);return <p key={p.id}>{p.name}: количество {b?.quantity??'0'} → {p.quantity}; себестоимость {b?.cost??'неизвестна'} → {p.cost??'неизвестна'} в базовой валюте{JSON.stringify(b?.funding)!==JSON.stringify(p.funding)?' · изменилось открытое финансирование':''}</p>;})}
          {changedProtocols.map(p=>{const b=preview.before.protocols.find(v=>v.id===p.id);return <p key={p.id}>{p.name}: количество {b?.quantity??'0'} → {p.quantity}; себестоимость {b?.cost??'неизвестна'} → {p.cost??'неизвестна'} в базовой валюте. Долг: {String(b?.metadata.borrowed_quantity??'0')} → {String(p.metadata.borrowed_quantity??'0')}.</p>;})}
          {JSON.stringify(preview.before.bank)!==JSON.stringify(preview.after.bank)&&<p>Изменится банковский остаток. Проверьте суммы перед применением: {preview.after.bank.map(b=>`${b.currency_code}: ${b.amount}`).join('; ')}</p>}
          {preview.after.budget.filter(b=>b.amount!==preview.before.budget.find(a=>a.category_id===b.category_id&&a.currency_code===b.currency_code)?.amount).map(b=><p key={`${b.category_id}:${b.currency_code}`}>Категория «{b.name}»: {preview.before.budget.find(a=>a.category_id===b.category_id&&a.currency_code===b.currency_code)?.amount??'0'} → {b.amount} {b.currency_code}</p>)}
          {JSON.stringify(preview.before.crypto_bank)!==JSON.stringify(preview.after.crypto_bank)&&<p>Изменится криптовалюта на банковском счёте: {preview.after.crypto_bank.map(b=>`${b.symbol}: ${b.amount}`).join('; ')}</p>}
        </section>}
        {!preview?.applied&&<button className="btn btn--primary" type="button" disabled={busy||changes.length===0||!reason.trim()} onClick={()=>void submit(!!preview)}>
          {busy?'Пересчитываем…':preview?'Применить исправление':'Посмотреть результат'}
        </button>}
      </>}
    </div>
  </BottomSheet>;
}
