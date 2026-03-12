import { useState, useEffect, useCallback } from 'react';
import type { UserContext, FamilyInfo, FamilyMember, FamilyInvitation } from '../types';
import {
  fetchMyFamily,
  createFamily,
  fetchFamilyMembers,
  fetchFamilyInvitations,
  inviteToFamily,
  acceptInvitation,
  declineInvitation,
  leaveFamily,
  dissolveFamily,
} from '../api';

interface Props {
  user: UserContext;
  onBadgeUpdate: (count: number) => void;
}

function memberDisplayName(m: FamilyMember): string {
  const full = [m.first_name, m.last_name].filter(Boolean).join(' ');
  if (full) return full;
  if (m.username) return `@${m.username}`;
  return `ID ${m.user_id}`;
}

export default function Family({ user, onBadgeUpdate }: Props) {
  const [loading, setLoading] = useState(true);
  const [family, setFamily] = useState<FamilyInfo | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [invitations, setInvitations] = useState<FamilyInvitation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [createName, setCreateName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [inviteUsername, setInviteUsername] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  const [respondingId, setRespondingId] = useState<number | null>(null);

  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [dissolving, setDissolving] = useState(false);
  const [dissolveError, setDissolveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [familyData, invitationsData] = await Promise.all([
        fetchMyFamily(),
        fetchFamilyInvitations(),
      ]);
      setFamily(familyData);
      setInvitations(invitationsData);
      if (familyData) {
        const membersData = await fetchFamilyMembers();
        setMembers(membersData);
      } else {
        setMembers([]);
      }
      const pending = invitationsData.filter(inv => inv.status === 'pending').length;
      onBadgeUpdate(pending);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [onBadgeUpdate]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    const name = createName.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createFamily(name);
      setCreateName('');
      await load();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleInvite = async () => {
    const username = inviteUsername.trim().replace(/^@/, '');
    if (!username) return;
    setInviting(true);
    setInviteError(null);
    setInviteSuccess(null);
    try {
      await inviteToFamily(username);
      setInviteUsername('');
      setInviteSuccess(`Приглашение отправлено @${username}`);
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : String(e));
    } finally {
      setInviting(false);
    }
  };

  const handleAccept = async (id: number) => {
    setRespondingId(id);
    try {
      await acceptInvitation(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRespondingId(null);
    }
  };

  const handleDecline = async (id: number) => {
    setRespondingId(id);
    try {
      await declineInvitation(id);
      setInvitations(prev => {
        const updated = prev.filter(inv => inv.invitation_id !== id);
        const pending = updated.filter(inv => inv.status === 'pending').length;
        onBadgeUpdate(pending);
        return updated;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRespondingId(null);
    }
  };

  const handleLeave = async () => {
    if (!window.confirm('Покинуть семью? Ваши личные данные не пострадают.')) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      await leaveFamily();
      await load();
    } catch (e) {
      setLeaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setLeaving(false);
    }
  };

  const handleDissolve = async () => {
    if (!window.confirm(
      'Распустить семью? Все семейные счета, категории и история операций будут удалены. Личные данные участников не пострадают.',
    )) return;
    setDissolving(true);
    setDissolveError(null);
    try {
      await dissolveFamily();
      await load();
    } catch (e) {
      setDissolveError(e instanceof Error ? e.message : String(e));
    } finally {
      setDissolving(false);
    }
  };

  const isOwner = family ? family.created_by_user_id === user.user_id : false;
  const pendingInvitations = invitations.filter(inv => inv.status === 'pending');

  if (loading) {
    return (
      <>
        <h1 className="page-title">Семья</h1>
        <p style={{ color: 'var(--text-secondary)', padding: '8px 0' }}>Загрузка...</p>
      </>
    );
  }

  return (
    <>
      <h1 className="page-title">Семья</h1>

      {error && (
        <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginBottom: 16 }}>{error}</p>
      )}

      {/* ── No family ─────────────────────────────── */}
      {!family && (
        <>
          {pendingInvitations.length > 0 && (
            <section className="settings-section">
              <h2 className="settings-section__title">Приглашения</h2>
              <div className="panel">
                <ul>
                  {pendingInvitations.map((inv) => (
                    <li key={inv.invitation_id} className="settings-row">
                      <div>
                        <div className="settings-row__title">{inv.family_name}</div>
                        <div className="settings-row__sub">
                          {inv.invited_by_username
                            ? `от @${inv.invited_by_username}`
                            : `от ID ${inv.invited_by_user_id}`}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                        <button
                          className="btn"
                          type="button"
                          disabled={respondingId === inv.invitation_id}
                          onClick={() => handleDecline(inv.invitation_id)}
                        >
                          Отклонить
                        </button>
                        <button
                          className="btn btn--primary"
                          type="button"
                          disabled={respondingId === inv.invitation_id}
                          onClick={() => handleAccept(inv.invitation_id)}
                        >
                          {respondingId === inv.invitation_id ? '...' : 'Принять'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          <section className="settings-section">
            <h2 className="settings-section__title">Создать семью</h2>
            <div className="panel">
              <p className="settings-label">
                Создайте семейную группу, чтобы вести совместный бюджет с другими участниками.
              </p>
              <div className="form-row" style={{ marginTop: 12 }}>
                <input
                  className="input"
                  type="text"
                  placeholder="Название семьи"
                  value={createName}
                  maxLength={64}
                  onChange={(e) => setCreateName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                />
                <button
                  className="btn btn--primary"
                  type="button"
                  disabled={creating || !createName.trim()}
                  onClick={handleCreate}
                >
                  {creating ? '...' : 'Создать'}
                </button>
              </div>
              {createError && (
                <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 8 }}>
                  {createError}
                </p>
              )}
              {pendingInvitations.length === 0 && (
                <p className="settings-label" style={{ marginTop: 12 }}>
                  Или дождитесь приглашения от другого участника.
                </p>
              )}
            </div>
          </section>
        </>
      )}

      {/* ── Has family ────────────────────────────── */}
      {family && (
        <>
          <section className="settings-section">
            <h2 className="settings-section__title">Ваша семья</h2>
            <div className="panel">
              <ul>
                <li className="settings-row">
                  <div>
                    <div className="settings-row__title">{family.name}</div>
                    <div className="settings-row__sub">Название семейной группы</div>
                  </div>
                </li>
                <li className="settings-row">
                  <div>
                    <div className="settings-row__title">Базовая валюта</div>
                    <div className="settings-row__sub">Валюта семейного бюджета</div>
                  </div>
                  <span className="pill">{family.base_currency_code}</span>
                </li>
                <li className="settings-row">
                  <div>
                    <div className="settings-row__title">Ваша роль</div>
                  </div>
                  <span className={`tag ${isOwner ? 'tag--in' : 'tag--neutral'}`}>
                    {isOwner ? 'Владелец' : 'Участник'}
                  </span>
                </li>
              </ul>
            </div>
          </section>

          <section className="settings-section">
            <h2 className="settings-section__title">Участники</h2>
            <div className="panel">
              {members.length === 0 ? (
                <p className="settings-label">Участников пока нет.</p>
              ) : (
                <ul>
                  {members.map((m) => (
                    <li key={m.user_id} className="settings-row">
                      <div>
                        <div className="settings-row__title">{memberDisplayName(m)}</div>
                        {m.username && (
                          <div className="settings-row__sub">@{m.username}</div>
                        )}
                      </div>
                      <span className={`tag ${m.role === 'owner' ? 'tag--in' : 'tag--neutral'}`}>
                        {m.role === 'owner' ? 'Владелец' : 'Участник'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {isOwner && (
            <section className="settings-section">
              <h2 className="settings-section__title">Пригласить участника</h2>
              <div className="panel">
                <p className="settings-label">Введите @username участника в Telegram.</p>
                <div className="form-row" style={{ marginTop: 12 }}>
                  <input
                    className="input"
                    type="text"
                    placeholder="@username"
                    value={inviteUsername}
                    onChange={(e) => setInviteUsername(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                  />
                  <button
                    className="btn btn--primary"
                    type="button"
                    disabled={inviting || !inviteUsername.trim()}
                    onClick={handleInvite}
                  >
                    {inviting ? '...' : 'Пригласить'}
                  </button>
                </div>
                {inviteError && (
                  <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginTop: 8 }}>
                    {inviteError}
                  </p>
                )}
                {inviteSuccess && (
                  <p style={{ color: 'var(--tag-in-fg)', fontSize: '0.85rem', marginTop: 8 }}>
                    {inviteSuccess}
                  </p>
                )}
              </div>
            </section>
          )}

          <section className="settings-section">
            <h2 className="settings-section__title">Опасная зона</h2>
            <div className="panel">
              {!isOwner && (
                <div className="settings-danger">
                  <div>
                    <div className="settings-row__title">Покинуть семью</div>
                    <div className="settings-row__sub">
                      Вы выйдете из семьи. Ваши личные счета и данные останутся нетронутыми.
                    </div>
                    {leaveError && (
                      <div className="settings-danger__error">{leaveError}</div>
                    )}
                  </div>
                  <button
                    className="btn btn--danger"
                    type="button"
                    disabled={leaving}
                    onClick={handleLeave}
                  >
                    {leaving ? 'Выходим...' : 'Покинуть'}
                  </button>
                </div>
              )}
              {isOwner && (
                <div className="settings-danger">
                  <div>
                    <div className="settings-row__title">Распустить семью</div>
                    <div className="settings-row__sub">
                      Все семейные счета, категории и история операций будут удалены безвозвратно. Личные данные участников не пострадают.
                    </div>
                    {dissolveError && (
                      <div className="settings-danger__error">{dissolveError}</div>
                    )}
                  </div>
                  <button
                    className="btn btn--danger"
                    type="button"
                    disabled={dissolving}
                    onClick={handleDissolve}
                  >
                    {dissolving ? 'Удаляем...' : 'Распустить'}
                  </button>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
