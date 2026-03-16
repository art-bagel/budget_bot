import asyncio
import logging

from storage.ledger import Ledger

logger = logging.getLogger(__name__)


async def run_scheduled_expenses(ledger_instance: Ledger) -> None:
    """Executes all due scheduled expenses for all users in one pass."""
    try:
        due_items = await ledger_instance.get__due_scheduled_expenses()
    except Exception as exc:
        logger.error('Scheduler: failed to fetch due scheduled expenses: %s', exc)
        return

    if not due_items:
        return

    logger.info('Scheduler: processing %d due scheduled expense(s)', len(due_items))

    for item in due_items:
        schedule_id = item['id']
        try:
            await ledger_instance.put__record_expense(
                user_id=item['created_by_user_id'],
                bank_account_id=item['bank_account_id'],
                category_id=item['category_id'],
                amount=float(item['amount']),
                currency_code=item['currency_code'],
                comment=item.get('comment'),
            )
            logger.info('Scheduler: executed scheduled expense %d', schedule_id)
        except Exception as exc:
            logger.warning('Scheduler: scheduled expense %d failed: %s', schedule_id, exc)
        finally:
            # Always advance next_run_at so the record is not re-triggered every minute.
            try:
                await ledger_instance.put__advance_scheduled_expense(schedule_id)
            except Exception as exc:
                logger.error('Scheduler: failed to advance scheduled expense %d: %s', schedule_id, exc)


async def scheduler_loop(ledger_instance: Ledger) -> None:
    """Background loop: checks for due scheduled expenses every 60 seconds."""
    logger.info('Scheduler started')
    while True:
        await asyncio.sleep(60)
        await run_scheduled_expenses(ledger_instance)
