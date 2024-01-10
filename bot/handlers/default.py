from aiogram import F, Router
from aiogram.types import Message
from aiogram.fsm.context import FSMContext

router = Router()


@router.message()
async def cmd_cancel(message: Message, state: FSMContext):
    text = "Эта ленивая жопа еще не научила меня обрабатывать такую команду."
    if await state.get_state():
        text = "Наебать меня пытаешься, я такую команду не приму. Попробуй еще раз."
    await message.answer(text=text)
