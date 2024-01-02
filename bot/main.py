import asyncio
import logging

from aiogram import Bot  # для работы с телеграмм
from aiogram import Dispatcher  # обработка событий
from aiogram import types
from aiogram.filters import CommandStart, Command

import config

bot = Bot(token=config.BOT_TOKEN)
dp = Dispatcher()


@dp.message(CommandStart())
async def handle_start(message: types.Message):
    await message.answer(text=f"Hello, {message.from_user.full_name}!")


@dp.message(Command("help"))
async def handle_help(message: types.Message):
    text = "Это будущая подсказка"
    await message.answer(text=text)


async def main():
    logging.basicConfig(level=logging.DEBUG)
    await dp.start_polling(bot)  # опрашивать телеграм на наличие новых событий

if __name__ == '__main__':
    asyncio.run(main())
