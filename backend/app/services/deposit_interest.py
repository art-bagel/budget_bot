from datetime import date
from math import pow


def calculate_simple_interest(principal: float, annual_rate: float, days: int) -> float:
    """Simple interest: P * r/100 * days/365."""
    if days <= 0 or annual_rate <= 0:
        return 0.0
    return round(principal * annual_rate / 100.0 * days / 365.0, 2)


def calculate_compound_daily(principal: float, annual_rate: float, days: int) -> float:
    """Daily compound interest: P * ((1 + r/100/365)^days - 1)."""
    if days <= 0 or annual_rate <= 0:
        return 0.0
    daily_rate = annual_rate / 100.0 / 365.0
    return round(principal * (pow(1.0 + daily_rate, days) - 1.0), 2)


def calculate_compound_monthly(
    principal: float, annual_rate: float, start_date: date, end_date: date,
) -> float:
    """Monthly compound interest with remaining days as simple interest.

    Full months get compound interest: P * (1 + r/12)^months.
    Remaining days in the current month get simple interest on the compounded amount.
    """
    if start_date >= end_date or annual_rate <= 0:
        return 0.0

    monthly_rate = annual_rate / 100.0 / 12.0

    # Count full months
    full_months = (end_date.year - start_date.year) * 12 + (end_date.month - start_date.month)
    # If end_date.day < start_date.day, subtract one month (incomplete month)
    if end_date.day < start_date.day:
        full_months -= 1

    if full_months < 0:
        full_months = 0

    # Date after full months of compounding
    if full_months > 0:
        compound_month = start_date.month + full_months
        compound_year = start_date.year + (compound_month - 1) // 12
        compound_month = (compound_month - 1) % 12 + 1
        # Same day in the resulting month
        try:
            full_months_end = date(compound_year, compound_month, start_date.day)
        except ValueError:
            # Handle months with fewer days (e.g., Jan 31 -> Feb 28)
            import calendar
            last_day = calendar.monthrange(compound_year, compound_month)[1]
            full_months_end = date(compound_year, compound_month, min(start_date.day, last_day))
    else:
        full_months_end = start_date

    # Compound part
    compounded_principal = principal * pow(1.0 + monthly_rate, full_months)

    # Remaining days — simple interest on the compounded amount
    remaining_days = (end_date - full_months_end).days
    if remaining_days < 0:
        remaining_days = 0

    simple_part = compounded_principal * annual_rate / 100.0 * remaining_days / 365.0

    total_interest = (compounded_principal - principal) + simple_part
    return round(total_interest, 2)


def calculate_accrued_interest(
    metadata: dict,
    amount_in_currency: float,
    from_date: date,
    to_date: date,
) -> float:
    """Calculate accrued interest based on deposit metadata.

    Dispatches to the appropriate formula based on deposit_kind and payout/capitalization settings.
    """
    if from_date >= to_date or amount_in_currency <= 0:
        return 0.0

    deposit_kind = metadata.get("deposit_kind")
    interest_rate = metadata.get("interest_rate", 0)
    if not interest_rate or interest_rate <= 0:
        return 0.0

    days = (to_date - from_date).days

    if deposit_kind == "term_deposit":
        interest_payout = metadata.get("interest_payout", "at_end")
        if interest_payout in ("at_end", "monthly_to_account"):
            return calculate_simple_interest(amount_in_currency, interest_rate, days)
        # capitalize
        cap_period = metadata.get("capitalization_period", "monthly")
        if cap_period == "daily":
            return calculate_compound_daily(amount_in_currency, interest_rate, days)
        return calculate_compound_monthly(amount_in_currency, interest_rate, from_date, to_date)

    if deposit_kind == "savings_account":
        cap_period = metadata.get("capitalization_period", "daily")
        if cap_period == "daily":
            return calculate_compound_daily(amount_in_currency, interest_rate, days)
        return calculate_compound_monthly(amount_in_currency, interest_rate, from_date, to_date)

    return 0.0


def get_accrual_base_date(metadata: dict, opened_at: date) -> date:
    """Get the date from which to calculate new accrued interest."""
    last_accrual = metadata.get("last_accrual_date")
    if last_accrual:
        if isinstance(last_accrual, str):
            return date.fromisoformat(last_accrual)
        return last_accrual
    return opened_at


def should_capitalize(metadata: dict) -> bool:
    """Check if accrued interest should be added to the deposit principal."""
    deposit_kind = metadata.get("deposit_kind")
    if deposit_kind == "savings_account":
        return True
    if deposit_kind == "term_deposit":
        return metadata.get("interest_payout") == "capitalize"
    return False
