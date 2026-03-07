export interface UserContext {
  status: string;
  user_id: number;
  bank_account_id: number;
  unallocated_category_id: number;
  fx_result_category_id: number;
  base_currency_code: string;
}

export interface Category {
  id: number;
  name: string;
  kind: string;
  is_active: boolean;
  created_at: string;
}

export interface Currency {
  code: string;
  name: string;
  scale: number;
}

export interface IncomeSource {
  id: number;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface RecordIncomeRequest {
  bank_account_id: number;
  income_source_id?: number;
  amount: number;
  currency_code: string;
  budget_amount_in_base?: number;
  comment?: string;
}

export interface RecordIncomeResponse {
  operation_id: number;
  budget_amount_in_base: number;
  base_currency_code: string;
}

export interface RecordExpenseRequest {
  bank_account_id: number;
  category_id: number;
  amount: number;
  currency_code: string;
  comment?: string;
}

export interface RecordExpenseResponse {
  operation_id: number;
  expense_cost_in_base: number;
  base_currency_code: string;
}
