// A credit account's balance in base currency: negative is debt, positive is
// an overpayment (own money on the card, already counted in the budget).
type CreditBalance = { historical_cost_in_base: number };

const balanceOf = (balances: CreditBalance[]) =>
  balances.reduce((sum, b) => sum + b.historical_cost_in_base, 0);

export function creditCardView(balances: CreditBalance[], limit: number) {
  const balance = balanceOf(balances);
  const used = Math.max(0, -balance);
  return {
    used,
    overpayment: Math.max(0, balance),
    available: Math.max(0, limit + balance),
    usedPct: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0,
    // Archived accounts accept no transfers, so only a card at zero can go.
    canArchive: Math.round(balance * 100) === 0,
  };
}

// Debt and overpayment are summed per account: one card's overpayment does
// not hide another card's debt.
export function creditTotals(accounts: CreditBalance[][]) {
  return accounts.reduce(
    (acc, balances) => {
      const view = creditCardView(balances, 0);
      return { debt: acc.debt + view.used, overpayment: acc.overpayment + view.overpayment };
    },
    { debt: 0, overpayment: 0 },
  );
}
