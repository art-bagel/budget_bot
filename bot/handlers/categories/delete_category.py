from aiogram import F, Router
from aiogram.types import Message, ReplyKeyboardRemove
from aiogram.fsm.context import FSMContext
from aiogram.filters import Command
from aiogram.fsm.state import StatesGroup, State, default_state

from keyboards.menu import main
from keyboards.builder import make_column_keyboard
from config import postgres_conn
from database_tools.categories import Categories
from database_tools.transactions import Transactions
from filters.category_name import CategoryNameFilter


router = Router()
db_categories = Categories(postgres_conn)
db_transactions = Transactions(postgres_conn)


class DeleteCategories(StatesGroup):
    choosing_delete_category_name = State()
    choosing_transfer_category_balance = State()
    choosing_repeat_delete = State()


@router.message(default_state, Command("delete_category"))
@router.message(default_state, F.text.lower() == "удалить категорию")
async def handle_delete_category(message: Message, state: FSMContext):
    categories_names = db_categories.get_name_categories(message.from_user.id, None, True).keys()
    next_state = DeleteCategories.choosing_delete_category_name
    if categories_names:
        text = "Какую категорию будем удалять?"
        button = make_column_keyboard([[name] for name in categories_names])
    else:
        text = "Прежде чем удалять, надо что-то создать!"
        button = make_column_keyboard(main)
        next_state = default_state
    await message.answer(text=text, reply_markup=button)
    await state.set_state(next_state)


@router.message(DeleteCategories.choosing_delete_category_name,
                CategoryNameFilter(db_categories, is_income=None, is_active=True))
async def handle_delete_name_chosen(message: Message, state: FSMContext, category_id: int):
    balance = db_categories.get_one_category_balance(message.from_user.id, category_id)
    next_state = DeleteCategories.choosing_repeat_delete
    if balance <= 0:
        db_categories.delete_category(category_id, message.from_user.id)
        text = f"Мне тоже не нравилась эта категория. Давай удалим еще что-нибудь?"
        button = make_column_keyboard([["Да", "Нет"]])
    else:
        categories_names = list(db_categories.get_name_categories(message.from_user.id, False, True).keys())
        categories_names.remove(message.text.lower())
        text = f"В категории обнаружен остаток: {balance}. И куда его девать?"
        button = make_column_keyboard([[name] for name in categories_names])
        next_state = DeleteCategories.choosing_transfer_category_balance

    await state.update_data(delete_category_id=category_id)
    await message.answer(text=text, reply_markup=button)
    await state.set_state(next_state)


@router.message(DeleteCategories.choosing_transfer_category_balance,
                CategoryNameFilter(db_categories, is_income=False, is_active=True))
async def handle_transfer_balance_chosen(message: Message, state: FSMContext, category_id: int):
    user_data = await state.get_data()
    db_transactions.change_balance_between_categories(
        message.from_user.id, user_data['delete_category_id'], category_id, 'Перемещение из удаленной категории'
    )
    db_categories.delete_category(user_data['delete_category_id'], message.from_user.id)

    text = f"Баланс перемещен, категорию долой! А давай еще одну?"
    button = make_column_keyboard([["Да", "Нет"]])

    await message.answer(text=text, reply_markup=button)
    await state.set_state(DeleteCategories.choosing_repeat_delete)


@router.message(DeleteCategories.choosing_repeat_delete, F.text.in_(["Да", "Нет"]))
async def handle_delete_repeat_chosen(message: Message, state: FSMContext):
    await state.clear()
    if message.text.lower() == "да":
        await handle_delete_category(message, state)
    else:
        text = "Ну, как знаешь, мое дело предложить..."
        button = make_column_keyboard(main)
        await message.answer(text=text, reply_markup=button)
