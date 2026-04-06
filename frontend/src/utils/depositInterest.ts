/**
 * Deposit interest calculation utilities.
 * Mirrors backend logic in backend/app/services/deposit_interest.py.
 */

function daysBetween(from: Date, to: Date): number {
  const msPerDay = 86_400_000;
  return Math.round((to.getTime() - from.getTime()) / msPerDay);
}

function fullMonthsBetween(from: Date, to: Date): number {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) {
    months -= 1;
  }
  return Math.max(months, 0);
}

function addMonths(d: Date, months: number): Date {
  const result = new Date(d.getFullYear(), d.getMonth() + months, d.getDate());
  // Handle overflow (e.g., Jan 31 + 1 month = Mar 3 → clamp to Feb 28)
  if (result.getDate() !== d.getDate()) {
    result.setDate(0); // last day of prev month
  }
  return result;
}

export function calculateSimpleInterest(principal: number, annualRate: number, days: number): number {
  if (days <= 0 || annualRate <= 0) return 0;
  return Math.round(principal * annualRate / 100 * days / 365 * 100) / 100;
}

export function calculateCompoundDaily(principal: number, annualRate: number, days: number): number {
  if (days <= 0 || annualRate <= 0) return 0;
  const dailyRate = annualRate / 100 / 365;
  return Math.round(principal * (Math.pow(1 + dailyRate, days) - 1) * 100) / 100;
}

export function calculateCompoundMonthly(principal: number, annualRate: number, startDate: Date, endDate: Date): number {
  if (startDate >= endDate || annualRate <= 0) return 0;

  const monthlyRate = annualRate / 100 / 12;
  const months = fullMonthsBetween(startDate, endDate);

  const fullMonthsEnd = months > 0 ? addMonths(startDate, months) : startDate;
  const compoundedPrincipal = principal * Math.pow(1 + monthlyRate, months);

  const remainingDays = Math.max(daysBetween(fullMonthsEnd, endDate), 0);
  const simplePart = compoundedPrincipal * annualRate / 100 * remainingDays / 365;

  const total = (compoundedPrincipal - principal) + simplePart;
  return Math.round(total * 100) / 100;
}

export type DepositKind = 'term_deposit' | 'savings_account';
export type InterestPayout = 'at_end' | 'monthly_to_account' | 'capitalize';
export type CapitalizationPeriod = 'daily' | 'monthly';

export interface DepositParams {
  depositKind: DepositKind;
  principal: number;
  annualRate: number;
  startDate: string; // ISO date
  endDate?: string;  // ISO date, for term deposits
  interestPayout?: InterestPayout;
  capitalizationPeriod?: CapitalizationPeriod;
}

export function calculateProjectedInterest(params: DepositParams): number {
  const { depositKind, principal, annualRate, startDate, endDate, interestPayout, capitalizationPeriod } = params;

  if (principal <= 0 || annualRate <= 0 || !startDate) return 0;

  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date();

  if (start >= end) return 0;

  const days = daysBetween(start, end);

  if (depositKind === 'term_deposit') {
    const payout = interestPayout ?? 'at_end';
    if (payout === 'at_end' || payout === 'monthly_to_account') {
      return calculateSimpleInterest(principal, annualRate, days);
    }
    // capitalize
    const period = capitalizationPeriod ?? 'monthly';
    if (period === 'daily') {
      return calculateCompoundDaily(principal, annualRate, days);
    }
    return calculateCompoundMonthly(principal, annualRate, start, end);
  }

  // savings_account
  const period = capitalizationPeriod ?? 'daily';
  if (period === 'daily') {
    return calculateCompoundDaily(principal, annualRate, days);
  }
  return calculateCompoundMonthly(principal, annualRate, start, end);
}
