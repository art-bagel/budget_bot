from aiogram import F, Router
from aiogram.types import Message
from aiogram.fsm.context import FSMContext
from aiogram.filters import Command
from aiogram.fsm.state import StatesGroup, State, default_state
from aiogram.types import ReplyKeyboardRemove

from keyboards.menu import main, categories
from keyboards.builder import make_column_keyboard
from config import postgres_conn
from database_tools.categories import Categories
from filters.category_name import CategoryNameFilter

router = Router()

db_categories = Categories(postgres_conn)


class UnionInGroup(StatesGroup):
    choosing_group_name = State()
    choosing_categories_in_group = State()
    choosing_percent_by_category = State()
    choosing_category_repeat = State()


@router.message(default_state, Command("union_in_group"))
@router.message(default_state, F.text.lower() == "объединить в группу")
async def handle_create_category(message: Message, state: FSMContext):
    text = "Придумай имя новой группы"
    button = make_column_keyboard([["Отмена"]])
    await state.set_state(UnionInGroup.choosing_group_name)
    await message.answer(text=text, reply_markup=button)


@router.message(UnionInGroup.choosing_group_name)
async def handle_group_name_chosen(message: Message, state: FSMContext):
    cg_name_id = db_categories.get_name_categories(
        message.from_user.id, is_income=False, is_active=True
    )
    cg_id_name = dict(zip(cg_name_id.values(), cg_name_id.keys()))

    if cg_name_id:
        text = "Выбери категории или группы, которые войдут в новую группу"
        button = make_column_keyboard([[name] for name in cg_name_id.keys()])
        next_state = UnionInGroup.choosing_categories_in_group
        await state.update_data(group_name=message.text, cg_id_name=cg_id_name)
    else:
        text = "У тебя нет категорий, давай сначала создадим их!"
        button = make_column_keyboard(categories)
        next_state = default_state

    await state.set_state(next_state)
    await message.answer(text=text, reply_markup=button)


@router.message(UnionInGroup.choosing_categories_in_group, CategoryNameFilter(db_categories, is_active=True))
async def handle_categories_in_group_chosen(message: Message, state: FSMContext, category_id: int):
    user_data = await state.get_data()
    name = user_data["cg_id_name"].pop(category_id)
    if user_data.get("new_group"):
        user_data["new_group"].update({category_id: name})
    else:
        user_data.update({"new_group": {category_id: name}})

    cg_names = user_data["cg_id_name"].values()
    await state.update_data(user_data)

    text = "Добавим еще одну?"
    button = make_column_keyboard([[name] for name in cg_names] + [["Достаточно"]])
    next_state = UnionInGroup.choosing_categories_in_group
    if not cg_names:
        text = "Ок, идем дальше"
        button = ReplyKeyboardRemove()
        next_state = UnionInGroup.choosing_percent_by_category

    await state.set_state(next_state)
    await message.answer(text=text, reply_markup=button)


@router.message(UnionInGroup.choosing_categories_in_group, F.text.lower() == "достаточно")
@router.message(UnionInGroup.choosing_percent_by_category)
async def handle_percent_by_category_choosing(message: Message, state: FSMContext):
    user_data = await state.get_data()
    text = "Огонь группа создана. Это было трудно но ты справился"
    if user_data.get("loop"):
        print("-1")
        category_id = user_data["category_id"]
        try:
            percent = int(message.text)
            if 1 < percent < 101:
                print("0")
                user_data["result"].update({category_id: percent})
                if user_data["new_group"]:
                    c_id, c_name = user_data["new_group"].popitem()
                    user_data["category_id"] = c_id
                    await state.update_data(user_data)
                    text = (f"Выбери процент для категории {c_name} в группе в формате от 1 до 100\n"
                            "Помни, что общий процент всех категорий в группе должен быть равен 100")
                    print("1")
                else:
                    print("2")
                    total_percent = sum(user_data["result"].values())
                    if total_percent != 100:
                        print("3")
                        text = (f"Общий процент должен быть равен 100%, а у тебя получилось {total_percent}. "
                                "Давай попробуем еще раз.")
                        print(user_data)
                        user_data["loop"] = False
                        user_data["new_group"] = user_data["tmp_group"].copy()
                        await state.update_data(user_data)
                        print(await state.get_data())
            else:
                print("4")
                text = "Ай, яй.. Я же говорю, процент должен быть от 1 до 100. Попробуй еще раз."

        except ValueError:
            print("5")
            text = ("Не могу распознать введенное число. "
                    "Пожалуйста, используй формат числа от 1 до 100")
    else:
        print("6")
        tmp_data = user_data["new_group"].copy()
        c_id, c_name = user_data["new_group"].popitem()
        text = (f"Выбери процент для < {c_name} > в группе \n"
                "Формате от 1 до 100\n"
                "Помни, что общий процент всех категорий в группе должен быть равен 100")
        await state.update_data(result={}, category_id=c_id, tmp_group=tmp_data, loop=True)

    await state.set_state(UnionInGroup.choosing_percent_by_category)
    print(await state.get_data())
    await message.answer(text=text, reply_markup=ReplyKeyboardRemove())
