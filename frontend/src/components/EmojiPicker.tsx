import { CATEGORY_SVG_ICON_GROUPS, CATEGORY_SVG_ICONS } from './CategorySvgIcon';

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  { label: 'Еда', emojis: ['🍕', '🍔', '🥗', '🍎', '☕', '🍷', '🥩', '🍰', '🧁', '🥦', '🐟', '🍭'] },
  { label: 'Дом', emojis: ['💡', '🛋️', '🪴', '🧹', '🛁', '🪟', '📦', '🕯️'] },
  { label: 'Транспорт', emojis: ['🚇', '⛽', '🛵', '🚢', '🛻'] },
  { label: 'Здоровье', emojis: ['🏥', '💆', '🧘', '🦷', '👓', '🩹'] },
  { label: 'Развлечения', emojis: ['🎭', '🎲', '🏖️', '🎸', '🎨', '📸'] },
  { label: 'Одежда', emojis: ['👗', '👕', '👟', '🧥', '👜', '💄', '👒', '🧣'] },
  { label: 'Финансы', emojis: ['💰', '💳', '🏦', '📊', '💼', '📈', '💸'] },
  { label: 'Дети', emojis: ['🎒', '🖍️', '🧸', '🎠', '🎡'] },
  { label: 'Питомцы', emojis: ['🐱', '🐶', '🐠', '🐇', '🐾'] },
  { label: 'Прочее', emojis: ['⭐', '🌿', '🔖', '🌐', '📱', '🖥️', '✂️', '🧴', '🎁'] },
];

interface Props {
  selected: string | null;
  onSelect: (icon: string | null) => void;
}

export default function EmojiPicker({ selected, onSelect }: Props) {
  const handleSelect = (icon: string) => {
    onSelect(selected === icon ? null : icon);
  };

  return (
    <div className="emoji-picker">
      {/* SVG icon groups */}
      {CATEGORY_SVG_ICON_GROUPS.map((group) => (
        <div key={group.label} className="emoji-picker__group">
          <div className="emoji-picker__group-label">{group.label}</div>
          <div className="emoji-picker__grid">
            {group.codes.map((code) => {
              const Icon = CATEGORY_SVG_ICONS[code];
              if (!Icon) return null;
              return (
                <button
                  key={code}
                  type="button"
                  className={['emoji-picker__item', 'emoji-picker__item--svg', selected === code ? 'emoji-picker__item--active' : ''].filter(Boolean).join(' ')}
                  onClick={() => handleSelect(code)}
                  aria-label={code}
                >
                  <Icon />
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Emoji groups */}
      {EMOJI_GROUPS.map((group) => (
        <div key={group.label} className="emoji-picker__group">
          <div className="emoji-picker__group-label">{group.label} ✦</div>
          <div className="emoji-picker__grid">
            {group.emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={['emoji-picker__item', selected === emoji ? 'emoji-picker__item--active' : ''].filter(Boolean).join(' ')}
                onClick={() => handleSelect(emoji)}
                aria-label={emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
