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
  operated_at?: string;
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
  operated_at?: string;
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
  bank_account_kind?: 'cash' | 'investment' | 'credit' | null;
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
  owner_type: 'user' | 'family';
  owner_user_id?: number | null;
  owner_family_id?: number | null;
  owner_name: string;
  account_kind: 'cash' | 'investment' | 'credit';
  investment_asset_type?: 'security' | 'deposit' | 'crypto' | null;
  credit_kind?: 'loan' | 'credit_card' | 'mortgage' | null;
  interest_rate?: number | null;
  payment_day?: number | null;
  credit_started_at?: string | null;
  credit_ends_at?: string | null;
  credit_limit?: number | null;
  provider_name?: string | null;
  provider_account_ref?: string | null;
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
}

export interface CreateBankAccountRequest {
  name: string;
  owner_type?: 'user' | 'family';
  account_kind?: 'cash' | 'investment';
  investment_asset_type?: 'security' | 'deposit' | 'crypto';
  provider_name?: string;
  provider_account_ref?: string;
}

export interface CreateCreditAccountRequest {
  name: string;
  credit_kind: 'loan' | 'credit_card' | 'mortgage';
  currency_code: string;
  credit_limit: number;
  target_account_id?: number;
  owner_type?: 'user' | 'family';
  interest_rate?: number;
  payment_day?: number;
  credit_started_at?: string;
  credit_ends_at?: string;
  provider_name?: string;
}

export interface UpdateCreditAccountRequest {
  name: string;
  credit_limit: number;
  interest_rate?: number | null;
  payment_day?: number | null;
  credit_started_at?: string | null;
  credit_ends_at?: string | null;
  provider_name?: string | null;
}

export interface CreditRepaymentRequest {
  from_account_id: number;
  currency_code: string;
  amount: number;
  comment?: string;
  payment_at?: string;
}

export interface CreditRepaymentResponse {
  operation_id: number;
  payment_amount: number;
  principal_paid: number;
  interest_paid: number;
  principal_before: number;
  principal_after: number;
  accrued_interest: number;
  amount_in_base: number;
  base_currency_code: string;
}

export interface CreditScheduleItem {
  operation_id?: number | null;
  scheduled_date: string;
  total_payment: number;
  principal_component: number;
  interest_component: number;
  principal_before: number;
  principal_after: number;
  status: 'paid' | 'planned';
}

export interface CreditAccountSummary {
  bank_account_id: number;
  name: string;
  credit_kind: 'loan' | 'credit_card' | 'mortgage';
  currency_code: string;
  principal_outstanding: number;
  accrued_interest: number;
  total_due_as_of: number;
  annual_rate?: number | null;
  payment_day?: number | null;
  credit_started_at?: string | null;
  credit_ends_at?: string | null;
  credit_limit?: number | null;
  last_accrual_date?: string | null;
  last_payment_at?: string | null;
  payments_count: number;
  paid_principal_total: number;
  paid_interest_total: number;
  as_of_date: string;
  schedule_available: boolean;
  remaining_payments: number;
  next_payment_date?: string | null;
  next_payment_total?: number | null;
  next_payment_principal?: number | null;
  next_payment_interest?: number | null;
}

export interface CreditAccountWithBalances {
  account: BankAccount;
  balances: DashboardBankBalance[];
}

export interface CreateBankAccountResponse extends BankAccount {}

export interface PortfolioPosition {
  id: number;
  investment_account_id: number;
  investment_account_name: string;
  investment_account_owner_type: 'user' | 'family';
  investment_account_owner_name: string;
  asset_type_code: string;
  title: string;
  status: 'open' | 'closed';
  quantity?: number | null;
  amount_in_currency: number;
  currency_code: string;
  opened_at: string;
  closed_at?: string | null;
  close_amount_in_currency?: number | null;
  close_currency_code?: string | null;
  comment?: string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: number;
  created_at: string;
}

export interface PortfolioEvent {
  id: number;
  position_id: number;
  event_type: 'open' | 'top_up' | 'partial_close' | 'close' | 'income' | 'fee' | 'adjustment';
  event_at: string;
  quantity?: number | null;
  amount?: number | null;
  currency_code?: string | null;
  linked_operation_id?: number | null;
  comment?: string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: number;
  created_at: string;
}

export interface CreatePortfolioPositionRequest {
  investment_account_id: number;
  asset_type_code: string;
  title: string;
  quantity?: number;
  amount_in_currency: number;
  currency_code: string;
  opened_at?: string;
  comment?: string;
  metadata?: Record<string, unknown>;
}

export interface TopUpPortfolioPositionRequest {
  amount_in_currency: number;
  currency_code: string;
  quantity?: number;
  topped_up_at?: string;
  comment?: string;
}

export interface ClosePortfolioPositionRequest {
  close_amount_in_currency: number;
  close_currency_code: string;
  close_amount_in_base?: number;
  closed_at?: string;
  comment?: string;
}

export interface PartialClosePortfolioPositionRequest {
  return_amount_in_currency: number;
  return_currency_code: string;
  principal_reduction_in_currency: number;
  return_amount_in_base?: number;
  closed_quantity?: number;
  closed_at?: string;
  comment?: string;
}

export interface RecordPortfolioIncomeRequest {
  amount: number;
  currency_code: string;
  amount_in_base?: number;
  income_kind?: string;
  received_at?: string;
  comment?: string;
}

