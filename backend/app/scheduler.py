import asyncio
import logging

from storage.ledger import Ledger

logger = logging.getLogger(__name__)

NO_PRIMARY_ACCOUNT_ERROR = 'Нет активного основного счёта для списания'


async def run_scheduled_expenses(ledger_instance: Ledger) -> None:
    """
    Исполняет все наступившие запланированные расходы за один проход.

    Строки забираются в работу атомарно: put__claim_due_scheduled_expenses
    сдвигает next_run_at в той же операции, которой читает список. Поэтому
    одну и ту же строку не получат ни два инстанса API, ни повторный проход
    после перезапуска — а именно так раньше и возникало двойное списание.

    Размен осознанный: падение между захватом и записью расхода теперь
    пропускает расход, а не дублирует его. Для денег пропустить безопаснее.
    """
    try:
        claimed_items = await ledger_instance.put__claim_due_scheduled_expenses()
    except Exception as exc:
        logger.error('Scheduler: failed to claim due scheduled expenses: %s', exc)
        return

    if not claimed_items:
        return

    logger.info('Scheduler: processing %d claimed scheduled expense(s)', len(claimed_items))

    for item in claimed_items:
        schedule_id = item['id']
        bank_account_id = item.get('bank_account_id')
        run_error: str | None = None

        if bank_account_id is None:
            # Раньше такая строка молча выпадала из выборки по INNER JOIN:
            # не списывалась, не сдвигалась и нигде не показывалась.
            run_error = NO_PRIMARY_ACCOUNT_ERROR
            logger.warning('Scheduler: scheduled expense %d has no primary account', schedule_id)
        else:
            try:
                await ledger_instance.put__record_expense(
                    user_id=item['created_by_user_id'],
                    bank_account_id=bank_account_id,
                    category_id=item['category_id'],
                    amount=float(item['amount']),
                    currency_code=item['currency_code'],
                    comment=item.get('comment'),
                )
                logger.info('Scheduler: executed scheduled expense %d', schedule_id)
            except Exception as exc:
                run_error = str(exc)
                logger.warning('Scheduler: scheduled expense %d failed: %s', schedule_id, exc)

        try:
            await ledger_instance.set__scheduled_expense_run_result(schedule_id, run_error)
        except Exception as exc:
            # Дата уже сдвинута при захвате, поэтому потеря этой записи не
            # приводит к повтору — теряется только текст ошибки в UI.
            logger.error('Scheduler: failed to store run result for %d: %s', schedule_id, exc)


async def scheduler_loop(ledger_instance: Ledger) -> None:
    """Background loop: checks for due scheduled expenses every 60 seconds."""
    logger.info('Scheduler started')
    while True:
        await asyncio.sleep(60)
        await run_scheduled_expenses(ledger_instance)
