import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useTheme } from '../hooks/useTheme';
import type { Theme } from '../hooks/useTheme';
import { useHints } from '../hooks/useHints';
import {
  IconCheck,
  IconChevronRight,
  IconCoin,
  IconDatabase,
  IconDownload,
  IconFamily,
  IconInfo,
  IconKey,
  IconMail,
  IconPaint,
  IconPlug,
  IconPlus,
  IconRefreshCw,
  IconShield,
  IconThemeAuto,
  IconThemeDark,
  IconThemeLight,
  IconTrash,
  IconTrendUp,
  IconUser,
  IconWarn,
} from '../components/Icons';
import {
  createBankAccount,
  deleteAccount,
  deleteInvestmentAccount,
  deleteTinkoffConnection,
  dissolveFamily,
  fetchBankAccounts,
  fetchFamilyInvitations,
  fetchFamilyMembers,
  fetchMyFamily,
  getTinkoffConnections,
  leaveFamily,
} from '../api';
import Family from './Family';
import TinkoffConnectDialog from '../components/TinkoffConnectDialog';
import { getTelegramWebApp } from '../telegram';
import type {
  BankAccount,
  ExternalConnection,
  FamilyInfo,
  FamilyInvitation,
  FamilyMember,
  UserContext,
} from '../types';

type SettingsTab = 'appearance' | 'account' | 'family' | 'investments' | 'integrations' | 'data';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'appearance',   label: 'Оформление' },
  { id: 'account',      label: 'Аккаунт' },
  { id: 'family',       label: 'Семья' },
  { id: 'investments',  label: 'Инвестиции' },
  { id: 'integrations', label: 'Интеграции' },
  { id: 'data',         label: 'Данные' },
];

const THEME_OPTIONS: { value: Theme; label: string; Icon: () => React.ReactElement }[] = [
  { value: 'system', label: 'Системная', Icon: IconThemeAuto },
  { value: 'light',  label: 'Светлая',   Icon: IconThemeLight },
  { value: 'dark',   label: 'Тёмная',    Icon: IconThemeDark },
];

const ASSET_CHIP: Record<NonNullable<BankAccount['investment_asset_type']>, { tone: string; label: string; abbr: string }> = {
  security: { tone: 'invest-tile__chip--y', label: 'Ценные бумаги', abbr: 'ЦБ' },
  deposit:  { tone: 'invest-tile__chip--g', label: 'Депозиты',      abbr: 'ДП' },
  crypto:   { tone: 'invest-tile__chip--p', label: 'Криптовалюта',  abbr: 'КР' },
  other:    { tone: 'invest-tile__chip--r', label: 'Разное',        abbr: '••' },
};

function memberFullName(m: FamilyMember): string {
  const full = [m.first_name, m.last_name].filter(Boolean).join(' ');
  if (full) return full;
  if (m.username) return `@${m.username}`;
  return 'Участник';
}

function memberInitial(m: FamilyMember): string {
  const source = m.first_name || m.last_name || m.username || '?';
  return source.trim().charAt(0).toUpperCase() || '?';
}

const MEMBER_TONES = ['member__avatar--g', 'member__avatar--c', 'member__avatar--p', 'member__avatar--y'];

