const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  { label: 'Еда', emojis: ['🛒', '🍕', '🍔', '🥗', '🍎', '☕', '🍷', '🥩', '🍰', '🧁', '🥦', '🐟'] },
  { label: 'Дом', emojis: ['🏠', '💡', '🔧', '🛋️', '🪴', '🔑', '🧹', '🛁', '🪟', '📦'] },
  { label: 'Транспорт', emojis: ['🚗', '🚌', '🚇', '✈️', '🚲', '⛽', '🛵', '🚕', '🚢'] },
  { label: 'Здоровье', emojis: ['💊', '🏥', '🏋️', '💆', '🧘', '🩺', '🦷', '👓', '🩹'] },
  { label: 'Развлечения', emojis: ['🎬', '🎮', '🎵', '📚', '🎭', '🎲', '🏖️', '🎯', '🎸'] },
  { label: 'Одежда', emojis: ['👗', '👕', '👟', '🧥', '👜', '💄', '👒', '🧣'] },
  { label: 'Финансы', emojis: ['💰', '💳', '🏦', '📊', '💼', '📈', '🎁', '💸'] },
  { label: 'Дети', emojis: ['🧒', '🎒', '🖍️', '🧸', '🎠', '🎡', '🍭'] },
  { label: 'Питомцы', emojis: ['🐱', '🐶', '🐠', '🐇', '🐾'] },
  { label: 'Прочее', emojis: ['⭐', '🌿', '🔖', '🌐', '📱', '🖥️', '✂️', '🧴', '🕯️', '🪑'] },
];

interface Props {
  selected: string | null;
  onSelect: (emoji: string | null) => void;
}

export default function EmojiPicker({ selected, onSelect }: Props) {
  return (
    <div className="emoji-picker">
      {EMOJI_GROUPS.map((group) => (
        <div key={group.label} className="emoji-picker__group">
          <div className="emoji-picker__group-label">{group.label}</div>
          <div className="emoji-picker__grid">
            {group.emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={['emoji-picker__item', selected === emoji ? 'emoji-picker__item--active' : ''].filter(Boolean).join(' ')}
                onClick={() => onSelect(selected === emoji ? null : emoji)}
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
