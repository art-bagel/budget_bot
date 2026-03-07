import { useEffect, useState } from 'react';

import {
  exchangeCurrency,
  fetchCurrencies,
  fetchDashboardOverview,
} from '../api';
import type {
  Currency,
  DashboardOverview,
  ExchangeCurrencyRequest,
  UserContext,
} from '../types';


function formatAmount(amount: number, currencyCode: string): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(amount) + ' ' + currencyCode;
}


export default function Exchange({ user }: { user: UserContext }) {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fromCurrencyCode, setFromCurrencyCode] = useState(user.base_currency_code);
  const [toCurrencyCode, setToCurrencyCode] = useState('');
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    effectiveRate: number;
    realizedFxResultInBase: number;
  } | null>(null);

  const loadExchangeContext = async () => {
    setLoading(true);
    setError(null);

    try {
      const [loadedCurrencies, loadedOverview] = await Promise.all([
        fetchCurrencies(),
        fetchDashboardOverview(user.bank_account_id),
      ]);

      setCurrencies(loadedCurrencies);
      setOverview(loadedOverview);

      if (!toCurrencyCode) {
        const firstAlternative = loadedCurrencies.find((item) => item.code !== fromCurrencyCode);
        if (firstAlternative) {
          setToCurrencyCode(firstAlternative.code);
        }
      }
    } catch (reason: any) {
      setError(reason.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadExchangeContext();
  }, [user.bank_account_id]);

  useEffect(() => {
    if (!currencies.some((item) => item.code === toCurrencyCode && item.code !== fromCurrencyCode)) {
      const firstAlternative = currencies.find((item) => item.code !== fromCurrencyCode);
      setToCurrencyCode(firstAlternative ? firstAlternative.code : '');
    }
  }, [currencies, fromCurrencyCode, toCurrencyCode]);

  const canSubmit =
    !submitting &&
    !!fromCurrencyCode &&
    !!toCurrencyCode &&
    fromCurrencyCode !== toCurrencyCode &&
    parseFloat(fromAmount) > 0 &&
    parseFloat(toAmount) > 0;

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const result = await exchangeCurrency({
        bank_account_id: user.bank_account_id,
        from_currency_code: fromCurrencyCode,
        from_amount: parseFloat(fromAmount),
        to_currency_code: toCurrencyCode,
        to_amount: parseFloat(toAmount),
        comment: comment.trim() || undefined,
      } as ExchangeCurrencyRequest);

      setLastResult({
        effectiveRate: result.effective_rate,
        realizedFxResultInBase: result.realized_fx_result_in_base,
      });
      setFromAmount('');
      setToAmount('');
      setComment('');
      await loadExchangeContext();
    } catch (reason: any) {
      setSubmitError(reason.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="status-screen">
        <h1>Загрузка...</h1>
      </div>
    );
  }

  return (
    <>
      <h1 className="page-title">Обмен валют</h1>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">Текущий банк</h2>
        </div>
        <div className="panel">
          {error && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginBottom: 12 }}>
              {error}
            </p>
          )}

          {!overview || overview.bank_balances.length === 0 ? (
            <p className="list-row__sub">На счете пока нет денег</p>
          ) : (
            <div className="balance-scroll">
              {overview.bank_balances.map((balance) => (
                <article className="balance-card" key={balance.currency_code}>
                  <div className="balance-card__head">
                    <span className="pill">{balance.currency_code}</span>
                    <span className="tag tag--neutral">
                      {formatAmount(balance.historical_cost_in_base, balance.base_currency_code)}
                    </span>
                  </div>
                  <span className="balance-card__amount">
                    {formatAmount(balance.amount, balance.currency_code)}
                  </span>
                  <span className="balance-card__sub">Историческая стоимость в базе</span>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">Записать обмен</h2>
        </div>
        <div className="panel">
          <div className="operations-note">
            Курс не вводится отдельно. Система считает его автоматически как сколько отдали / сколько получили.
          </div>

          <div className="form-row">
            <select className="input" value={fromCurrencyCode} onChange={(event) => setFromCurrencyCode(event.target.value)}>
              {currencies.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  Отдать: {currency.code}
                </option>
              ))}
            </select>
            <input
              className="input"
              type="text"
              inputMode="decimal"
              placeholder="Сколько отдали"
              value={fromAmount}
              onChange={(event) => setFromAmount(event.target.value)}
            />
          </div>

          <div className="form-row">
            <select className="input" value={toCurrencyCode} onChange={(event) => setToCurrencyCode(event.target.value)}>
              {currencies
                .filter((currency) => currency.code !== fromCurrencyCode)
                .map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    Получить: {currency.code}
                  </option>
                ))}
            </select>
            <input
              className="input"
              type="text"
              inputMode="decimal"
              placeholder="Сколько получили"
              value={toAmount}
              onChange={(event) => setToAmount(event.target.value)}
            />
          </div>

          <div className="form-row">
            <input
              className="input"
              type="text"
              placeholder="Комментарий (необязательно)"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && canSubmit && handleSubmit()}
              style={{ flex: 1 }}
            />
            <button className="btn btn--primary" type="button" disabled={!canSubmit} onClick={handleSubmit}>
              {submitting ? '...' : 'Обменять'}
            </button>
          </div>

          {submitError && (
            <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 8 }}>
              {submitError}
            </p>
          )}

          {lastResult && (
            <div className="operations-hint">
              Курс: {lastResult.effectiveRate.toFixed(6)}. FX результат: {formatAmount(lastResult.realizedFxResultInBase, user.base_currency_code)}.
            </div>
          )}
        </div>
      </section>
    </>
  );
}
