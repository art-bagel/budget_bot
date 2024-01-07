from aiogram import F, Router
from aiogram.types import Message
from aiogram.filters import Command
from aiogram.fsm.state import default_state

from keyboards.menu import analytic
from keyboards.builder import make_column_keyboard
from config import postgres_conn
from database_tools.transactions import Transactions


router = Router()
db_transactions = Transactions(postgres_conn)


@router.message(default_state, Command("balance"))
@router.message(default_state, F.text.lower() == "остаток")
async def handle_balance(message: Message):
    balance = db_transactions.get_categories_balance(message.from_user.id)
    text = ""
    button = make_column_keyboard(analytic)
    for categories in balance:
        text += f"{categories['name']}    {categories['balance']} \n"
    await message.answer(text=text, reply_markup=button)


@router.message(default_state, Command("last_transaction"))
@router.message(default_state, F.text.lower() == "последняя операция")
async def handle_last_transaction(message: Message):
    lasts_transaction = db_transactions.get_last_transaction(message.from_user.id)
    text = ""
    button = make_column_keyboard(analytic)
    for categories in lasts_transaction:
        text += f"из {categories['name_from']} в {categories['name_to']}:  {categories['amount']}\n"
    if not text:
        text = "Пусто, а чего ты ожидал увидеть!?"
    await message.answer(text=text, reply_markup=button)


@router.message(default_state, Command("delete_last_transaction"))
@router.message(default_state, F.text.lower() == "удалить последнюю операцию")
async def handle_delete_last_transaction(message: Message):
    db_transactions.delete_last_transaction(message.from_user.id)
    text = "Отменил последнюю операцию, в следующий раз будь внимательнее..."
    button = make_column_keyboard(analytic)
    await message.answer(text=text, reply_markup=button)
