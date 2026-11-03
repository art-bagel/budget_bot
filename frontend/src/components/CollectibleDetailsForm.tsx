import { type FormEvent, Fragment, useState } from 'react';
import { editCollectibleDetails } from '../api';
import { useCryptoRequestKey } from '../hooks/useCryptoRequestKey';
import { giftLookupLabel, useTelegramGiftLookup } from '../hooks/useTelegramGiftLookup';
import type { PortfolioPosition } from '../types';
import { collectibleFlag, getCollectibleKind } from '../utils/collectibles';
import { telegramGiftKey, telegramGiftLink, telegramGiftTitle, telegramGiftTraits } from '../utils/telegramGift';

type Props = { position: PortfolioPosition; openingPack: boolean; onCancel: () => void; onSaved: () => Promise<void> };

// The card editor of a collectible. A Telegram gift whose collection or number changes is
// looked up on t.me and its traits are filled in, as in the new-position form.
export default function CollectibleDetailsForm({ position, openingPack, onCancel, onSaved }: Props) {
  const kind = getCollectibleKind(position.metadata?.item_kind);
  const isGift = position.metadata?.item_kind === 'telegram_gift';
  const stored = (position.metadata?.item_attributes ?? {}) as Record<string, string>;
  const [draft, setDraft] = useState(() => ({
    title: position.title,
    acquired_at: String(position.metadata?.acquired_at ?? ''),
    item_link: String(position.metadata?.item_link ?? ''),
    image_url: String(position.metadata?.image_url ?? ''),
    comment: position.comment ?? '',
    attributes: Object.fromEntries((kind?.fields ?? []).map((field) => [field.key, field.flag
      ? (collectibleFlag(position.metadata, field.key) && !(field.key === 'sealed' && openingPack) ? 'yes' : '')
      : String(stored[field.key] ?? '')])),
  }));
  const setField = (key: string, value: string) => setDraft((prev) => ({ ...prev, [key]: value }));
  const setAttribute = (key: string, value: string) => setDraft((prev) => ({ ...prev, attributes: { ...prev.attributes, [key]: value } }));
  const lookup = useTelegramGiftLookup({
    collection: isGift ? draft.attributes.collection : '', number: isGift ? draft.attributes.number : '',
    known: telegramGiftKey(stored.collection ?? '', stored.number ?? ''),
    onResult: (gift) => setDraft((prev) => ({ ...prev, item_link: gift?.link ?? '', image_url: gift?.image ?? '', attributes: { ...prev.attributes, ...telegramGiftTraits(gift) } })),
  });
  const request = useCryptoRequestKey('collectible-date');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const attributes = { ...stored };
    for (const field of kind?.fields ?? []) {
      const value = draft.attributes[field.key].trim();
      if (field.flag) attributes[field.key] = value ? 'yes' : 'no';
      else if (value) attributes[field.key] = value; else delete attributes[field.key];
    }
    // A t.me link follows the edited number; a link to anywhere else is the user's.
    const link = draft.item_link.trim();
    const giftLink = isGift && (!link || link.startsWith('https://t.me/nft/')) ? telegramGiftLink(attributes) : null;
    const details = {
      title: isGift ? telegramGiftTitle(attributes, position.title) : draft.title.trim(), comment: draft.comment.trim() || null,
      acquired_at: draft.acquired_at || null, item_kind: String(position.metadata?.item_kind ?? 'other'),
      item_link: giftLink ?? (link || null), image_url: draft.image_url.trim() || null, item_attributes: attributes,
    };
    setSaving(true); setError(null);
    try {
      await editCollectibleDetails(position.id, { ...details, request_id: request.requestId({ positionId: position.id, ...details }) });
      request.completed();
      await onSaved();
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };

  return (
    <form className="clx-editor" onSubmit={(event) => void submit(event)}>
      {!isGift && <label className="apf-label">Название<input className="apf-input" required maxLength={200} autoFocus={!openingPack} value={draft.title} onChange={(e) => setField('title', e.target.value)} /></label>}
      <label className="apf-label">Дата приобретения<input className="apf-input" type="date" value={draft.acquired_at} onChange={(e) => setField('acquired_at', e.target.value)} /></label>
      {(kind?.fields ?? []).map((field) => field.flag
        ? <label className="apf-check" key={field.key}><input type="checkbox" checked={draft.attributes[field.key] === 'yes'} onChange={(e) => setAttribute(field.key, e.target.checked ? 'yes' : '')} />{field.label}</label>
        : (
          <Fragment key={field.key}>
            <label className="apf-label">{field.label}<input className="apf-input" maxLength={200} autoFocus={field.key === 'number' && openingPack} value={draft.attributes[field.key]} onChange={(e) => setAttribute(field.key, e.target.value)} /></label>
            {isGift && field.key === 'number' && lookup.status !== 'idle' && <div className="apf-balance" role="status">{giftLookupLabel(lookup.status, telegramGiftTitle(draft.attributes, ''))}</div>}
          </Fragment>
        ))}
      <label className="apf-label">Ссылка на предмет<input className="apf-input" type="url" value={draft.item_link} onChange={(e) => setField('item_link', e.target.value)} /></label>
      <label className="apf-label">Ссылка на изображение или видео<input className="apf-input" type="url" value={draft.image_url} onChange={(e) => setField('image_url', e.target.value)} /></label>
      <label className="apf-label">Комментарий<textarea className="apf-input" maxLength={2000} value={draft.comment} onChange={(e) => setField('comment', e.target.value)} /></label>
      <div className="clx-edit-actions"><button type="button" className="sh-btn sh-btn--ghost" disabled={saving} onClick={onCancel}>Отмена</button><button type="submit" className="sh-btn sh-btn--primary" disabled={saving}>Сохранить</button></div>
      {error && <div className="apf-error">{error}</div>}
    </form>
  );
}
