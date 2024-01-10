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


class NewSpend(StatesGroup):
    choosing_spend_amount = State()
    choosing_spend_category = State()
    choosing_spend_repeat = State()


@router.message(default_state, Command("spend"))
@router.message(default_state, F.text.lower() == "потратить")
async def handle_create_spend(message: Message, state: FSMContext):
    text = ("Введи сумму расхода в формате 100 или 100.05. "
            "Если нужно указать описание к операции дополни его через пробел")
    button = make_column_keyboard([["Отмена"]])
    await message.answer(text=text, reply_markup=button)
    await state.set_state(NewSpend.choosing_spend_amount)


@router.message(NewSpend.choosing_spend_amount)
async def handle_spend_amount_chosen(message: Message, state: FSMContext):
    text = "Откуда списать деньги?"
    next_state = NewSpend.choosing_spend_category
    try:
        msg = message.text.split(" ", 1)
        amount = float(msg[0].replace(",", '.'))
        description = msg[1] if len(msg) > 1 else ""
        await state.update_data(spend_amount=amount, description=description)
        categories_names = db_categories.get_name_categories(
            message.from_user.id, is_income=False, is_active=True, is_group=False).keys()
        button = make_column_keyboard([[name] for name in categories_names])
        if not categories_names:
            text = "Хорошо бы для начала добавить категории, а потом тратить!"
            button = make_column_keyboard(categories)
            next_state = default_state
    except ValueError:
        text = ("Не могу распознать введенное число. "
                "Пожалуйста, используй формат числа 100 или 100.05")
        button = make_column_keyboard([["Отмена"]])
    await message.answer(text=text, reply_markup=button)
    await state.set_state(next_state)


@router.message(NewSpend.choosing_spend_category,
                CategoryNameFilter(db_categories, is_income=False, is_active=True, is_group=False))
async def handle_spend_category_chosen(message: Message, state: FSMContext, category_id: int):
    text = "Потрачено!"
    button = make_column_keyboard(main)
    user_data = await state.get_data()
    db_transactions.create_transaction(
        message.from_user.id, category_id, user_data["spend_amount"], descr=user_data["description"])

    await state.clear()
    await message.answer(text=text, reply_markup=button)
