import { useEffect, useState } from 'react';
import BottomSheet from './BottomSheet';
import { deleteCryptoSource, fetchCryptoCorrectionHistory, type CryptoEditableSource } from '../api';
import { useCryptoRequestKey } from '../hooks/useCryptoRequestKey';
import { currencySymbol, formatNumericAmount } from '../utils/format';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';

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

type Props = { assetType?:'crypto'|'collectible'; open:boolean; anchorAccountId:number; accounts:{id:number;name:string}[]; onClose:()=>void; onSuccess:()=>void };

const qty=(value:unknown)=>formatNumericAmount(Number(value??0),12);
const dateLabel=(iso:string)=>new Date(`${iso}T00:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'});
const commandTitle=(commands:{kind:string}[])=>commands.map(c=>kinds[c.kind]??'Операция').join(' + ');
const values=(row:CryptoEditableSource)=>row.commands.flatMap(c=>Object.entries(c.payload)
  .filter(([k,v])=>c.editable_fields?.includes(k) && k in fields && v!=null)
  .map(([k,v])=>{
    // Fiat amounts carry their currency: a sale for 26 ₽ instead of 26 coins must be visible.
    const code=k==='close_amount_in_currency'?c.payload.close_currency_code:k==='amount_in_currency'?c.payload.currency_code:null;
    return `${row.commands.length>1&&(k==='quantity'||k==='amount')?kinds[c.kind]??fields[k]:fields[k]} ${qty(v)}${typeof code==='string'?` ${currencySymbol(code)}`:''}`;
  })).join(' · ');
// Server names blocking operations by their command kinds; show them in Russian.
const readableError=(message:string)=>message.replace(/\b[a-z]+(?:_[a-z]+)+\b/g,kind=>kinds[kind]??kind);

export default function CryptoCorrectionSheet({assetType='crypto',open,anchorAccountId,accounts,onClose,onSuccess}:Props) {
  const [anchorId,setAnchorId]=useState(anchorAccountId);
  const [rows,setRows]=useState<CryptoEditableSource[]>([]);
  const [selected,setSelected]=useState<CryptoEditableSource|null>(null);
  const [confirming,setConfirming]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [offset,setOffset]=useState(0);
  const request=useCryptoRequestKey(`crypto-delete:${selected?.id??0}`);
  useEffect(()=> { if(open) { setAnchorId(anchorAccountId); setRows([]); setOffset(0); setSelected(null); setConfirming(false); setError(''); } },[open,anchorAccountId]);
  useEffect(()=> {
    if(!open) return;
    let active=true;
    setBusy(true);
    fetchCryptoCorrectionHistory(anchorId,offset).then(items=>{if(active)setRows(items);})
      .catch((e:unknown)=>{if(active)setError(e instanceof Error?e.message:String(e));})
      .finally(()=>{if(active)setBusy(false);});
    return ()=>{active=false;};
  },[open,anchorId,offset]);
  async function remove() {
    if(!selected || busy) return;
    setBusy(true); setError('');
    try {
      await deleteCryptoSource(selected.id,request.requestId({id:selected.id}));
      request.completed();
      setSelected(null); setConfirming(false);
      onSuccess();
      setRows(await fetchCryptoCorrectionHistory(anchorId,offset));
    } catch(e:unknown) { setError(readableError(e instanceof Error?e.message:String(e))); setConfirming(false); }
    finally {setBusy(false);}
  }
  const back=()=>{setSelected(null);setConfirming(false);setError('');};

  const footer=selected ? <div className="tk-foot pf-sheet-actions">
    {error&&<div className="tk-error" role="alert"><span>{error}</span></div>}
    {confirming ? <>
      <p className="cx-meta" role="status">Удалить операцию? Остатки и себестоимость вернутся к состоянию до неё.</p>
      <div className="tk-foot__row">
        <button className="sh-btn sh-btn--ghost" type="button" disabled={busy} onClick={()=>setConfirming(false)}>Отмена</button>
        <button className="sh-btn sh-btn--danger" type="button" disabled={busy} onClick={()=>void remove()}>{busy?'Удаляем…':'Удалить'}</button>
      </div>
    </> : <button className="sh-btn sh-btn--danger" type="button" disabled={busy} onClick={()=>{setError('');setConfirming(true);}}>
      <Trash2 size={16}/> Удалить операцию
    </button>}
  </div> : <div className="tk-foot pf-sheet-actions">
    {error&&<div className="tk-error" role="alert"><span>{error}</span></div>}
    {(offset>0||rows.length>=30)&&<div className="tk-foot__row">
      <button type="button" className="sh-btn sh-btn--ghost cx-page" disabled={busy||offset===0} onClick={()=>setOffset(Math.max(0,offset-30))}><ChevronLeft size={16}/> Новее</button>
      <button type="button" className="sh-btn sh-btn--ghost cx-page" disabled={busy||rows.length<30} onClick={()=>setOffset(offset+30)}>Старее <ChevronRight size={16}/></button>
    </div>}
  </div>;

  return <BottomSheet open={open} tag={assetType === 'collectible' ? 'Коллекции' : 'Криптовалюта'} title={selected?commandTitle(selected.commands):'История операций'} onClose={()=>{if(!busy)onClose();}}
    actions={footer}>
    {!selected ? <>
      <div className="field">
        <span className="fl">Счёт</span>
        <select className="picker-v2" value={anchorId} disabled={busy} onChange={e=>{setAnchorId(Number(e.target.value));setOffset(0);setError('');}}>
          {accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <p className="cx-meta">Сначала идут последние внесённые. Удалить можно операцию, которую не затронули более поздние.</p>
      {busy&&rows.length===0&&<p className="ca-sheet__hist-empty" role="status">Загружаем операции…</p>}
      {!busy&&rows.length===0&&!error&&<p className="ca-sheet__hist-empty">На этой странице операций нет.</p>}
      {rows.length>0&&<div className="cx-list">
        {rows.map(row=><button key={row.id} className="cx-row" type="button" disabled={busy}
          onClick={()=>{setSelected(row);setConfirming(false);setError('');}}>
          <span className="cx-row__top">
            <span className="cx-row__title">{commandTitle(row.commands)}</span>
            <span className="cx-row__date">{dateLabel(row.accounting_date)}</span>
          </span>
          <span className="cx-row__sub">{[row.context,values(row),row.posted_on>row.accounting_date?`внесена ${dateLabel(row.posted_on)}`:null].filter(Boolean).join(' · ')}</span>
        </button>)}
      </div>}
    </> : <>
      <button type="button" className="credits-textbtn cx-back" disabled={busy} onClick={back}>
        <ChevronLeft strokeWidth={2}/> Все операции
      </button>
      <div className="cx-meta">{[dateLabel(selected.accounting_date),selected.posted_on>selected.accounting_date?`внесена ${dateLabel(selected.posted_on)}`:null,selected.context].filter(Boolean).join(' · ')}</div>
      {values(selected)&&<p className="cx-row__sub">{values(selected)}</p>}
    </>}
  </BottomSheet>;
}
