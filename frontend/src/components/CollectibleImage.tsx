import { useState } from 'react';
import { Gift } from 'lucide-react';
import { collectibleImageUrls, isSealedPack } from '../utils/collectibles';

// Item picture; a sealed pack is drawn as a foil pack, a missing picture as an icon.
// Candidates are tried in order: one that fails to load gives way to the next.
export default function CollectibleImage({ metadata, className, packName }: {
  metadata?: Record<string, unknown>;
  className?: string;
  packName?: string;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const url = collectibleImageUrls(metadata).find((candidate) => !failed.includes(candidate));
  if (isSealedPack(metadata)) {
    return (
      <span className={`clx-pack ${className ?? ''}`} aria-hidden="true">
        <span className="clx-pack__mark">?</span>
        {packName && <span className="clx-pack__name">{packName}</span>}
      </span>
    );
  }
  if (!url) return <Gift className={className} aria-hidden="true" />;
  const skip = () => setFailed((prev) => [...prev, url]);
  if (/\.(mp4|webm)$/i.test(url.split(/[?#]/)[0])) {
    return <video key={url} className={className} src={url} autoPlay loop muted playsInline
      preload="metadata" aria-hidden="true" onError={skip} />;
  }
  return <img key={url} className={className} src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={skip} />;
}
