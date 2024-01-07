from aiogram import F, Router
from aiogram.types import Message, ReplyKeyboardRemove
from aiogram.filters import CommandStart, Command
from aiogram.fsm.context import FSMContext

from database_tools.users import Users
from config import postgres_conn
from keyboards.builder import make_column_keyboard
from keyboards.menu import analytic, main, income, settings, categories

router = Router()


@router.message(CommandStart())
async def handle_start(message: Message):
    user = Users(postgres_conn)
    answer = f"Добро пожаловать, {message.from_user.first_name}!"
    response = user.create_user_if_not_exists(user=message.from_user)
    if response == 'exists':
        answer = f"C возвращением, {message.from_user.first_name}!"
    await message.answer(
        text=answer,
        reply_markup=make_column_keyboard(main)
    )
    await message.delete()


@router.message(Command(commands=["main_menu"]))
@router.message(F.text.lower() == "главное меню")
async def handle_cancel(message: Message, state: FSMContext):
    text = "Чем займемся?"
    await message.answer(
        text=text,
        reply_markup=make_column_keyboard(main)
    )
    await state.clear()


@router.message(Command(commands=["income"]))
@router.message(F.text.lower() == "пополнить")
async def handle_cancel(message: Message, state: FSMContext):
    text = "Бабки, бабки, бабки"
    await message.answer(
        text=text,
        reply_markup=make_column_keyboard(income)
    )
    await state.clear()


@router.message(Command(commands=["analytics"]))
@router.message(F.text.lower() == "аналитика")
async def handle_cancel(message: Message, state: FSMContext):
    text = "Убытки, убытки-то какие! Мы так скоро по миру пойдем!"
    await message.answer(
        text=text,
        reply_markup=make_column_keyboard(analytic)
    )
    await state.clear()


@router.message(Command(commands=["settings"]))
@router.message(F.text.lower() == "настройки")
async def handle_cancel(message: Message, state: FSMContext):
    text = f"Ну выбирай, что на этот раз будем ломать?"
    await message.answer(
        text=text,
        reply_markup=make_column_keyboard(settings)
    )
    await state.clear()


@router.message(Command(commands=["categories"]))
@router.message(F.text.lower() == "категории")
async def handle_cancel(message: Message, state: FSMContext):
    text = f"Окей, значит будем играться с категориями"
    await message.answer(
        text=text,
        reply_markup=make_column_keyboard(categories)
    )
    await state.clear()


@router.message(Command(commands=["cancel"]))
@router.message(F.text.lower() == "отмена")
async def handle_cancel(message: Message, state: FSMContext):
    text = "Нечего отменять"
    if await state.get_state():
        text = "Галя, отмена"
    await message.answer(
        text=text,
        reply_markup=make_column_keyboard(main)
    )
    await state.clear()


@router.message(Command("help"))
async def handle_help(message: Message):
    text = "Это будущая подсказка"
    await message.answer(text=text)


