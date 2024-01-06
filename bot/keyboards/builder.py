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


def make_column_keyboard(items: Optional[list[list[str]]] = None, default: bool = True) -> ReplyKeyboardMarkup:
    """
    Создаёт реплай-клавиатуру с кнопками в один ряд
    :param items: список списков текстов для кнопок
    :param default: использовать кнопки по умолчанию или нет
    :return: объект реплай-клавиатуры
    """
    default_row = ["Отмена"]

    column = []
    for row_items in items:
        row = []
        for item in row_items:
            row.append(KeyboardButton(text=item))
        column.append(row)

    # if default and default_row not in column:
    #     column.append(default_row)

    return ReplyKeyboardMarkup(keyboard=column, resize_keyboard=True)
