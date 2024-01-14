from aiogram import F, Router
from aiogram.types import Message
from aiogram.fsm.context import FSMContext
from aiogram.filters import Command
from aiogram.fsm.state import StatesGroup, State, default_state

from keyboards.menu import main, categories
from keyboards.builder import make_column_keyboard
from config import postgres_conn
from database_tools.categories import Categories
from filters.category_name import CategoryNameFilter


router = Router()
db_categories = Categories(postgres_conn)


class DisbandGroup(StatesGroup):
    choosing_disband_group_name = State()


@router.message(default_state, Command("disband_group"))
@router.message(default_state, F.text.lower() == "распустить группу")
async def handle_disband_group(message: Message, state: FSMContext):
    categories_names = db_categories.get_name_categories(
        message.from_user.id, is_active=True, is_group=True).keys()
    next_state = DisbandGroup.choosing_disband_group_name
    if categories_names:
        text = "Какую группу удалим?"
        button = make_column_keyboard([[name] for name in categories_names])
    else:
        text = "Прежде чем удалять, надо что-то создать!"
        button = make_column_keyboard(main)
        next_state = default_state
    await message.answer(text=text, reply_markup=button)
    await state.set_state(next_state)


@router.message(DisbandGroup.choosing_disband_group_name,
                CategoryNameFilter(db_categories, is_active=True, is_group=True))
async def handle_delete_name_chosen(message: Message, state: FSMContext, category_id: int):
    group_info = db_categories.get_one_category(message.from_user.id, category_id)
    is_member_group = db_categories.check_is_member_groups(category_id)
    first_name = message.from_user.first_name

    if is_member_group:
        text = (f"{first_name}, эта группа сейчас у тебя включена в другую группу. " 
                "Попробуй сперва изменить родительскую группу.")
        button = make_column_keyboard(categories)
    elif not group_info['is_owner']:
        text = f"{first_name}, не не не, так дела не делаются, не ты ее создавал, не тебе ее распускать."
        button = make_column_keyboard(main)
    else:
        db_categories.disband_group(message.from_user.id, category_id)
        text = f"Эх.. ничто не вечно под луной. Группа распущена"
        button = make_column_keyboard(main)

    await state.clear()
    await message.answer(text=text, reply_markup=button)
    await state.set_state(default_state)
