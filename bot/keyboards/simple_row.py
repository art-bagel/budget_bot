from typing import Optional

from aiogram.types import ReplyKeyboardMarkup, KeyboardButton


def make_row_keyboard(items: Optional[list[str]] = None, default: bool = True) -> ReplyKeyboardMarkup:
    """
    Создаёт реплай-клавиатуру с кнопками в один ряд
    :param items: список текстов для кнопок
    :param default: использовать кнопки по умолчанию или нет
    :return: объект реплай-клавиатуры
    """
    default_items = ["Отмена"]

    if not items:
        items = []
    if default:
        for di in default_items:
            if di not in items:
                items.append(di)

    row = [KeyboardButton(text=item) for item in items]
    return ReplyKeyboardMarkup(keyboard=[row], resize_keyboard=True)
