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


class GroupsInfo(StatesGroup):
    choosing_group_name = State()


@router.message(default_state, Command("group_info"))
@router.message(default_state, F.text.lower() == "мои группы")
async def handle_group_info(message: Message, state: FSMContext):
    groups_name = db_categories.get_name_categories(
        message.from_user.id, is_active=True, is_group=True).keys()
    next_state = GroupsInfo.choosing_group_name
    if groups_name:
        text = "По какой группе предоставить информацию?"
        button = make_column_keyboard([[name] for name in groups_name] + [["Отмена"]])
    else:
        text = "Прежде чем что-то смотреть, надо что-то создать!"
        button = make_column_keyboard(main)
        next_state = default_state
    await message.answer(text=text, reply_markup=button)
    await state.set_state(next_state)


@router.message(GroupsInfo.choosing_group_name,
                CategoryNameFilter(db_categories, is_active=True, is_group=True))
async def handle_group_name_chosen(message: Message, state: FSMContext, category_id: int):
    groups_info = db_categories.get_group_info(message.from_user.id, category_id)
    group_name = ''
    info = ''
    for group in groups_info:
        group_name = group['group_name'].upper()
        info += f"{group['category_in_group']}:  {int(group['percent'] * 100)}%\n"

    text = f"{group_name} \n{info}"
    button = make_column_keyboard(categories)

    await state.clear()
    await message.answer(text=text, reply_markup=button)
    await state.set_state(default_state)
