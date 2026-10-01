import { useState } from 'react';
import { Gift } from 'lucide-react';
import { collectibleImageUrl, isSealedPack } from '../utils/collectibles';

// Item picture; a sealed pack is drawn as a foil pack, a missing picture as an icon.
export default function CollectibleImage({ metadata, className, packName }: {
  metadata?: Record<string, unknown>;
  className?: string;
  packName?: string;
}) {
  const url = collectibleImageUrl(metadata);
  const [failed, setFailed] = useState<string | null>(null);
  if (isSealedPack(metadata)) {
    return (
      <span className={`clx-pack ${className ?? ''}`} aria-hidden="true">
        <span className="clx-pack__mark">?</span>
        {packName && <span className="clx-pack__name">{packName}</span>}
      </span>
    );
  }
  return url && failed !== url
    ? <img className={className} src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(url)} />
    : <Gift className={className} aria-hidden="true" />;
}
