-- 035: снос функций планировщика, заменённых атомарным захватом.
--
-- get__due_scheduled_expenses (чтение списка) и put__advance_scheduled_expense
-- (сдвиг даты после исполнения) заменены одной put__claim_due_scheduled_expenses,
-- которая читает и сдвигает в одной операции. Между старыми двумя шагами
-- помещалось двойное списание: два инстанса API читали один список, либо
-- процесс падал после записи расхода, но до сдвига даты.
--
-- Файлы функций удалены из func/, но run_func_scripts.sh только пересоздаёт
-- существующие файлы и ничего не удаляет — поэтому в уже живых базах старые
-- функции нужно снести явно, иначе они останутся там навсегда.

DROP FUNCTION IF EXISTS budgeting.get__due_scheduled_expenses();
DROP FUNCTION IF EXISTS budgeting.put__advance_scheduled_expense(bigint, text);
