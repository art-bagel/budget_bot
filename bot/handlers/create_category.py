from aiogram import F, Router
from aiogram.types import Message, ReplyKeyboardRemove
from aiogram.fsm.context import FSMContext
from aiogram.filters import Command
from aiogram.fsm.state import StatesGroup, State, default_state

from keyboards.simple_row import make_row_keyboard
from config import postgres_conn
from database_tools.categories import Categories

router = Router()


class NewCategories(StatesGroup):
    choosing_category_name = State()
    choosing_category_is_income = State()
    choosing_category_repeat = State()


params = {
    "name":
        {"text": "Придумай имя новой категории"},
    "is_income":
        {"text": "Является ли эта категория доходом?", "answer": {"Да": True, "Нет": False}},
    "repeat":
        {"text": "Категория создана. Забабахаем еще одну?", "answer": ["Да"]}
    }


@router.message(default_state, Command("create_category"))
async def handle_create_category(message: Message, state: FSMContext):
    text = params["name"]["text"]
    button = make_row_keyboard()

    await message.answer(text=text, reply_markup=button)
    await state.set_state(NewCategories.choosing_category_name)


@router.message(NewCategories.choosing_category_name)
async def category_name_chosen(message: Message, state: FSMContext):
    text = params["is_income"]["text"]
    button = make_row_keyboard(list(params["is_income"]["answer"].keys()))

    await state.update_data(category_name=message.text)
    await message.answer(text=text, reply_markup=button)
    await state.set_state(NewCategories.choosing_category_is_income)


@router.message(NewCategories.choosing_category_is_income, F.text.in_(params["is_income"]["answer"]))
async def category_name_chosen(message: Message, state: FSMContext):
    text = params["repeat"]["text"]
    button = make_row_keyboard(params["repeat"]["answer"])
    user_data = await state.get_data()
    is_income = params["is_income"]["answer"][message.text]

    db = Categories(postgres_conn)
    db.create_category(message.from_user.id, user_data["category_name"], is_income)

    await message.answer(text=text, reply_markup=button)
    await state.set_state(NewCategories.choosing_category_repeat)


@router.message(NewCategories.choosing_category_repeat, F.text.in_(params["repeat"]["answer"]))
async def category_name_chosen(message: Message, state: FSMContext):
    text = params["name"]["text"]
    button = make_row_keyboard()
    await state.clear()
    await message.answer(text=text, reply_markup=button)
    await state.set_state(NewCategories.choosing_category_name)


