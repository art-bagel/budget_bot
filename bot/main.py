import asyncio
import logging

from aiogram import Bot
from aiogram import Dispatcher
from aiogram import types
from aiogram.filters import CommandStart, Command

from config import BOT_TOKEN, DB_HOST, DB_PORT, DB_DATABASE, DB_USERNAME, DB_PASSWORD
from database_tools import UserTools


dp = Dispatcher()


@dp.message(CommandStart())
async def handle_start(message: types.Message):
    user = UserTools(DB_HOST, DB_PORT, DB_DATABASE, DB_USERNAME, DB_PASSWORD)
    answer = f"Добро пожаловать, {message.from_user.first_name}!"
    response = user.create_user_if_not_exists(schema='prod', user=message.from_user)
    if response == 'exists':
        answer = f"C возвращением, {message.from_user.first_name}!"
    await message.answer(text=answer)
    await message.delete()


@dp.message(Command("help"))
async def handle_help(message: types.Message):
    text = "Это будущая подсказка"
    await message.answer(text=text)


async def main():
    logging.basicConfig(level=logging.DEBUG)
    bot = Bot(token=BOT_TOKEN)
    await dp.start_polling(bot)  # опрашивать телеграм на наличие новых событий

if __name__ == '__main__':
    asyncio.run(main())
