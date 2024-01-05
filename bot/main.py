import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage

from config import BOT_TOKEN
from handlers import common, default, create_category


async def main():
    logging.basicConfig(level=logging.DEBUG)
    bot = Bot(token=BOT_TOKEN)
    dp = Dispatcher(storage=MemoryStorage())

    dp.include_router(common.router)
    dp.include_router(create_category.router)
    dp.include_router(default.router)

    await dp.start_polling(bot)  # опрашивать телеграм на наличие новых событий

if __name__ == '__main__':
    asyncio.run(main())
