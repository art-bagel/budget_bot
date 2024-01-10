from aiogram import F, Router
from aiogram.types import Message
from aiogram.fsm.context import FSMContext
from aiogram.filters import Command
from aiogram.fsm.state import StatesGroup, State, default_state

from keyboards.menu import main, categories
from keyboards.builder import make_column_keyboard
from config import postgres_conn
from database_tools.categories import Categories
from database_tools.transactions import Transactions
from filters.category_name import CategoryNameFilter

router = Router()

db_categories = Categories(postgres_conn)
db_transactions = Transactions(postgres_conn)


class BetweenCategories(StatesGroup):
    choosing_category_from = State()
    choosing_change_amount = State()
    choosing_category_to = State()


@router.message(default_state, Command("between_categories"))
@router.message(default_state, F.text.lower() == "между счетами")
async def handle_between_categories(message: Message, state: FSMContext):
    categories_names = db_categories.get_name_categories(
        message.from_user.id, is_income=False, is_active=True, is_group=False).keys()
    text = "Откуда переведем"
    button = make_column_keyboard([[name] for name in categories_names])
    next_state = BetweenCategories.choosing_category_from
    if not categories_names:
        text = "Хорошо бы для начала добавить категории"
        button = make_column_keyboard(categories)
        next_state = default_state
    await message.answer(text=text, reply_markup=button)
    await state.set_state(next_state)


@router.message(BetweenCategories.choosing_category_from,
                CategoryNameFilter(db_categories, is_income=False, is_active=True, is_group=False))
async def handle_category_from_chosen(message: Message, state: FSMContext, category_id: int):
    categories_names = db_categories.get_name_categories(
        message.from_user.id, is_income=False, is_active=True, is_group=False, exclude=(category_id,)).keys()
    text = "На какую категорию Перевести?"
    button = make_column_keyboard([[name] for name in categories_names])

    await state.update_data(id_category_from=category_id)
    await message.answer(text=text, reply_markup=button)
    await state.set_state(BetweenCategories.choosing_category_to)


@router.message(BetweenCategories.choosing_category_to,
                CategoryNameFilter(db_categories, is_income=False, is_active=True, is_group=False))
async def handle_category_to_chosen(message: Message, state: FSMContext, category_id: int):
    text = ("Введи сумму перевода в формате 100 или 100.05. "
            "Если нужно указать описание к операции дополни его через пробел")
    button = make_column_keyboard([["Отмена"]])

    await state.update_data(id_category_to=category_id)
    await message.answer(text=text, reply_markup=button)
    await state.set_state(BetweenCategories.choosing_change_amount)


@router.message(BetweenCategories.choosing_change_amount)
async def handle_change_amount_chosen(message: Message, state: FSMContext):
    text = "Операция прошла успешно"
    try:
        msg = message.text.split(" ", 1)
        amount = float(msg[0].replace(",", '.'))
        description = msg[1] if len(msg) > 1 else ""
        user_data = await state.get_data()
        db_transactions.create_transaction(
            message.from_user.id, user_data["id_category_from"], amount, user_data["id_category_to"], description
        )
        button = make_column_keyboard(main)
        await state.clear()
    except ValueError:
        text = ("Не могу распознать введенное число. "
                "Пожалуйста, используй формат числа 100 или 100.05")
        button = make_column_keyboard([["Отмена"]])
    await message.answer(text=text, reply_markup=button)
