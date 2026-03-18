const EMOJI_PREFIX_RE = /^(\p{Extended_Pictographic})\s*/u;

export function parseCategoryIcon(name: string): { icon: string | null; displayName: string } {
  const match = name.match(EMOJI_PREFIX_RE);
  if (match) {
    return { icon: match[1], displayName: name.slice(match[0].length).trim() };
  }
  return { icon: null, displayName: name };
}

export function buildCategoryName(icon: string | null, displayName: string): string {
  const trimmed = displayName.trim();
  return icon ? `${icon} ${trimmed}` : trimmed;
}
