import { useEffect, useRef, useState } from 'react';
import { fetchPendingFiatExpenses, settlePendingFiatExpense } from '../api';
import type { PendingFiatExpense } from '../api';
import { formatAmount } from '../utils/format';
import { todayIso } from '../utils/portfolioPosition';

function Allocation({ item, onSuccess }: { item: PendingFiatExpense; onSuccess: () => void }) {
  const [category, setCategory] = useState('');
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function submit() {
    if (inFlight.current || !category || !date || date < item.sale_date) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await settlePendingFiatExpense(item.sale_event_id, {
        investment_account_id: item.investment_account_id,
        category_id: Number(category),
        operated_at: date,
      });
      onSuccess();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <article className="portfolio-analytics-row">
      <div className="portfolio-analytics-row__top">
        <div>
          <div className="portfolio-analytics-row__title">{item.bank_account_name}</div>
          <div className="portfolio-analytics-row__meta">Оплата от {item.sale_date}</div>
        </div>
        <strong>{formatAmount(Number(item.amount), item.currency_code)}</strong>
      </div>
      {item.comment && <p>{item.comment}</p>}
      <div className="apf-field">
        <label className="apf-label" htmlFor={`allocation-category-${item.sale_event_id}`}>Категория расхода</label>
        <select id={`allocation-category-${item.sale_event_id}`} className="apf-input" value={category}
          disabled={busy} onChange={(event) => setCategory(event.target.value)}>
          <option value="">Выберите категорию</option>
          {item.categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
      </div>
      {item.categories.length === 0 && <p>Сначала создайте категорию расхода для владельца этого счёта.</p>}
      <div className="apf-field">
        <label className="apf-label" htmlFor={`allocation-date-${item.sale_event_id}`}>Дата расхода</label>
        <input id={`allocation-date-${item.sale_event_id}`} className="apf-input" type="date"
          min={item.sale_date} value={date} disabled={busy} onChange={(event) => setDate(event.target.value)} />
      </div>
      {error && <p role="alert" className="pf-new-account-form__error">{error}</p>}
      <button className="btn btn--primary" type="button"
        disabled={busy || !category || !date || date < item.sale_date} onClick={() => void submit()}>
        {busy ? 'Сохраняем…' : 'Записать расход'}
      </button>
    </article>
  );
}

export default function PendingFiatExpenses({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<PendingFiatExpense[]>([]);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 20;

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly reloads after settlement or a failed request.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchPendingFiatExpenses(pageSize, offset).then((rows) => {
      if (!active) return;
      setItems(rows);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [offset, revision]);

  function allocated() {
    setOffset(0);
    setRevision((value) => value + 1);
    onChanged();
  }

  if (!loading && !error && items.length === 0 && offset === 0) return null;
  return (
    <section className="portfolio-analytics-section" aria-label="Оплаты для распределения">
      <h3 className="section__title">Ожидают распределения</h3>
      <p>Оплаты по всем доступным счетам. Эти суммы уже потрачены картой, но пока остаются
        в учётном остатке. Выберите категорию здесь — отдельно повторять расход не нужно.</p>
      {loading ? <p role="status">Загружаем оплаты…</p> : error ? (
        <div role="alert"><p>{error}</p><button type="button" className="btn btn--ghost"
          onClick={() => setRevision((value) => value + 1)}>Повторить загрузку</button></div>
      ) : (
        <div className="portfolio-analytics-stack">
          {items.map((item) => <Allocation key={item.sale_event_id} item={item} onSuccess={allocated} />)}
          {items.length === 0 && <p>На этой странице оплат больше нет.</p>}
        </div>
      )}
      {(offset > 0 || items.length === pageSize) && <div className="apf-actions">
        <button type="button" className="btn btn--ghost" disabled={loading || offset === 0}
          onClick={() => setOffset((value) => Math.max(0, value - pageSize))}>Назад</button>
        <button type="button" className="btn btn--ghost" disabled={loading || !!error || items.length < pageSize}
          onClick={() => setOffset((value) => value + pageSize)}>Далее</button>
      </div>}
    </section>
  );
}
