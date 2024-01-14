from aiogram import F, Router
from aiogram.types import Message
from aiogram.filters import Command
from aiogram.fsm.state import default_state

from keyboards.menu import main, categories
from keyboards.builder import make_column_keyboard
from config import postgres_conn
from database_tools.categories import Categories


router = Router()
db_categories = Categories(postgres_conn)


@router.message(default_state, Command("categories_info"))
@router.message(default_state, F.text.lower() == "мои категории")
async def handle_group_info(message: Message):
    categories_name = db_categories.get_name_categories(
        message.from_user.id, is_active=True, is_group=False).keys()

    if categories_name:
        text = '\n'.join(categories_name)
        button = make_column_keyboard(categories)
    else:
        text = "Прежде чем что-то смотреть, надо что-то создать!"
        button = make_column_keyboard(main)
    await message.answer(text=text, reply_markup=button)
