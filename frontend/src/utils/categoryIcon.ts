const EMOJI_PREFIX_RE = /^(\p{Extended_Pictographic})\s*/u;
const SVG_CODE_PREFIX_RE = /^\[([a-z_]+)\]\s*/;

export type ParsedIcon =
  | { icon: string; kind: 'emoji'; displayName: string }
  | { icon: string; kind: 'svg'; displayName: string }
  | { icon: null; kind: null; displayName: string };

export function parseCategoryIcon(name: string): ParsedIcon {
  const svgMatch = name.match(SVG_CODE_PREFIX_RE);
  if (svgMatch) {
    return { icon: svgMatch[1], kind: 'svg', displayName: name.slice(svgMatch[0].length).trim() };
  }

  const emojiMatch = name.match(EMOJI_PREFIX_RE);
  if (emojiMatch) {
    return { icon: emojiMatch[1], kind: 'emoji', displayName: name.slice(emojiMatch[0].length).trim() };
  }

  return { icon: null, kind: null, displayName: name };
}

export function categoryDisplayName(name: string): string {
  return parseCategoryIcon(name).displayName;
}

export function buildCategoryName(icon: string | null, displayName: string): string {
  const trimmed = displayName.trim();
  if (!icon) return trimmed;
  // If it looks like an emoji char, store as prefix; otherwise it's an SVG code
  if (/\p{Extended_Pictographic}/u.test(icon)) return `${icon} ${trimmed}`;
  return `[${icon}] ${trimmed}`;
}
