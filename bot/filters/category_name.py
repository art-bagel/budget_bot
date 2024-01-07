from typing import Union, Dict, Any

from aiogram.filters import BaseFilter
from aiogram.types import Message

from database_tools.categories import Categories


class CategoryNameFilter(BaseFilter):
    def __init__(self, db: Categories, is_income: bool = None, is_active: bool = None, is_group: bool = None):
        self.is_income = is_income
        self.is_active = is_active
        self.is_group = is_group
        self.db_categories = db

    async def __call__(self, message: Message) -> Union[bool, Dict[str, Any]]:
        categories = self.db_categories.get_name_categories(
            message.from_user.id, self.is_income, self.is_active, self.is_group
        )
        category_id = categories.get(message.text.lower())
        if category_id:
            return {'category_id': category_id}
        else:
            return False
