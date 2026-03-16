export interface UserContext {
  status: string;
  user_id: number;
  bank_account_id: number;
  unallocated_category_id: number;
  fx_result_category_id: number;
  base_currency_code: string;
  hints_enabled: boolean;
}

export interface Category {
  id: number;
  name: string;
  kind: string;
  owner_type: string;
  owner_name?: string | null;
  is_active: boolean;
  created_at: string;
}

export interface GroupMember {
  child_category_id: number;
  child_category_name: string;
  child_category_kind: string;
  share: number;
}

export interface ParentGroup {
  group_id: number;
  group_name: string;
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
  owner_type: string;
  owner_user_id?: number | null;
  owner_family_id?: number | null;
  balance: number;
  currency_code: string;
}

export interface DashboardOverview {
  base_currency_code: string;
  total_bank_historical_in_base: number;
  total_budget_in_base: number;
  free_budget_in_base: number;
  fx_result_in_base: number;
  bank_balances: DashboardBankBalance[];
  budget_categories: DashboardBudgetCategory[];
  has_family: boolean;
  personal_free_budget_in_base: number;
  family_free_budget_in_base: number;
  family_unallocated_category_id: number | null;
  family_bank_account_id: number | null;
  family_bank_balances: DashboardBankBalance[];
}

export interface AccountTransferRequest {
  from_account_id: number;
  to_account_id: number;
  currency_code: string;
  amount: number;
  comment?: string;
}

export interface AccountTransferResponse {
  operation_id: number;
  amount_in_base: number;
  base_currency_code: string;
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
  bank_account_id: number;
  bank_account_name?: string | null;
  bank_account_owner_type?: string | null;
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

export interface OperationAnalyticsItem {
  entry_key: string;
  label: string;
  owner_type: 'user' | 'family';
  amount: number;
  operations_count: number;
}

export interface OperationAnalyticsMonth {
  period_start: string;
  amount: number;
  is_selected: boolean;
}

export interface OperationAnalyticsResponse {
  period_start: string;
  period_mode: 'week' | 'month' | 'year';
  operation_type: 'expense' | 'income';
  owner_scope: 'all' | 'user' | 'family';
  base_currency_code: string;
  has_family: boolean;
  total_amount: number;
  total_operations: number;
  items: OperationAnalyticsItem[];
  periods: OperationAnalyticsMonth[];
}

export interface ReverseOperationRequest {
  operation_id: number;
  comment?: string;
}

export interface ReverseOperationResponse {
  reversal_operation_id: number;
  reversed_operation_id: number;
}

export interface FamilyInfo {
  family_id: number;
  name: string;
  base_currency_code: string;
  created_by_user_id: number;
  created_at: string;
}

export interface FamilyMember {
  user_id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  role: 'owner' | 'member';
  joined_at: string;
}

export interface FamilyInvitation {
  invitation_id: number;
  family_id: number;
  family_name: string;
  invited_by_user_id: number;
  invited_by_username?: string | null;
  status: string;
  created_at: string;
  responded_at?: string | null;
}

export interface BankAccount {
  id: number;
  name: string;
  owner_type: string;
  owner_user_id?: number | null;
  owner_family_id?: number | null;
  owner_name: string;
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
}

export interface ScheduledExpense {
  id: number;
  category_id: number;
  amount: number;
  currency_code: string;
  comment: string | null;
  frequency: 'weekly' | 'monthly';
  day_of_week: number | null;
  day_of_month: number | null;
  next_run_at: string;
  last_run_at: string | null;
  last_error: string | null;
  is_active: boolean;
}

export interface AccountCurrency {
  code: string;
  amount: number;
}

export interface CreateScheduledExpenseRequest {
  category_id: number;
  amount: number;
  currency_code: string;
  frequency: 'weekly' | 'monthly';
  day_of_week?: number;
  day_of_month?: number;
  comment?: string;
}

export interface CreateScheduledExpenseResponse {
  id: number;
  next_run_at: string;
}

export interface CreateFamilyResponse {
  family_id: number;
  name: string;
  base_currency_code: string;
  bank_account_id: number;
  unallocated_category_id: number;
  fx_result_category_id: number;
}
