#!/usr/bin/env python3
"""
Ищет прямые hex-цвета в styles.css вне блоков определения токенов.

Токены живут в правилах, чей селектор целиком — :root, [data-theme=…] или
:root:not([data-theme=…]) (в т.ч. внутри @media (prefers-color-scheme…)).
Всё остальное должно ссылаться на var(--…). Старых нарушений много, поэтому
сравнение идёт с baseline: падаем только на парах «селектор → цвет» сверх него.
Номера строк в baseline не хранятся — иначе он ломался бы от любой правки выше.

    check_css_hex.py                    проверить
    check_css_hex.py --update-baseline  переписать baseline текущим состоянием
    check_css_hex.py --self-test        проверить сам парсер
"""

import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / 'frontend/src/styles.css'
BASELINE = ROOT / 'scripts/css-hex-baseline.txt'

HEX = re.compile(r'#[0-9a-fA-F]{3,8}\b')
TOKEN_SELECTOR = re.compile(r':root|\[data-theme=[^\]]+\]|:root:not\(\[data-theme=[^\]]+\]\)')


def is_token_block(selector: str) -> bool:
    return all(TOKEN_SELECTOR.fullmatch(part.strip()) for part in selector.split(','))


def find_violations(css: str) -> list[tuple[int, str, str]]:
    """
    :return: [(строка, селектор, цвет)] для hex вне токен-блоков.
    """
    css = re.sub(r'/\*.*?\*/', lambda m: re.sub(r'[^\n]', ' ', m.group()), css, flags=re.S)
    found = []
    stack: list[str] = []  # селекторы/at-правила открытых блоков
    start = 0  # начало текущего фрагмента (прелюдия или объявления)
    for i, ch in enumerate(css):
        if ch not in '{};':
            continue
        chunk = css[start:i]
        if ch == '{':
            stack.append(' '.join(chunk.split()))
        elif stack and not stack[-1].startswith('@') and not is_token_block(stack[-1]):
            for m in HEX.finditer(chunk):
                line = css.count('\n', 0, start + m.start()) + 1
                found.append((line, stack[-1], m.group().lower()))
        if ch == '}' and stack:
            stack.pop()
        start = i + 1
    return found


def key(selector: str, color: str) -> str:
    return f'{selector}\t{color}'


def read_baseline() -> Counter:
    if not BASELINE.exists():
        return Counter()
    return Counter(line for line in BASELINE.read_text().splitlines() if line and not line.startswith('#'))


def self_test() -> None:
    css = """
    :root { --a: #fff; }
    [data-theme="dark"] { --a: #000; }
    @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --a: #111; } }
    /* .x { color: #222; } */
    .btn { color: #ABC; background: var(--a); }
    [data-theme='dark'] .btn { color: #123456; }
    #id { color: var(--a); }
    """
    got = [(sel, color) for _, sel, color in find_violations(css)]
    assert got == [('.btn', '#abc'), ("[data-theme='dark'] .btn", '#123456')], got
    print('check_css_hex: self-test ok')


def main() -> int:
    if '--self-test' in sys.argv:
        self_test()
        return 0
    violations = find_violations(CSS.read_text())
    current = Counter(key(sel, color) for _, sel, color in violations)
    if '--update-baseline' in sys.argv:
        header = '# Прямые hex-цвета в styles.css вне токенов (селектор<TAB>цвет). Новые сюда не добавлять.\n'
        BASELINE.write_text(header + ''.join(f'{k}\n' for k in sorted(current.elements())))
        print(f'check_css_hex: baseline обновлён, {sum(current.values())} шт.')
        return 0
    baseline = read_baseline()
    new = current - baseline
    if new:
        print('check_css_hex: новые hex-цвета вне токенов — используйте var(--…) из :root:')
        for line, sel, color in violations:
            if new[key(sel, color)] > 0:
                new[key(sel, color)] -= 1
                print(f'  styles.css:{line}  {sel}  {color}')
        return 1
    fixed = sum((baseline - current).values())
    if fixed:
        print(f'check_css_hex: исправлено {fixed} старых — обновите baseline: scripts/check_css_hex.py --update-baseline')
    print(f'check_css_hex: ok ({sum(current.values())} в baseline)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