export interface RecordPortfolioIncomeResponse {
  operation_id: number;
  amount_in_base: number;
  base_currency_code: string;
}

export interface RecordPortfolioFeeRequest {
  amount: number;
  currency_code: string;
  charged_at?: string;
  comment?: string;
}

export interface DeletePortfolioPositionResponse {
  status: 'deleted';
  position_id: number;
  operation_id: number;
}

export interface CancelPortfolioIncomeRequest {
  comment?: string;
}

export interface CancelPortfolioIncomeResponse {
  status: 'cancelled';
  event_id: number;
  operation_id: number;
}

export interface ChangeDepositRateRequest {
  new_rate: number;
  effective_date?: string;
  comment?: string;
}

export interface PortfolioSummaryItem {
  investment_account_id: number;
  investment_account_name: string;
  investment_account_owner_type: 'user' | 'family';
  investment_account_owner_name: string;
  cash_balance_in_base: number;
  invested_principal_in_base: number;
  realized_income_in_base: number;
  open_positions_count: number;
}

export interface PortfolioAnalyticsMonthlyItem {
  period: string;
  asset_type_code: string;
  investment_account_id: number;
  income_kind?: string;
  total_amount: number;
  events_count: number;
}

export interface PortfolioAnalyticsTotalByAssetType {
  asset_type_code: string;
  income_total: number;
  trade_total: number;
  adjustment_total: number;
  income_count: number;
  trade_count: number;
}

export interface PortfolioAnalyticsTotalByAccount {
  investment_account_id: number;
  account_name: string;
  owner_type: 'user' | 'family';
  owner_name: string;
  income_total: number;
  trade_total: number;
  adjustment_total: number;
  income_count: number;
  trade_count: number;
}

export interface PortfolioAnalyticsTotalByIncomeKind {
  income_kind: string;
  total_amount: number;
  events_count: number;
}

export interface PortfolioAnalyticsIncomeFeedItem {
  event_id: number;
  event_at: string;
  position_id: number;
  position_title: string;
  asset_type_code: string;
  investment_account_id: number;
  account_name: string;
  income_kind: string;
  amount_in_base: number;
  currency_code: string;
  amount_in_currency: number;
}

export interface PortfolioAnalyticsData {
  date_from: string;
  date_to: string;
  monthly_income: PortfolioAnalyticsMonthlyItem[];
  monthly_trades: PortfolioAnalyticsMonthlyItem[];
  monthly_adjustments: PortfolioAnalyticsMonthlyItem[];
  totals_by_asset_type: PortfolioAnalyticsTotalByAssetType[];
  totals_by_account: PortfolioAnalyticsTotalByAccount[];
  totals_by_income_kind: PortfolioAnalyticsTotalByIncomeKind[];
  income_feed: PortfolioAnalyticsIncomeFeedItem[];
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

export interface IncomePatternLine {
  id: number;
  bank_account_id: number;
  bank_account_name: string;
  bank_account_owner_type: string;
  share: number;
}

export interface IncomePattern {
  id: number;
  income_source_id: number;
  lines: IncomePatternLine[];
}

export interface RecordIncomeSplitRequest {
  income_source_id: number;
  amount: number;
  currency_code: string;
  budget_amount_in_base?: number;
  comment?: string;
  operated_at?: string;
}

export interface RecordIncomeSplitResponse {
  operation_ids: number[];
  total_budget_in_base: number;
  base_currency_code: string;
}

export interface CreateFamilyResponse {
  family_id: number;
  name: string;
  base_currency_code: string;
  bank_account_id: number;
  unallocated_category_id: number;
  fx_result_category_id: number;
}

// ── Tinkoff integration ──────────────────────────────────────────────────────

export interface TinkoffBrokerAccount {
  provider_account_id: string;
  name: string;
  type: string;
}

export interface ExternalConnection {
  id: number;
  provider: string;
  provider_account_id: string;
  linked_account_id: number | null;
  linked_account_name: string | null;
  last_synced_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface TinkoffDepositPreview {
  tinkoff_op_id: string;
  amount: number;
  currency_code: string;
  date: string;
  already_imported: boolean;
}

export interface TinkoffAutoOperationPreview {
  tinkoff_op_id: string;
  type: string;
  ticker: string;
  title?: string;
  figi: string;
  logo_name?: string;
  amount: number;
  quantity: number | null;
  currency_code: string;
  date: string;
  already_imported: boolean;
}

export interface TinkoffPreviewResponse {
  deposits: TinkoffDepositPreview[];
  withdrawals: TinkoffDepositPreview[];
  auto_operations: TinkoffAutoOperationPreview[];
  total_new: number;
  total_already_imported: number;
}

export type DepositResolutionKind = 'external' | 'transfer' | 'already_recorded';
export type WithdrawalResolutionKind = 'external' | 'transfer' | 'already_recorded';

export interface DepositResolution {
  tinkoff_op_id: string;
  resolution: DepositResolutionKind;
  source_account_id: number | null;
}

export interface WithdrawalResolution {
  tinkoff_op_id: string;
  resolution: WithdrawalResolutionKind;
  target_account_id: number | null;
}

export interface ApplyTinkoffSyncResponse {
  status: string;
  applied: number;
  skipped_already_imported: number;
}

export interface TinkoffLivePrice {
  position_id: number;
  price: number;
  clean_price?: number;
  currency_code: string;
  current_value: number;
  clean_current_value?: number;
  source: string;
}
