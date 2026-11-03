import { useEffect, useRef, useState } from 'react';
import { fetchTelegramGift, type TelegramGift } from '../api';
import { telegramGiftKey, telegramGiftSlug } from '../utils/telegramGift';

export type GiftLookupStatus = 'idle' | 'loading' | 'found' | 'missing';

// Looks a Telegram gift up on t.me once its collection and number are typed (500 ms pause).
// `onResult` gets the gift, or null when a gift found earlier is lost again. `known` is the
// pair already on record: it is not looked up until the user changes it.
export function useTelegramGiftLookup({ collection = '', number = '', known = '', onResult }: {
  collection?: string; number?: string; known?: string; onResult: (gift: TelegramGift | null) => void;
}) {
  const [status, setStatus] = useState<GiftLookupStatus>('idle');
  const lookedUp = useRef(known);
  const apply = useRef(onResult);
  apply.current = onResult;
  const key = telegramGiftKey(collection, number);
  useEffect(() => {
    if (!key) { setStatus('idle'); return; }
    // The canonical pair written back by a lookup must not trigger a second one.
    if (key === lookedUp.current) return;
    setStatus('loading');
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchTelegramGift(telegramGiftSlug(collection.trim()) ?? '', number.trim()).then((gift) => {
        if (cancelled) return;
        // Remember the canonical pair ("007" comes back as #7), so the write-back does not search again.
        lookedUp.current = telegramGiftKey(gift.collection, gift.number);
        apply.current(gift);
        setStatus('found');
      }).catch(() => {
        if (cancelled) return;
        if (lookedUp.current) { lookedUp.current = ''; apply.current(null); }
        setStatus('missing');
      });
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, collection, number]);
  return { status, reset: () => { lookedUp.current = ''; } };
}

export function giftLookupLabel(status: GiftLookupStatus, title: string): string {
  return status === 'loading' ? 'Ищем в Telegram…' : status === 'found' ? `Найден ${title}` : 'В Telegram не найден, заполните вручную';
}
