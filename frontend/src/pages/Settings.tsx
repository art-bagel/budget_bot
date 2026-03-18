import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';

import { useTheme } from '../hooks/useTheme';
import type { Theme } from '../hooks/useTheme';
import { useHints } from '../hooks/useHints';
import { IconSun, IconMoon, IconMonitor } from '../components/Icons';
import {
  createBankAccount,
  deleteAccount,
  dissolveFamily,
  fetchBankAccounts,
  fetchMyFamily,
  leaveFamily,
} from '../api';
import Family from './Family';
import type { BankAccount, FamilyInfo, UserContext } from '../types';

type SettingsTab = 'appearance' | 'account' | 'family' | 'investments' | 'data';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'appearance', label: 'Оформление' },
  { id: 'account',    label: 'Аккаунт' },
  { id: 'family',     label: 'Семья' },
  { id: 'investments',label: 'Инвестиции' },
  { id: 'data',       label: 'Данные' },
];

const THEME_OPTIONS: { value: Theme; label: string; icon: ComponentType }[] = [
  { value: 'system', label: 'Системная', icon: IconMonitor },
  { value: 'light', label: 'Светлая', icon: IconSun },
  { value: 'dark', label: 'Тёмная', icon: IconMoon },
];
export default function Settings({
  user,
  onFamilyBadgeUpdate,
}: {
  user: UserContext;
  onFamilyBadgeUpdate: (count: number) => void;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const { theme, setTheme } = useTheme();
  const { hintsEnabled, toggle: toggleHints } = useHints();
  const [family, setFamily] = useState<FamilyInfo | null>(null);
  const [familyRefreshKey, setFamilyRefreshKey] = useState(0);
  const [deleteInProgress, setDeleteInProgress] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [leaveInProgress, setLeaveInProgress] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [dissolveInProgress, setDissolveInProgress] = useState(false);
  const [dissolveError, setDissolveError] = useState<string | null>(null);
  const [investmentAccounts, setInvestmentAccounts] = useState<BankAccount[]>([]);
  const [cashAccounts, setCashAccounts] = useState<BankAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [showCreateInvestmentForm, setShowCreateInvestmentForm] = useState(false);
  const [newInvestmentName, setNewInvestmentName] = useState('');
  const [newInvestmentOwnerType, setNewInvestmentOwnerType] = useState<'user' | 'family'>('user');
  const [newInvestmentProvider, setNewInvestmentProvider] = useState('');
  const [creatingInvestmentAccount, setCreatingInvestmentAccount] = useState(false);
  const [createInvestmentError, setCreateInvestmentError] = useState<string | null>(null);

  useEffect(() => {
    void fetchMyFamily()
      .then((result) => setFamily(result))
      .catch(() => setFamily(null));
  }, []);

  const loadAccounts = async () => {
    setAccountsLoading(true);
    setAccountsError(null);

    try {
      const [loadedCashAccounts, loadedInvestmentAccounts] = await Promise.all([
        fetchBankAccounts('cash'),
        fetchBankAccounts('investment'),
      ]);
      setCashAccounts(loadedCashAccounts);
      setInvestmentAccounts(loadedInvestmentAccounts);
    } catch (reason: unknown) {
      setAccountsError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setAccountsLoading(false);
    }
  };

  useEffect(() => {
    void loadAccounts();
  }, []);

  const handleDeleteAccount = async () => {
    const isConfirmed = window.confirm(
      'Удалить аккаунт и все данные? Это действие необратимо: будут удалены категории, операции, группы, банк и история обменов.',
    );

    if (!isConfirmed) {
      return;
    }

    setDeleteInProgress(true);
    setDeleteError(null);

    try {
      await deleteAccount();
      window.location.reload();
    } catch (reason: unknown) {
      setDeleteError(reason instanceof Error ? reason.message : String(reason));
      setDeleteInProgress(false);
    }
  };

  const isFamilyOwner = family?.created_by_user_id === user.user_id;

  const handleLeaveFamily = async () => {
    if (!window.confirm('Покинуть семью? Ваши личные данные не пострадают.')) {
      return;
    }

    setLeaveInProgress(true);
    setLeaveError(null);

    try {
      await leaveFamily();
      setFamily(null);
      setFamilyRefreshKey((prev) => prev + 1);
    } catch (reason: unknown) {
      setLeaveError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLeaveInProgress(false);
    }
  };

  const handleDissolveFamily = async () => {
    if (!window.confirm(
      'Распустить семью? Все семейные счета, категории и история операций будут удалены. Личные данные участников не пострадают.',
    )) {
      return;
    }

    setDissolveInProgress(true);
    setDissolveError(null);

    try {
      await dissolveFamily();
      setFamily(null);
      setFamilyRefreshKey((prev) => prev + 1);
    } catch (reason: unknown) {
      setDissolveError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDissolveInProgress(false);
    }
  };

  useEffect(() => {
    if (!family && newInvestmentOwnerType === 'family') {
      setNewInvestmentOwnerType('user');
    }
  }, [family, newInvestmentOwnerType]);

  const handleCreateInvestmentAccount = async () => {
    const trimmedName = newInvestmentName.trim();
    if (!trimmedName || creatingInvestmentAccount) {
      return;
    }

    setCreatingInvestmentAccount(true);
    setCreateInvestmentError(null);

    try {
      await createBankAccount({
        name: trimmedName,
        owner_type: newInvestmentOwnerType,
        account_kind: 'investment',
        provider_name: newInvestmentProvider.trim() || undefined,
      });
      setNewInvestmentName('');
      setNewInvestmentProvider('');
      setShowCreateInvestmentForm(false);
      await loadAccounts();
    } catch (reason: unknown) {
      setCreateInvestmentError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreatingInvestmentAccount(false);
    }
  };

  return (
    <>
      <h1 className="page-title">Настройки</h1>

      <div className="portfolio-type-tabs" style={{ marginBottom: 20 }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`portfolio-type-tabs__item${activeTab === tab.id ? ' portfolio-type-tabs__item--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'appearance' && (
        <section className="settings-section">
          <div className="panel">
            <p className="settings-label">Тема интерфейса</p>
            <div className="theme-picker">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`theme-picker__option${theme === opt.value ? ' theme-picker__option--active' : ''}`}
                  onClick={() => setTheme(opt.value)}
                >
                  <span className="theme-picker__icon"><opt.icon /></span>
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="settings-row settings-row--first">
              <div>
                <div className="settings-row__title">Подсказки жестов</div>
                <div className="settings-row__sub">Показывать подсказки по свайпам в категориях</div>
              </div>
              <button
                className={`toggle${hintsEnabled ? ' toggle--on' : ''}`}
                type="button"
                role="switch"
                aria-checked={hintsEnabled}
                onClick={toggleHints}
              />
            </div>
          </div>
        </section>
      )}

      {activeTab === 'account' && (
        <section className="settings-section">
          <div className="panel">
            <ul>
              <li className="settings-row settings-row--first">
                <div>
                  <div className="settings-row__title">Личная базовая валюта</div>
                  <div className="settings-row__sub">Все личные категории ведутся в этой валюте</div>
                </div>
                <span className="pill">{user.base_currency_code}</span>
              </li>
              {family && (
                <>
                  <li className="settings-row">
                    <div>
                      <div className="settings-row__title">Семья</div>
                      <div className="settings-row__sub">Семейный бюджет подключён</div>
                    </div>
                    <span className="tag tag--neutral">{family.name}</span>
                  </li>
                  <li className="settings-row">
                    <div>
                      <div className="settings-row__title">Семейная базовая валюта</div>
                      <div className="settings-row__sub">Все семейные категории ведутся в этой валюте</div>
                    </div>
                    <span className="pill">{family.base_currency_code}</span>
                  </li>
                </>
              )}
              <li className="settings-row">
                <div>
                  <div className="settings-row__title">Банковский счёт</div>
                  <div className="settings-row__sub">Основной счёт для операций</div>
                </div>
                <span className="tag tag--neutral">Main #{user.bank_account_id}</span>
              </li>
            </ul>
          </div>

          <h2 className="settings-section__title" style={{ marginTop: 24 }}>Опасная зона</h2>
          <div className="panel">
            <div className="settings-danger">
              <div>
                <div className="settings-row__title">Удалить аккаунт</div>
                <div className="settings-row__sub">
                  Полностью очистить все данные пользователя: банк, операции, категории, группы и историю обменов.
                </div>
                {deleteError && <div className="settings-danger__error">{deleteError}</div>}
              </div>
              <button
                className="btn btn--danger"
                type="button"
                onClick={handleDeleteAccount}
                disabled={deleteInProgress}
              >
                {deleteInProgress ? 'Удаляем...' : 'Удалить аккаунт'}
              </button>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'family' && (
        <section className="settings-section">
          <Family
            key={familyRefreshKey}
            user={user}
            onBadgeUpdate={onFamilyBadgeUpdate}
            onFamilyChange={setFamily}
            embedded
          />
          {family && (
            <>
              <h2 className="settings-section__title" style={{ marginTop: 24 }}>Опасная зона</h2>
              <div className="panel">
                <div className="settings-danger">
                  <div>
                    <div className="settings-row__title">
                      {isFamilyOwner ? 'Распустить семью' : 'Покинуть семью'}
                    </div>
                    <div className="settings-row__sub">
                      {isFamilyOwner
                        ? 'Все семейные счета, категории и история операций будут удалены безвозвратно. Личные данные участников не пострадают.'
                        : 'Вы выйдете из семьи. Ваши личные счета и данные останутся нетронутыми.'}
                    </div>
                    {isFamilyOwner && dissolveError && <div className="settings-danger__error">{dissolveError}</div>}
                    {!isFamilyOwner && leaveError && <div className="settings-danger__error">{leaveError}</div>}
                  </div>
                  <button
                    className="btn btn--danger"
                    type="button"
                    onClick={isFamilyOwner ? handleDissolveFamily : handleLeaveFamily}
                    disabled={leaveInProgress || dissolveInProgress}
                  >
                    {isFamilyOwner
                      ? (dissolveInProgress ? 'Удаляем...' : 'Распустить')
                      : (leaveInProgress ? 'Выходим...' : 'Покинуть')}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {activeTab === 'investments' && (
        <section className="settings-section">
          <div className="panel">
            <div className="settings-row settings-row--first">
              <div>
                <div className="settings-row__title">Инвестиционные счета</div>
                <div className="settings-row__sub">Отдельные счета и переводы cash ↔ investment</div>
              </div>
              <button className="btn" type="button" onClick={() => setShowCreateInvestmentForm((prev) => !prev)}>
                {showCreateInvestmentForm ? 'Скрыть' : 'Новый счёт'}
              </button>
            </div>

            {showCreateInvestmentForm && (
              <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
                <div className="form-row">
                  <input
                    className="input"
                    type="text"
                    placeholder="Название инвестиционного счёта"
                    value={newInvestmentName}
                    onChange={(event) => setNewInvestmentName(event.target.value)}
                  />
                </div>
                <div className="form-row">
                  <select
                    className="input"
                    value={newInvestmentOwnerType}
                    onChange={(event) => setNewInvestmentOwnerType(event.target.value as 'user' | 'family')}
                    disabled={!family}
                  >
                    <option value="user">Личный контур</option>
                    {family && <option value="family">Семейный контур</option>}
                  </select>
                </div>
                <div className="form-row">
                  <input
                    className="input"
                    type="text"
                    placeholder="Провайдер (необязательно)"
                    value={newInvestmentProvider}
                    onChange={(event) => setNewInvestmentProvider(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && !creatingInvestmentAccount && handleCreateInvestmentAccount()}
                  />
                </div>
                {createInvestmentError && <div className="settings-danger__error">{createInvestmentError}</div>}
                <div className="form-row">
                  <button
                    className="btn"
                    type="button"
                    onClick={handleCreateInvestmentAccount}
                    disabled={creatingInvestmentAccount || !newInvestmentName.trim()}
                  >
                    {creatingInvestmentAccount ? 'Создаём...' : 'Создать счёт'}
                  </button>
                </div>
              </div>
            )}

            {accountsError && <div className="settings-danger__error">{accountsError}</div>}

            {accountsLoading ? (
              <div className="settings-row__sub">Загружаем счета...</div>
            ) : investmentAccounts.length === 0 ? (
              <div className="settings-row__sub">Инвестиционных счетов пока нет.</div>
            ) : (
              <ul>
                {investmentAccounts.map((account) => (
                  <li key={account.id} className="settings-row">
                    <div>
                      <div className="settings-row__title">{account.name}</div>
                      <div className="settings-row__sub">
                        {account.owner_type === 'family' ? 'Семейный' : 'Личный'} счёт
                        {account.provider_name ? ` · ${account.provider_name}` : ''}
                      </div>
                    </div>
                    <span className="tag tag--neutral">#{account.id}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {activeTab === 'data' && (
        <section className="settings-section">
          <div className="panel">
            <ul>
              <li className="settings-row settings-row--first">
                <div>
                  <div className="settings-row__title">Экспорт операций</div>
                  <div className="settings-row__sub">Скачать историю в CSV</div>
                </div>
                <button className="btn" type="button">Скачать</button>
              </li>
              <li className="settings-row">
                <div>
                  <div className="settings-row__title">Курсы валют</div>
                  <div className="settings-row__sub">Источник и время последнего обновления</div>
                </div>
                <span className="tag tag--neutral">CBR</span>
              </li>
            </ul>
          </div>
        </section>
      )}
    </>
  );
}