function getTelegramIdentity(): { name: string; handle: string | null; initial: string; photoUrl: string | null } {
  const tgUser = getTelegramWebApp()?.initDataUnsafe?.user;
  if (!tgUser) return { name: 'Пользователь', handle: null, initial: 'У', photoUrl: null };
  const full = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
  const name = full || tgUser.username || 'Пользователь';
  const handle = tgUser.username ? `@${tgUser.username}` : null;
  const initial = (tgUser.first_name?.[0] || tgUser.username?.[0] || 'У').toUpperCase();
  const photoUrl = tgUser.photo_url ?? null;
  return { name, handle, initial, photoUrl };
}

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
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [pendingInvites, setPendingInvites] = useState<FamilyInvitation[]>([]);
  const [familyRefreshKey, setFamilyRefreshKey] = useState(0);

  const [deleteInProgress, setDeleteInProgress] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [leaveInProgress, setLeaveInProgress] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [dissolveInProgress, setDissolveInProgress] = useState(false);
  const [dissolveError, setDissolveError] = useState<string | null>(null);

  const [investmentAccounts, setInvestmentAccounts] = useState<BankAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [showCreateInvestmentForm, setShowCreateInvestmentForm] = useState(false);
  const [newInvestmentName, setNewInvestmentName] = useState('');
  const [newInvestmentOwnerType, setNewInvestmentOwnerType] = useState<'user' | 'family'>('user');
  const [newInvestmentProvider, setNewInvestmentProvider] = useState('');
  const [newInvestmentAssetType, setNewInvestmentAssetType] = useState<NonNullable<BankAccount['investment_asset_type']>>('security');
  const [creatingInvestmentAccount, setCreatingInvestmentAccount] = useState(false);
  const [createInvestmentError, setCreateInvestmentError] = useState<string | null>(null);
  const [deletingInvestmentAccountId, setDeletingInvestmentAccountId] = useState<number | null>(null);
  const [deleteInvestmentError, setDeleteInvestmentError] = useState<string | null>(null);

  const [tinkoffConnections, setTinkoffConnections] = useState<ExternalConnection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [showTinkoffConnectDialog, setShowTinkoffConnectDialog] = useState(false);
  const [deletingConnectionId, setDeletingConnectionId] = useState<number | null>(null);

  const tabsRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const tabRefs = useRef<Record<SettingsTab, HTMLButtonElement | null>>({} as Record<SettingsTab, HTMLButtonElement | null>);

  const identity = useMemo(getTelegramIdentity, []);

  // ── Loaders ───────────────────────────────────────────────
  const loadFamily = async () => {
    try {
      const [info, invites] = await Promise.all([fetchMyFamily(), fetchFamilyInvitations()]);
      setFamily(info);
      setPendingInvites(invites.filter((i) => i.status === 'pending'));
      onFamilyBadgeUpdate(invites.filter((i) => i.status === 'pending').length);
      if (info) {
        setFamilyMembers(await fetchFamilyMembers());
      } else {
        setFamilyMembers([]);
      }
    } catch {
      setFamily(null);
      setFamilyMembers([]);
    }
  };

  const loadAccounts = async () => {
    setAccountsLoading(true);
    setAccountsError(null);
    try {
      const items = await fetchBankAccounts('investment');
      setInvestmentAccounts(items);
    } catch (reason: unknown) {
      setAccountsError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setAccountsLoading(false);
    }
  };

  const loadConnections = async () => {
    setConnectionsLoading(true);
    try {
      setTinkoffConnections(await getTinkoffConnections());
    } catch {
      // ignore
    } finally {
      setConnectionsLoading(false);
    }
  };

  useEffect(() => { void loadFamily(); }, []);
  useEffect(() => { void loadAccounts(); }, []);
  useEffect(() => {
    if (activeTab === 'integrations') void loadConnections();
  }, [activeTab]);

  useEffect(() => {
    if (!family && newInvestmentOwnerType === 'family') {
      setNewInvestmentOwnerType('user');
    }
  }, [family, newInvestmentOwnerType]);

  // ── Indicator positioning ─────────────────────────────────
  useEffect(() => {
    const tabs = tabsRef.current;
    const ind = indicatorRef.current;
    const target = tabRefs.current[activeTab];
    if (!tabs || !ind || !target) return;

    const update = () => {
      const tabsRect = tabs.getBoundingClientRect();
      const r = target.getBoundingClientRect();
      const left = r.left - tabsRect.left + tabs.scrollLeft;
      ind.style.width = `${Math.max(r.width - 12, 16)}px`;
      ind.style.transform = `translateX(${left + 6}px)`;
    };

    update();
    const onResize = () => update();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [activeTab]);

  const handleTabClick = (id: SettingsTab) => {
    setActiveTab(id);
    const target = tabRefs.current[id];
    target?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };

  // ── Account / family actions ──────────────────────────────
  const isFamilyOwner = family?.created_by_user_id === user.user_id;
  const deleteBlockedByFamily = family
    ? (isFamilyOwner
      ? 'Сначала распустите семью, затем удалите аккаунт.'
      : 'Сначала покиньте семью, затем удалите аккаунт.')
    : null;

  const handleDeleteAccount = async () => {
    if (deleteBlockedByFamily) {
      setDeleteError(deleteBlockedByFamily);
      return;
    }
    if (!window.confirm(
      'Удалить аккаунт и все данные? Это действие необратимо: будут удалены категории, операции, группы, банк и история обменов.',
    )) return;

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

  const handleLeaveFamily = async () => {
    if (!window.confirm('Покинуть семью? Ваши личные данные не пострадают.')) return;
    setLeaveInProgress(true);
    setLeaveError(null);
    try {
      await leaveFamily();
      setFamily(null);
      setFamilyMembers([]);
      setFamilyRefreshKey((k) => k + 1);
    } catch (reason: unknown) {
      setLeaveError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLeaveInProgress(false);
    }
  };

  const handleDissolveFamily = async () => {
    if (!window.confirm(
      'Распустить семью? Все семейные счета, категории и история операций будут удалены. Личные данные участников не пострадают.',
    )) return;
    setDissolveInProgress(true);
    setDissolveError(null);
    try {
      await dissolveFamily();
      setFamily(null);
      setFamilyMembers([]);
      setFamilyRefreshKey((k) => k + 1);
    } catch (reason: unknown) {
      setDissolveError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDissolveInProgress(false);
    }
  };

  // ── Investments actions ───────────────────────────────────
  const handleCreateInvestmentAccount = async () => {
    const trimmed = newInvestmentName.trim();
    if (!trimmed || creatingInvestmentAccount) return;

    setCreatingInvestmentAccount(true);
    setCreateInvestmentError(null);
    try {
      await createBankAccount({
        name: trimmed,
        owner_type: newInvestmentOwnerType,
        account_kind: 'investment',
        investment_asset_type: newInvestmentAssetType,
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

  const handleDeleteInvestmentAccount = async (account: BankAccount) => {
    if (!window.confirm(
      `Удалить инвестиционный счёт «${account.name}»? Это сработает только если счёт пустой и без остатка.`,
    )) return;

    setDeletingInvestmentAccountId(account.id);
    setDeleteInvestmentError(null);
    try {
      await deleteInvestmentAccount(account.id);
      await loadAccounts();
    } catch (reason: unknown) {
      setDeleteInvestmentError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDeletingInvestmentAccountId(null);
    }
  };

  // ── Tinkoff actions ───────────────────────────────────────
  const handleDeleteConnection = async (connId: number) => {
    if (!window.confirm('Удалить подключение к Тинькофф?')) return;
    setDeletingConnectionId(connId);
    try {
      await deleteTinkoffConnection(connId);
      setTinkoffConnections((prev) => prev.filter((c) => c.id !== connId));
    } catch {
      // ignore
    } finally {
      setDeletingConnectionId(null);
    }
  };

  const memberCount = familyMembers.length;
  const familyDisplayCount = memberCount + pendingInvites.length;

  return (
    <div className="settings-page">
      {/* Identity card */}
      <article className="ident">
        <div className="ident__row">
          <div className="ident__avatar">
            {identity.photoUrl
              ? <img src={identity.photoUrl} alt={identity.name} className="ident__photo" />
              : <span className="ident__monogram">{identity.initial}</span>
            }
            <span className="ident__pulse" aria-hidden />
          </div>
          <div className="ident__meta">
            <span className="ident__eyebrow">Аккаунт <em>·</em> Telegram</span>
            <h2 className="ident__name">{identity.name}</h2>
            {identity.handle && <span className="ident__handle">{identity.handle}</span>}
          </div>
        </div>
        <div className="ident__chips">
          {family && (
            <span className={`ichip${isFamilyOwner ? ' ichip--owner' : ''}`}>
              <IconShield />
              {isFamilyOwner ? 'Владелец семьи' : 'Участник семьи'}
            </span>
          )}
          <span className="ichip">
            <IconCoin />
            Базовая {user.base_currency_code}
          </span>
          {family && (
            <span className="ichip">
              <IconFamily />
              {familyDisplayCount} {familyDisplayCount === 1 ? 'в семье' : 'в семье'}
            </span>
          )}
        </div>
      </article>

      {/* Tabs */}
      <nav className="st-tabs" role="tablist" aria-label="Раздел настроек" ref={tabsRef}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            ref={(el) => { tabRefs.current[tab.id] = el; }}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`st-tabs__item${activeTab === tab.id ? ' st-tabs__item--on' : ''}`}
            onClick={() => handleTabClick(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <span className="st-tabs__ind" ref={indicatorRef} aria-hidden />
      </nav>

      {/* Appearance */}
      {activeTab === 'appearance' && (
        <div className="view-pane view-pane--on">
          <section className="st-card-sec">
            <header className="st-card-sec__head">
              <div className="st-card-sec__title-row">
                <span className="st-card-sec__ico st-card-sec__ico--paint"><IconPaint /></span>
                <div className="st-card-sec__title-meta">
                  <h3 className="st-card-sec__title">Тема интерфейса</h3>
                  <span className="st-card-sec__sub">Светлая, тёмная или как в системе</span>
                </div>
              </div>
            </header>

            <div className="theme-grid" role="radiogroup" aria-label="Тема">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={theme === opt.value}
                  className={`theme-card${theme === opt.value ? ' theme-card--on' : ''}`}
                  onClick={() => setTheme(opt.value)}
                >
                  <span className={`theme-card__preview theme-card__preview--${opt.value}`}>
                    {opt.value === 'system' ? (
                      <>
                        <span className="tcp-half tcp-half--light">
                          <span className="tcp-bar" />
                          <span className="tcp-chip" />
                        </span>
                        <span className="tcp-half tcp-half--dark">
                          <span className="tcp-bar" />
                          <span className="tcp-chip" />
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="tcp-bar" />
                        <span className="tcp-card">
                          <span className="tcp-card__bar" />
                          <span className="tcp-card__bar tcp-card__bar--sm" />
                        </span>
                        <span className="tcp-chip" />
                      </>
                    )}
                  </span>
                  <span className="theme-card__lab">
                    <span className="theme-card__ico"><opt.Icon /></span>
                    {opt.label}
                  </span>
                  <span className="theme-card__check"><IconCheck /></span>
                </button>
              ))}
            </div>
          </section>

          <section className="st-card-sec">
            <header className="st-card-sec__head">
              <div className="st-card-sec__title-row">
                <span className="st-card-sec__ico st-card-sec__ico--toggle"><IconInfo /></span>
                <div className="st-card-sec__title-meta">
                  <h3 className="st-card-sec__title">Поведение</h3>
                  <span className="st-card-sec__sub">Подсказки и взаимодействие</span>
                </div>
              </div>
            </header>

            <ul className="rows">
              <li className="row">
                <div className="row__main">
                  <div className="row__title">Подсказки жестов</div>
                  <div className="row__sub">Показывать подсказки по свайпам в категориях</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={hintsEnabled}
                  className={`sw${hintsEnabled ? ' sw--on' : ''}`}
                  onClick={toggleHints}
                >
                  <span className="sw__thumb" />
                </button>
              </li>
            </ul>
          </section>
        </div>
      )}

      {/* Account */}
      {activeTab === 'account' && (
        <div className="view-pane view-pane--on">
          <section className="st-card-sec">
            <header className="st-card-sec__head">
              <div className="st-card-sec__title-row">
                <span className="st-card-sec__ico st-card-sec__ico--user"><IconUser /></span>
                <div className="st-card-sec__title-meta">
                  <h3 className="st-card-sec__title">Контуры и валюты</h3>
                  <span className="st-card-sec__sub">Личный {family ? '· Семейный' : ''}</span>
                </div>
              </div>
            </header>

            <ul className="rows">
              <li className="row">
                <div className="row__main">
                  <div className="row__title">Личная базовая валюта</div>
                  <div className="row__sub">Все личные категории ведутся в этой валюте</div>
                </div>
                <span className="pill-ink">{user.base_currency_code}</span>
              </li>
              {family && (
                <>
                  <li className="row">
                    <div className="row__main">
                      <div className="row__title">Семья</div>
                      <div className="row__sub">Семейный бюджет подключён</div>
                    </div>
                    <span className="st-tag">{family.name}</span>
                  </li>
                  <li className="row">
                    <div className="row__main">
                      <div className="row__title">Семейная базовая валюта</div>
                      <div className="row__sub">Все семейные категории ведутся в этой валюте</div>
                    </div>
                    <span className="pill-ink">{family.base_currency_code}</span>
                  </li>
                </>
              )}
              <li className="row">
                <div className="row__main">
                  <div className="row__title">Банковский счёт</div>
                  <div className="row__sub">Основной счёт для операций</div>
                </div>
                <span className="st-tag">Main #{user.bank_account_id}</span>
              </li>
            </ul>
          </section>

          <h2 className="danger-title">
            <span className="danger-title__bullet" />
            Опасная зона
          </h2>
          <section className="danger-card">
            <div className="danger-card__head">
              <span className="danger-card__ico"><IconWarn /></span>
              <div className="danger-card__meta">
                <div className="danger-card__title">Удалить аккаунт</div>
                <div className="danger-card__sub">
                  {deleteBlockedByFamily
                    ? deleteBlockedByFamily
                    : 'Полностью очистить все данные пользователя: банк, операции, категории, группы и историю обменов.'}
                </div>
                {deleteError && <div className="danger-card__error">{deleteError}</div>}
              </div>
            </div>
            <div className="danger-card__action">
              <button
                className="st-btn st-btn--danger"
                type="button"
                onClick={handleDeleteAccount}
                disabled={deleteInProgress || Boolean(deleteBlockedByFamily)}
              >
                {deleteInProgress
                  ? 'Удаляем…'
                  : deleteBlockedByFamily
                    ? 'Недоступно'
                    : 'Удалить аккаунт'}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Family */}
      {activeTab === 'family' && (
        <div className="view-pane view-pane--on">
          {family ? (
            <>
              <section className="st-card-sec">
                <header className="st-card-sec__head">
                  <div className="st-card-sec__title-row">
                    <span className="st-card-sec__ico st-card-sec__ico--family"><IconFamily /></span>
                    <div className="st-card-sec__title-meta">
                      <h3 className="st-card-sec__title">Семья «{family.name}»</h3>
                      <span className="st-card-sec__sub">
                        {memberCount} {memberCount === 1 ? 'участник' : 'участников'} · базовая {family.base_currency_code}
                      </span>
                    </div>
                  </div>
                </header>

                <ul className="members">
                  {familyMembers.map((m, idx) => {
                    const isYou = m.user_id === user.user_id;
                    const isOwnerRole = m.role === 'owner';
                    const tone = isOwnerRole ? 'member__avatar--y' : MEMBER_TONES[idx % MEMBER_TONES.length];
                    return (
                      <li key={m.user_id} className="member">
                        <span className={`member__avatar ${tone}`}>{memberInitial(m)}</span>
                        <div className="member__meta">
                          <div className="member__name">
                            {memberFullName(m)}
                            {isYou && <span className="member__you">— это вы</span>}
                          </div>
                          {m.username && (
                            <div className="member__sub">@{m.username}</div>
                          )}
                        </div>
                        <span className={`rolebadge${isOwnerRole ? ' rolebadge--owner' : ''}`}>
                          {isOwnerRole && <IconShield />}
                          {isOwnerRole ? 'Владелец' : 'Участник'}
                        </span>
                      </li>
                    );
                  })}
                  {pendingInvites.map((inv) => (
                    <li key={`inv-${inv.invitation_id}`} className="member member--pending">
                      <span className="member__avatar member__avatar--gh">?</span>
                      <div className="member__meta">
                        <div className="member__name">Приглашение отправлено</div>
                        <div className="member__sub">
                          {inv.invited_by_username ? `@${inv.invited_by_username} · ожидает подтверждения` : 'Ожидает подтверждения'}
                        </div>
                      </div>
                      <span className="rolebadge rolebadge--pending">
                        <IconMail />
                        Pending
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <h2 className="danger-title">
                <span className="danger-title__bullet" />
                Опасная зона
              </h2>
              <section className="danger-card">
                <div className="danger-card__head">
                  <span className="danger-card__ico"><IconWarn /></span>
                  <div className="danger-card__meta">
                    <div className="danger-card__title">
                      {isFamilyOwner ? 'Распустить семью' : 'Покинуть семью'}
                    </div>
                    <div className="danger-card__sub">
                      {isFamilyOwner
                        ? 'Все семейные счета, категории и история операций будут удалены безвозвратно. Личные данные участников не пострадают.'
                        : 'Вы выйдете из семьи. Ваши личные счета и данные останутся нетронутыми.'}
                    </div>
                    {isFamilyOwner && dissolveError && <div className="danger-card__error">{dissolveError}</div>}
                    {!isFamilyOwner && leaveError && <div className="danger-card__error">{leaveError}</div>}
                  </div>
                </div>
                <div className="danger-card__action">
                  <button
                    className="st-btn st-btn--danger"
                    type="button"
                    onClick={isFamilyOwner ? handleDissolveFamily : handleLeaveFamily}
                    disabled={leaveInProgress || dissolveInProgress}
                  >
                    {isFamilyOwner
                      ? (dissolveInProgress ? 'Удаляем…' : 'Распустить')
                      : (leaveInProgress ? 'Выходим…' : 'Покинуть')}
                  </button>
                </div>
              </section>
            </>
          ) : (
            <Family
              key={familyRefreshKey}
              user={user}
              onBadgeUpdate={onFamilyBadgeUpdate}
              onFamilyChange={(f) => { setFamily(f); if (f) void loadFamily(); }}
              embedded
            />
          )}
        </div>
      )}

      {/* Investments */}
      {activeTab === 'investments' && (
        <div className="view-pane view-pane--on">
          <section className="st-card-sec">
            <header className="st-card-sec__head">
              <div className="st-card-sec__title-row">
                <span className="st-card-sec__ico st-card-sec__ico--trend"><IconTrendUp /></span>
                <div className="st-card-sec__title-meta">
                  <h3 className="st-card-sec__title">Инвестиционные счета</h3>
                  <span className="st-card-sec__sub">Отдельные счета и переводы cash ↔ investment</span>
                </div>
              </div>
              <button
                type="button"
                className="add-pill-ink"
                onClick={() => setShowCreateInvestmentForm((prev) => !prev)}
              >
                <IconPlus />
                {showCreateInvestmentForm ? 'Скрыть' : 'Новый'}
              </button>
            </header>

            {showCreateInvestmentForm && (
              <form
                className="invest-form"
                onSubmit={(e) => { e.preventDefault(); void handleCreateInvestmentAccount(); }}
              >
                <label className="st-field">
                  <span className="st-field__lab">Название счёта</span>
                  <input
                    className="st-input"
                    type="text"
                    placeholder="например, Тинькофф Брокер"
                    value={newInvestmentName}
                    onChange={(e) => setNewInvestmentName(e.target.value)}
                    autoFocus
                  />
                </label>
                <div className="field-grid">
                  <label className="st-field">
                    <span className="st-field__lab">Контур</span>
                    <select
                      className="st-input"
                      value={newInvestmentOwnerType}
                      onChange={(e) => setNewInvestmentOwnerType(e.target.value as 'user' | 'family')}
                      disabled={!family}
                    >
                      <option value="user">Личный</option>
                      {family && <option value="family">Семейный</option>}
                    </select>
                  </label>
                  <label className="st-field">
                    <span className="st-field__lab">Тип актива</span>
                    <select
                      className="st-input"
                      value={newInvestmentAssetType}
                      onChange={(e) => setNewInvestmentAssetType(e.target.value as NonNullable<BankAccount['investment_asset_type']>)}
                    >
                      <option value="security">Ценные бумаги</option>
                      <option value="deposit">Депозиты</option>
                      <option value="crypto">Криптовалюта</option>
                      <option value="other">Разное</option>
                    </select>
                  </label>
                </div>
                <label className="st-field">
                  <span className="st-field__lab">
                    Провайдер <em className="st-field__opt">необязательно</em>
                  </span>
                  <input
                    className="st-input"
                    type="text"
                    placeholder="Тинькофф · Альфа · Bybit…"
                    value={newInvestmentProvider}
                    onChange={(e) => setNewInvestmentProvider(e.target.value)}
                  />
                </label>
                {createInvestmentError && (
                  <div className="danger-card__error">{createInvestmentError}</div>
                )}
                <div className="invest-form__foot">
                  <button
                    type="button"
                    className="st-btn st-btn--ghost"
                    onClick={() => { setShowCreateInvestmentForm(false); setCreateInvestmentError(null); }}
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    className="st-btn st-btn--primary"
                    disabled={creatingInvestmentAccount || !newInvestmentName.trim()}
                  >
                    {creatingInvestmentAccount ? 'Создаём…' : 'Создать счёт'}
                  </button>
                </div>
              </form>
            )}

            {accountsError && <div className="danger-card__error">{accountsError}</div>}
            {deleteInvestmentError && <div className="danger-card__error">{deleteInvestmentError}</div>}

            {accountsLoading ? (
              <div className="row__sub">Загружаем счета…</div>
            ) : investmentAccounts.length === 0 ? (
              <div className="row__sub">Инвестиционных счетов пока нет.</div>
            ) : (
              <ul className="invest-list">
                {investmentAccounts.map((account) => {
                  const tone = account.investment_asset_type
                    ? ASSET_CHIP[account.investment_asset_type]
                    : null;
                  const abbr = tone?.abbr
                    ?? account.name.trim().slice(0, 2).toUpperCase()
                    ?? '••';
                  const chipClass = tone?.tone ?? 'invest-tile__chip--g';
                  return (
                    <li key={account.id} className="invest-tile">
                      <span className={`invest-tile__chip ${chipClass}`}>{abbr}</span>
                      <div className="invest-tile__meta">
                        <div className="invest-tile__name">{account.name}</div>
                        <div className="invest-tile__sub">
                          <span className={`dot ${account.owner_type === 'family' ? 'dot--y' : 'dot--g'}`} />
                          {account.owner_type === 'family' ? 'Семейный' : 'Личный'}
                          {tone && <><em>·</em>{tone.label}</>}
                          {account.provider_name && <><em>·</em>{account.provider_name}</>}
                        </div>
                      </div>
                      <div className="invest-tile__right">
                        <span className="st-tag">#{account.id}</span>
                        <button
                          type="button"
                          className="ic-btn-xs"
                          aria-label="Удалить"
                          disabled={deletingInvestmentAccountId === account.id}
                          onClick={() => void handleDeleteInvestmentAccount(account)}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* Integrations */}
      {activeTab === 'integrations' && (
        <div className="view-pane view-pane--on">
          <section className="st-card-sec">
            <header className="st-card-sec__head">
              <div className="st-card-sec__title-row">
                <span className="st-card-sec__ico st-card-sec__ico--plug"><IconPlug /></span>
                <div className="st-card-sec__title-meta">
                  <h3 className="st-card-sec__title">Подключения</h3>
                  <span className="st-card-sec__sub">Подтягивать операции из внешних источников</span>
                </div>
              </div>
            </header>

            <article className="prov">
              <header className="prov__head">
                <span className="prov__brand prov__brand--ti">Т</span>
                <div className="prov__meta">
                  <div className="prov__name">Тинькофф Инвестиции</div>
                  <div className="prov__sub">
                    {connectionsLoading
                      ? 'Загружаем…'
                      : tinkoffConnections.length > 0
                        ? <><span className="dot dot--g" />Подключено · {tinkoffConnections.length} {tinkoffConnections.length === 1 ? 'счёт' : 'счета'}</>
                        : 'Подтягивать операции из Тинькофф вручную'}
                  </div>
                </div>
                <button
                  type="button"
                  className="st-btn st-btn--ghost st-btn--sm"
                  onClick={() => setShowTinkoffConnectDialog(true)}
                >
                  <span className="st-btn__ico"><IconPlus /></span>
                  {tinkoffConnections.length > 0 ? 'Ещё счёт' : 'Подключить'}
                </button>
              </header>

              {tinkoffConnections.length > 0 && (
                <ul className="prov__conn">
                  {tinkoffConnections.map((conn) => (
                    <li key={conn.id} className="prov__conn-item">
                      <div className="prov__conn-meta">
                        <div className="prov__conn-name">
                          {conn.linked_account_name ?? `Счёт #${conn.linked_account_id}`}
                        </div>
                        <div className="prov__conn-sub">
                          Тинькофф {conn.provider_account_id}
                          {conn.last_synced_at
                            ? ` · последний синк ${new Date(conn.last_synced_at).toLocaleDateString('ru')}`
                            : ' · ещё не синхронизировано'}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="ic-btn-xs"
                        aria-label="Отключить"
                        disabled={deletingConnectionId === conn.id}
                        onClick={() => handleDeleteConnection(conn.id)}
                      >
                        <IconTrash />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </section>

          {showTinkoffConnectDialog && (
            <TinkoffConnectDialog
              onClose={() => setShowTinkoffConnectDialog(false)}
              onSuccess={() => {
                setShowTinkoffConnectDialog(false);
                void loadConnections();
              }}
            />
          )}
        </div>
      )}

      {/* Data */}
      {activeTab === 'data' && (
        <div className="view-pane view-pane--on">
          <section className="st-card-sec">
            <header className="st-card-sec__head">
              <div className="st-card-sec__title-row">
                <span className="st-card-sec__ico st-card-sec__ico--db"><IconDatabase /></span>
                <div className="st-card-sec__title-meta">
                  <h3 className="st-card-sec__title">Экспорт</h3>
                  <span className="st-card-sec__sub">Скачать копию своих данных</span>
                </div>
              </div>
            </header>

            <ul className="rows">
              <li className="row">
                <div className="row__main">
                  <div className="row__title">Операции · CSV</div>
                  <div className="row__sub">Скоро будет доступно для скачивания</div>
                </div>
                <button type="button" className="st-btn st-btn--ghost st-btn--sm" disabled>
                  <span className="st-btn__ico"><IconDownload /></span>
                  Скачать
                </button>
              </li>
              <li className="row">
                <div className="row__main">
                  <div className="row__title">История курсов</div>
                  <div className="row__sub">Источник: ЦБ РФ + CryptoCompare</div>
                </div>
                <span className="st-tag">CBR · CC</span>
              </li>
            </ul>
          </section>

          <section className="st-card-sec">
            <header className="st-card-sec__head">
              <div className="st-card-sec__title-row">
                <span className="st-card-sec__ico st-card-sec__ico--db"><IconRefreshCw /></span>
                <div className="st-card-sec__title-meta">
                  <h3 className="st-card-sec__title">Кэш и пересчёт</h3>
                  <span className="st-card-sec__sub">Если что-то выглядит несвежим</span>
                </div>
              </div>
            </header>

            <p className="st-card-sec__hint">
              Данные приложения подгружаются с сервера при каждом открытии страницы. Если кажется, что цифры устарели — потяните страницу вниз, чтобы обновить.
            </p>
          </section>

          <section className="st-card-sec">
            <header className="st-card-sec__head">
              <div className="st-card-sec__title-row">
                <span className="st-card-sec__ico st-card-sec__ico--key"><IconKey /></span>
                <div className="st-card-sec__title-meta">
                  <h3 className="st-card-sec__title">Безопасность</h3>
                  <span className="st-card-sec__sub">Подключения и токены</span>
                </div>
              </div>
            </header>

            <p className="st-card-sec__hint">
              Токены внешних провайдеров хранятся в зашифрованном виде. Удалите подключение во вкладке «Интеграции», чтобы прекратить доступ.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
