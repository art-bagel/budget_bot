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
# from handlers.categories.create_category import NewCategories

router = Router()

db_categories = Categories(postgres_conn)
db_transactions = Transactions(postgres_conn)


class NewIncomeByCategory(StatesGroup):
    choosing_income_from = State()
    choosing_income_to = State()
    choosing_income_amount = State()


@router.message(default_state, Command("income_by_category"))
@router.message(default_state, F.text.lower() == "пополнить категорию")
async def handle_income_by_category(message: Message, state: FSMContext):
    categories_names = db_categories.get_name_categories(
        message.from_user.id, is_income=True, is_active=True, is_group=False).keys()
    text = "Кто спонсирует?"
    button = make_column_keyboard([[name] for name in categories_names])
    next_state = NewIncomeByCategory.choosing_income_from
    if not categories_names:
        text = "Хорошо бы для начала добавить категорию дохода"
        button = make_column_keyboard(categories)
        next_state = default_state
    await message.answer(text=text, reply_markup=button)
    await state.set_state(next_state)


@router.message(NewIncomeByCategory.choosing_income_from,
                CategoryNameFilter(db_categories, is_income=True, is_active=True))
async def handle_income_from_chosen(message: Message, state: FSMContext, category_id: int):
    categories_names = db_categories.get_name_categories(
        message.from_user.id, is_income=False, is_active=True, is_group=False).keys()
    text = "На какую категорию закинем?"
    button = make_column_keyboard([[name] for name in categories_names])

    await state.update_data(id_category_from=category_id)
    await message.answer(text=text, reply_markup=button)
    await state.set_state(NewIncomeByCategory.choosing_income_to)


@router.message(NewIncomeByCategory.choosing_income_to,
                CategoryNameFilter(db_categories, is_income=False, is_active=True, is_group=False))
async def handle_income_to_chosen(message: Message, state: FSMContext, category_id: int):
    text = "Сколько закинем?"
    button = make_column_keyboard([["Отмена"]])
    await state.update_data(id_category_to=category_id)
    await message.answer(text=text, reply_markup=button)
    await state.set_state(NewIncomeByCategory.choosing_income_amount)


@router.message(NewIncomeByCategory.choosing_income_amount)
async def handle_income_amount_chosen(message: Message, state: FSMContext):
    text = "Сумма зачислена!"
    button = make_column_keyboard(main)
    amount = float(message.text)
    user_data = await state.get_data()
    db_transactions.create_transaction(
        message.from_user.id, user_data["id_category_from"], amount, user_data["id_category_to"])

    await state.clear()
    await message.answer(text=text, reply_markup=button)
