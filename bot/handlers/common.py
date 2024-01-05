from aiogram import F, Router
from aiogram.types import Message, ReplyKeyboardRemove
from aiogram.filters import CommandStart, Command
from aiogram.fsm.context import FSMContext

from config import postgres_conn
from database_tools.users import Users

router = Router()


@router.message(CommandStart())
async def handle_start(message: Message):
    user = Users(postgres_conn)
    answer = f"Добро пожаловать, {message.from_user.first_name}!"
    response = user.create_user_if_not_exists(user=message.from_user)
    if response == 'exists':
        answer = f"C возвращением, {message.from_user.first_name}!"
    await message.answer(text=answer)
    await message.delete()


@router.message(Command(commands=["cancel"]))
@router.message(F.text.lower() == "отмена")
async def cmd_cancel(message: Message, state: FSMContext):
    text = "Нечего отменять"
    if await state.get_state():
        text = "Галя, отмена"
    await message.answer(
        text=text,
        reply_markup=ReplyKeyboardRemove()
    )
    await state.clear()


@router.message(Command("help"))
async def handle_help(message: Message):
    text = "Это будущая подсказка"
    await message.answer(text=text)


