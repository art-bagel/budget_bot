from aiogram import F, Router
from aiogram.types import Message, ReplyKeyboardRemove
from aiogram.fsm.context import FSMContext
from aiogram.filters import Command
from aiogram.fsm.state import StatesGroup, State, default_state

from keyboards.menu import main
from keyboards.builder import make_column_keyboard
from config import postgres_conn
from database_tools.categories import Categories

router = Router()


class NewCategories(StatesGroup):
    choosing_category_name = State()
    choosing_category_is_income = State()
    choosing_category_repeat = State()


@router.message(default_state, Command("create_category"))
@router.message(default_state, F.text.lower() == "создать категорию")
async def handle_create_category(message: Message, state: FSMContext):
    text = "Придумай имя новой категории"
    button = make_column_keyboard([["Отмена"]])
    await message.answer(text=text, reply_markup=button)
    await state.set_state(NewCategories.choosing_category_name)


@router.message(NewCategories.choosing_category_name)
async def handle_category_name_chosen(message: Message, state: FSMContext):
    text = "Является ли эта категория доходом?"
    button = make_column_keyboard([["Да", "Нет"], ["Отмена"]])

    await state.update_data(category_name=message.text)
    await message.answer(text=text, reply_markup=button)
    await state.set_state(NewCategories.choosing_category_is_income)


@router.message(NewCategories.choosing_category_is_income, F.text.in_(["Да", "Нет"]))
async def handle_category_is_income_chosen(message: Message, state: FSMContext):
    text = "Категория создана. Забабахаем еще одну?"
    button = make_column_keyboard([["Да", "Нет"]])
    user_data = await state.get_data()
    is_income = True if message.text.lower() == "да" else False

    db = Categories(postgres_conn)
    db.create_category(message.from_user.id, user_data["category_name"], is_income)

    await message.answer(text=text, reply_markup=button)
    await state.set_state(NewCategories.choosing_category_repeat)


@router.message(NewCategories.choosing_category_repeat, F.text.in_(["Да", "Нет"]))
async def handle_create_category_repeat_chosen(message: Message, state: FSMContext):
    await state.clear()
    if message.text.lower() == "да":
        await handle_create_category(message, state)
    else:
        text = "Хозяин — барин"
        button = make_column_keyboard(main)
        await message.answer(text=text, reply_markup=button)
