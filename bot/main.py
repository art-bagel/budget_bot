import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage

from config import BOT_TOKEN
from handlers import common, default
from handlers.categories import groups_info, create_category, categories_info, delete_category, union_in_group, disband_group
from handlers.income import income_by_category, income_on_group
from handlers.transactions import create_spend, between_categories
from handlers.analytics import simple_analytics


async def main():
    logging.basicConfig(level=logging.DEBUG)
    bot = Bot(token=BOT_TOKEN)
    dp = Dispatcher(storage=MemoryStorage())

    dp.include_router(common.router)
    dp.include_router(create_category.router)
    dp.include_router(union_in_group.router)
    dp.include_router(delete_category.router)
    dp.include_router(income_by_category.router)
    dp.include_router(income_on_group.router)
    dp.include_router(create_spend.router)
    dp.include_router(disband_group.router)
    dp.include_router(categories_info.router)
    dp.include_router(groups_info.router)
    dp.include_router(between_categories.router)
    dp.include_router(simple_analytics.router)
    dp.include_router(default.router)

    await bot.delete_webhook(drop_pending_updates=True)
    await dp.start_polling(bot)  # опрашивать телеграм на наличие новых событий

if __name__ == '__main__':
    asyncio.run(main())
