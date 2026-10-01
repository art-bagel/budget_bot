import { useState } from 'react';
import { Gift } from 'lucide-react';
import { collectibleImageUrl } from '../utils/collectibles';

export default function CollectibleImage({ metadata, className }: { metadata?: Record<string, unknown>; className?: string }) {
  const url = collectibleImageUrl(metadata);
  const [failed, setFailed] = useState<string | null>(null);
  return url && failed !== url
    ? <img className={className} src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={{ objectFit: 'cover', borderRadius: 12 }} onError={() => setFailed(url)} />
    : <Gift className={className} aria-hidden="true" />;
}
