import { useMemo, useState } from 'react';
import CollectibleImage from './CollectibleImage';
import type { PortfolioPosition } from '../types';
import { COLLECTIBLE_KINDS, collectibleAttributeRows, collectibleNumber, collectibleShelf, getCollectibleKind, isSealedPack, splitRarity } from '../utils/collectibles';
import { currencySymbol, formatNumericAmount, pluralRu } from '../utils/format';

const COLLAPSED_TILES = 6;

function costLabel(position: PortfolioPosition): string {
  if (position.metadata?.acquisition_kind === 'unknown') return 'цена неизвестна';
  if (position.metadata?.acquisition_kind === 'free') return 'бесплатно';
  return `${formatNumericAmount(position.amount_in_currency, 0)} ${currencySymbol(position.currency_code)}`;
}

// Items of one collection account as a showcase: kinds as tabs, sealed packs first, then a shelf per collection.
export default function CollectionShelf({ positions, onOpen }: { positions: PortfolioPosition[]; onOpen: (id: number) => void }) {
  const kinds = useMemo(() => COLLECTIBLE_KINDS
    .map((kind) => ({ ...kind, items: positions.filter((p) => (p.metadata?.item_kind ?? 'other') === kind.value) }))
    .filter((kind) => kind.items.length > 0), [positions]);
  const [kindValue, setKindValue] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const kind = kinds.find((k) => k.value === kindValue) ?? kinds[0];

  const { packs, shelves } = useMemo(() => {
    const items = kind?.items ?? [];
    const byShelf = new Map<string, PortfolioPosition[]>();
    for (const item of items) {
      if (isSealedPack(item.metadata)) continue;
      const name = collectibleShelf(item.metadata, item.title);
      byShelf.set(name, [...(byShelf.get(name) ?? []), item]);
    }
    const shelves = [...byShelf].filter(([, list]) => list.length > 1).map(([name, list]) => ({
      name,
      items: list.sort((a, b) => b.amount_in_currency - a.amount_in_currency),
      mixed: false,
    })).sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name, 'ru'));
    // One-item collections share a shelf instead of taking a row each.
    const singles = [...byShelf].filter(([, list]) => list.length === 1)
      .sort(([a], [b]) => a.localeCompare(b, 'ru')).map(([, list]) => list[0]);
    if (singles.length > 0) {
      shelves.push({ name: shelves.length > 0 ? 'Другие коллекции' : 'Коллекции', items: singles, mixed: true });
    }
    return { packs: items.filter((item) => isSealedPack(item.metadata)), shelves };
  }, [kind]);

  if (!kind) return null;

  const tile = (item: PortfolioPosition, shelfName: string | null) => {
    const number = collectibleNumber(item.metadata);
    const caption = shelfName === null ? collectibleShelf(item.metadata, item.title)
      : number ? `#${number}` : item.title !== shelfName ? item.title : null;
    const quantity = Number(item.quantity ?? 1);
    return (
      <button key={item.id} type="button" className="clx-tile" onClick={() => onOpen(item.id)}
        aria-label={`${item.title}, ${costLabel(item)}`}>
        <span className="clx-tile__art">
          <CollectibleImage metadata={item.metadata} className="clx-tile__img" />
          {quantity > 1 && <span className="clx-tile__qty">×{formatNumericAmount(quantity, 0)}</span>}
        </span>
        {caption && <span className="clx-tile__cap">{caption}</span>}
        <span className={`clx-tile__sub${item.metadata?.acquisition_kind === 'unknown' ? ' clx-tile__sub--unknown' : ''}`}>{costLabel(item)}</span>
      </button>
    );
  };

  return (
    <div className="clx">
      {kinds.length > 1 && (
        <div className="clx-kinds" role="tablist" aria-label="Вид предметов">
          {kinds.map((k) => (
            <button key={k.value} type="button" role="tab" aria-selected={k === kind}
              className={`op-filter__chip${k === kind ? ' op-filter__chip--active' : ''}`}
              onClick={() => setKindValue(k.value)}>
              {k.plural}<span className="clx-kinds__count">{k.items.length}</span>
            </button>
          ))}
        </div>
      )}

      {packs.length > 0 && (
        <section className="clx-shelf">
          <div className="clx-shelf__head">
            <span className="clx-shelf__name">Неоткрытые паки</span>
            <span className="clx-shelf__count">{packs.length}</span>
          </div>
          <div className="clx-packs">
            {packs.map((pack) => {
              const name = collectibleShelf(pack.metadata, pack.title);
              return (
                <button key={pack.id} type="button" className="clx-packtile" onClick={() => onOpen(pack.id)}
                  aria-label={`Неоткрытый пак ${name}, ${costLabel(pack)}`}>
                  <CollectibleImage metadata={pack.metadata} packName={name} className="clx-packtile__art" />
                  <span className="clx-tile__sub">{costLabel(pack)}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {shelves.map((shelf) => {
        const open = expanded.has(shelf.name) || shelf.items.length <= COLLAPSED_TILES;
        const visible = open ? shelf.items : shelf.items.slice(0, COLLAPSED_TILES - 1);
        return (
          <section className="clx-shelf" key={shelf.name}>
            <div className="clx-shelf__head">
              <span className="clx-shelf__name">{shelf.name}</span>
              <span className="clx-shelf__count">{shelf.items.length}</span>
              {expanded.has(shelf.name) && (
                <button type="button" className="clx-shelf__toggle" onClick={() => setExpanded((prev) => {
                  const next = new Set(prev);
                  next.delete(shelf.name);
                  return next;
                })}>Свернуть</button>
              )}
            </div>
            <div className="clx-grid">
              {visible.map((item) => tile(item, shelf.mixed ? null : shelf.name))}
              {!open && (
                <button type="button" className="clx-tile clx-tile--more"
                  onClick={() => setExpanded((prev) => new Set(prev).add(shelf.name))}
                  aria-label={`Показать все ${shelf.items.length} ${pluralRu(shelf.items.length, ['предмет', 'предмета', 'предметов'])}`}>
                  <span className="clx-tile__art clx-tile__art--more">+{shelf.items.length - visible.length}</span>
                  <span className="clx-tile__cap">Показать все</span>
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

const HERO_SKIP = new Set(['Коллекция', 'Номер']);

// Top of an item card: the picture at full width, its collection and number, then traits.
export function CollectibleHero({ position }: { position: PortfolioPosition }) {
  const sealed = isSealedPack(position.metadata);
  const shelf = collectibleShelf(position.metadata, position.title);
  const number = collectibleNumber(position.metadata);
  const kindLabel = sealed ? 'Неоткрытый пак' : getCollectibleKind(position.metadata?.item_kind)?.label ?? 'Предмет';
  const traits = collectibleAttributeRows(position.metadata).filter((row) => !HERO_SKIP.has(row.label));
  return (
    <div className="clx-hero">
      <div className={`clx-hero__art${sealed ? ' clx-hero__art--pack' : ''}`}>
        <CollectibleImage metadata={position.metadata} packName={shelf} className="clx-hero__img" />
      </div>
      <div className="clx-hero__tags">
        <span className="clx-hero__tag">{kindLabel}</span>
        {shelf !== position.title && <span className="clx-hero__tag">{shelf}</span>}
        {number && !position.title.includes(`#${number}`) && <span className="clx-hero__tag">#{number}</span>}
      </div>
      {sealed && <p className="clx-hero__note">Какой стикер внутри, станет известно после открытия.</p>}
      {traits.length > 0 && (
        <div className="clx-traits">
          {traits.map((row) => {
            const { name, rarity } = splitRarity(row.value);
            return (
              <div className="clx-trait" key={row.label}>
                <span className="clx-trait__label">{row.label}</span>
                <span className="clx-trait__value">{name}</span>
                {rarity && <span className="clx-trait__rarity">{rarity}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
