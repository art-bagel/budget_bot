import { getCryptoIconUrl } from '../utils/cryptoAssets';

/** Одна монета — обычный размер; две или три — мельче и внахлёст. */
export function CoinStack({ symbols }: { symbols: readonly string[] }) {
  const size = symbols.length <= 1 ? 36 : symbols.length === 2 ? 26 : 22;
  return (
    <span className="coin-stack" style={{ display: 'inline-flex', flexShrink: 0 }}>
      {symbols.map((symbol, i) => {
        const url = getCryptoIconUrl(symbol);
        const style = { width: size, height: size, borderRadius: '50%', marginLeft: i ? -size * 0.35 : 0, boxShadow: i ? '0 0 0 2px var(--surface)' : undefined };
        return url
          ? <img key={symbol} src={url} alt="" loading="lazy" style={{ ...style, objectFit: 'cover' }} />
          : <span key={symbol} className="pf-pos__icon pf-pos__icon--crypto" style={{ ...style, fontSize: size * 0.4 }}>{symbol.slice(0, 1).toUpperCase()}</span>;
      })}
    </span>
  );
}
