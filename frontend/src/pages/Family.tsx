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
} from '../api';

interface Props {
  user: UserContext;
  onBadgeUpdate: (count: number) => void;
  embedded?: boolean;
  onFamilyChange?: (family: FamilyInfo | null) => void;
}

function memberDisplayName(m: FamilyMember): string {
  const full = [m.first_name, m.last_name].filter(Boolean).join(' ');
  if (full) return full;
  if (m.username) return `@${m.username}`;
  return 'Пользователь';
}

export default function Family({ user, onBadgeUpdate, embedded = false, onFamilyChange }: Props) {
  const [loading, setLoading] = useState(true);
  const [family, setFamily] = useState<FamilyInfo | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [invitations, setInvitations] = useState<FamilyInvitation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [inviteUsername, setInviteUsername] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  const [respondingId, setRespondingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [familyData, invitationsData] = await Promise.all([
        fetchMyFamily(),
        fetchFamilyInvitations(),
      ]);
      setFamily(familyData);
      onFamilyChange?.(familyData);
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
  }, [onBadgeUpdate, onFamilyChange]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      await createFamily();
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

  const isOwner = family ? family.created_by_user_id === user.user_id : false;
  const pendingInvitations = invitations.filter(inv => inv.status === 'pending');

  if (loading) {
    return (
      <>
        {!embedded ? <h1 className="page-title">Семья</h1> : null}
        <p style={{ color: 'var(--text-secondary)', padding: '8px 0' }}>Загрузка...</p>
      </>
    );
  }

  return (
    <>
      {!embedded ? <h1 className="page-title">Семья</h1> : null}

      {error && (
        <p style={{ color: 'var(--tag-out-fg)', fontSize: '0.85rem', marginBottom: 16 }}>{error}</p>
      )}

      {/* ── No family ─────────────────────────────── */}
      {!family && (
        <>
          {pendingInvitations.length > 0 && (
            <div className="panel">
              <ul>
                {pendingInvitations.map((inv) => (
                  <li key={inv.invitation_id} className="settings-row">
                    <div>
                      <div className="settings-row__title">{inv.family_name}</div>
                      <div className="settings-row__sub">
                        {inv.invited_by_username
                          ? `от @${inv.invited_by_username}`
                          : 'Приглашение в семью'}
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
          )}

          <div className="panel">
            <p className="settings-label">
              Создайте семейную группу, чтобы вести совместный бюджет с другими участниками.
            </p>
            <p className="settings-label" style={{ marginTop: 8 }}>
              Имя создаётся автоматически как «Моя семья».
            </p>
            <div className="form-row" style={{ marginTop: 12 }}>
              <button
                className="btn btn--primary"
                type="button"
                disabled={creating}
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
        </>
      )}

      {/* ── Has family ────────────────────────────── */}
      {family && (
        <>
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

            {isOwner && (
              <>
                <p className="settings-label" style={{ marginTop: members.length > 0 ? 16 : 0 }}>
                  Введите @username участника в Telegram.
                </p>
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
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
