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

export interface GroupMember {
  child_category_id: number;
  child_category_name: string;
  share: number;
}

export interface Currency {
  code: string;
  name: string;
  scale: number;
}

export interface DashboardBankBalance {
  currency_code: string;
  amount: number;
  historical_cost_in_base: number;
  base_currency_code: string;
}

export interface DashboardBudgetCategory {
  category_id: number;
  name: string;
  kind: string;
  balance: number;
  currency_code: string;
}

export interface DashboardOverview {
  base_currency_code: string;
  total_bank_historical_in_base: number;
  total_budget_in_base: number;
  free_budget_in_base: number;
  bank_balances: DashboardBankBalance[];
  budget_categories: DashboardBudgetCategory[];
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

export interface ExchangeCurrencyRequest {
  bank_account_id: number;
  from_currency_code: string;
  from_amount: number;
  to_currency_code: string;
  to_amount: number;
  comment?: string;
}

export interface ExchangeCurrencyResponse {
  operation_id: number;
  effective_rate: number;
  realized_fx_result_in_base: number;
  base_currency_code: string;
}

export interface AllocateBudgetRequest {
  from_category_id: number;
  to_category_id: number;
  amount_in_base: number;
  comment?: string;
}

export interface AllocateBudgetResponse {
  operation_id: number;
}

export interface AllocateGroupBudgetRequest {
  from_category_id: number;
  group_id: number;
  amount_in_base: number;
  comment?: string;
}

export interface AllocateGroupBudgetResponse {
  operation_id: number;
  members_count: number;
}

export interface OperationHistoryBankEntry {
  currency_code: string;
  amount: number;
}

export interface OperationHistoryBudgetEntry {
  category_id: number;
  category_name: string;
  category_kind: string;
  currency_code: string;
  amount: number;
}

export interface OperationHistoryItem {
  operation_id: number;
  type: string;
  comment?: string | null;
  created_at: string;
  reversal_of_operation_id?: number | null;
  has_reversal: boolean;
  income_source_name?: string | null;
  bank_entries: OperationHistoryBankEntry[];
  budget_entries: OperationHistoryBudgetEntry[];
}

export interface OperationHistoryResponse {
  items: OperationHistoryItem[];
  total_count: number;
  limit: number;
  offset: number;
}

export interface ReverseOperationRequest {
  operation_id: number;
  comment?: string;
}

export interface ReverseOperationResponse {
  reversal_operation_id: number;
  reversed_operation_id: number;
}
