// Russian names of manual crypto and collection journal commands.
export const JOURNAL_KINDS: Record<string,string> = { swap:'Обмен',transfer:'Перевод',create_protocol:'Размещение в DeFi',
  top_up_protocol:'Пополнение DeFi',close_protocol:'Закрытие DeFi',partial_close_protocol:'Вывод из DeFi',
  borrow:'Заём',repay:'Погашение',accrue_interest:'Проценты по долгу',liquidate:'Ликвидация',
  lp_snapshot:'Состав пула',lp_withdraw:'Вывод ликвидности',lp_reward:'Награда пула',reward:'Награда',expense:'Расход',receive_unknown:'Поступление',fee_refund:'Возврат комиссии',quantity_correction:'Уточнение количества',staking_convert:'Обмен стейкингового токена',accrue:'Начисление',tag_lending_account:'Счёт протокола',buy_fiat:'Покупка',sell_fiat:'Продажа',bank_sell:'Продажа через банк',settle_fiat_sale:'Категория расхода',position_income:'Награда',protocol_yield:'Начисление в DeFi',linked_fee_refund:'Возврат комиссии',fee:'Комиссия',group_lending:'Общий счёт протокола',
  bank_purchase:'Покупка через банк',bank_settle_sale:'Категория карточной оплаты',budget_allocate:'Распределение бюджета',bank_expense:'Расход',bank_crypto_expense:'Расход в криптовалюте',observation:'Примечание',lp_custody:'Передача LP',collectible_buy:'Покупка предмета',collectible_sell:'Продажа предмета',collectible_fiat_buy:'Покупка предмета',collectible_fiat_close:'Продажа предмета',collectible_fiat_topup:'Доплата',collectible_fiat_fee:'Комиссия',collectible_coin_topup:'Доплата',collectible_coin_fee:'Комиссия',collectible_transfer:'Перевод коллекций',collectible_receive:'Получение предмета',collectible_details:'Параметры предмета',bank_buy:'Покупка через банк',bank_to_portfolio:'Ввод в портфель',bank_withdraw:'Вывод в банк',bank_cash_sell:'Продажа в банке' };

// A journal event without an operations row is named by its commands.
export function journalTitle(commands: { kind: string }[] | undefined): string {
  return (commands ?? []).map((c) => JOURNAL_KINDS[c.kind] ?? 'Операция').join(' + ') || 'Операция';
}

// The server names blocking operations by command kinds; show them in Russian.
export function readableCancelReason(message: string): string {
  return message.replace(/\b[a-z][a-z_]*\b/g, (kind) => JOURNAL_KINDS[kind] ?? kind);
}
