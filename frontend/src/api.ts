import type {
  UserContext,
  Category,
  Currency,
  DashboardOverview,
  GroupMember,
  IncomeSource,
  ParentGroup,
  AllocateBudgetRequest,
  AllocateBudgetResponse,
  AllocateGroupBudgetRequest,
  AllocateGroupBudgetResponse,
  OperationHistoryResponse,
  OperationAnalyticsResponse,
  RecordExpenseRequest,
  RecordExpenseResponse,
  ExchangeCurrencyRequest,
  ExchangeCurrencyResponse,
  RecordIncomeRequest,
  RecordIncomeResponse,
  ReverseOperationRequest,
  ReverseOperationResponse,
  FamilyInfo,
  FamilyMember,
  FamilyInvitation,
  CreateFamilyResponse,
  AccountTransferRequest,
  AccountTransferResponse,
  ScheduledExpense,
  CreateScheduledExpenseRequest,
  CreateScheduledExpenseResponse,
  AccountCurrency,
  BankAccount,
  IncomePattern,
  RecordIncomeSplitRequest,
  RecordIncomeSplitResponse,
  CreateBankAccountRequest,
  CreateCreditAccountRequest,
  DashboardBankBalance,
  PortfolioPosition,
  PortfolioEvent,
  CreatePortfolioPositionRequest,
  TopUpPortfolioPositionRequest,
  ClosePortfolioPositionRequest,
  PartialClosePortfolioPositionRequest,
  RecordPortfolioIncomeRequest,
  RecordPortfolioIncomeResponse,
  RecordPortfolioFeeRequest,
  DeletePortfolioPositionResponse,
  CancelPortfolioIncomeRequest,
  CancelPortfolioIncomeResponse,
  PortfolioSummaryItem,
  PortfolioAnalyticsData,
  TinkoffBrokerAccount,
  ExternalConnection,
  TinkoffPreviewResponse,
  DepositResolution,
  WithdrawalResolution,
  ApplyTinkoffSyncResponse,
  TinkoffLivePrice,
} from './types';
import { getTelegramInitData, getTelegramUserId } from './telegram';

const API_BASE = '/api/v1';

export function getTinkoffInstrumentLogoUrl(logoName: string): string {
  return `${API_BASE}/tinkoff/instrument-logo/${encodeURIComponent(logoName)}`;
}

function normalizeApiErrorMessage(rawText: string, status: number): string {
  const text = rawText.trim().replace(/^"(.*)"$/s, '$1');

  if (
    text.includes('Сумма превышает остаток')
    || text.includes('Insufficient bank balance')
    || text.includes('Insufficient balance')
    || text.includes('Insufficient FX lots')
  ) {
    return 'Недостаточно денег';
  }

  if (text.includes('Credit limit exceeded') || text.includes('Превышен кредитный лимит')) {
    return 'Превышен кредитный лимит';
  }

  if (text.includes('Credit limit is not configured')) {
    return 'Кредитный лимит не настроен для этого счёта';
  }

  if (text.includes('Insufficient budget in category')) {
    return 'Недостаточно бюджета в категории';
  }

  if (text.includes('Expense category and bank account must have the same owner')) {
    return 'Выбран неподходящий счет для этой категории';
  }

  if (text.includes('Budget allocation across different owners is not supported')) {
    return 'Нельзя переводить между личными и семейными категориями';
  }

  if (
    text.includes('UNAUTHENTICATED')
    || text.includes('invalid token')
    || text.includes('Invalid token')
    || text.includes('token is invalid')
  ) {
    return 'Неверный токен Тинькофф — проверь и переподключи';
  }

  if (
    text.includes('Connection not found')
    || text.includes('not found or not accessible')
  ) {
    return 'Подключение не найдено';
  }

  if (text.includes('Cannot delete user account while user belongs to a family')) {
    return 'Сначала выйдите из семьи или распустите её, затем удалите аккаунт';
  }

  if (text.includes('Family owner cannot leave')) {
    return 'Владелец семьи не может выйти: сначала распустите семью';
  }

  if (text.includes('source_account_id required')) {
    return 'Не выбран счёт для перевода';
  }

  if (text.includes('target_account_id required')) {
    return 'Не выбран счёт для зачисления';
  }

  if (text.includes('Insufficient investment balance') || text.includes('investment account balance')) {
    return 'Недостаточно средств на инвестиционном счёте';
  }

  if (text) {
    return text;
  }

  return `Ошибка API: ${status}`;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const telegramInitData = getTelegramInitData();
  const telegramUserId = getTelegramUserId();

  if (!telegramInitData && !telegramUserId) {
    throw new Error('Открой приложение внутри Telegram WebApp или укажи VITE_DEV_TELEGRAM_USER_ID для локальной разработки.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> || {}),
  };

  if (telegramInitData) {
    headers['X-Telegram-Init-Data'] = telegramInitData;
  } else if (telegramUserId) {
    headers['X-Telegram-User-Id'] = telegramUserId;
  }

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    const text = await response.text();
    let errorText = text;

    try {
      const parsed = JSON.parse(text) as { detail?: unknown };
      if (typeof parsed.detail === 'string') {
        errorText = parsed.detail;
      }
    } catch {
      // Plain text error response is also valid.
    }

    throw new Error(normalizeApiErrorMessage(errorText, response.status));
  }
  return response.json();
}

export async function register(baseCurrencyCode: string): Promise<UserContext> {
  return apiFetch<UserContext>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ base_currency_code: baseCurrencyCode }),
  });
}

export async function deleteAccount(): Promise<{ status: string; user_id: number }> {
  return apiFetch<{ status: string; user_id: number }>('/auth/account', {
    method: 'DELETE',
  });
}

export async function fetchCurrencies(): Promise<Currency[]> {
  return apiFetch<Currency[]>('/currencies');
}

export async function fetchCategories(): Promise<Category[]> {
  return apiFetch<Category[]>('/categories');
}

export async function fetchDashboardOverview(bankAccountId: number): Promise<DashboardOverview> {
  return apiFetch<DashboardOverview>(`/dashboard/overview?bank_account_id=${bankAccountId}`);
}

export async function createCategory(name: string, kind: string, ownerType: 'user' | 'family' = 'user'): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/categories', {
    method: 'POST',
    body: JSON.stringify({ name, kind, owner_type: ownerType }),
  });
}

export async function updateCategory(categoryId: number, name: string): Promise<Category> {
  return apiFetch<Category>(`/categories/${categoryId}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}

export async function fetchGroupMembers(groupId: number): Promise<GroupMember[]> {
  return apiFetch<GroupMember[]>(`/groups/${groupId}/members`);
}

export async function fetchCategoryParentGroups(categoryId: number): Promise<ParentGroup[]> {
  return apiFetch<ParentGroup[]>(`/categories/${categoryId}/parent-groups`);
}

export async function replaceGroupMembers(
  groupId: number,
  childCategoryIds: number[],
  shares: number[],
): Promise<{ group_id: number; members_count: number }> {
  return apiFetch<{ group_id: number; members_count: number }>('/groups/members', {
    method: 'PUT',
    body: JSON.stringify({
      group_id: groupId,
      child_category_ids: childCategoryIds,
      shares,
    }),
  });
}

export async function fetchIncomeSources(): Promise<IncomeSource[]> {
  return apiFetch<IncomeSource[]>('/income-sources');
}

export async function createIncomeSource(name: string): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/income-sources', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function recordIncome(data: RecordIncomeRequest): Promise<RecordIncomeResponse> {
  return apiFetch<RecordIncomeResponse>('/operations/income', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function recordExpense(data: RecordExpenseRequest): Promise<RecordExpenseResponse> {
  return apiFetch<RecordExpenseResponse>('/operations/expense', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function exchangeCurrency(data: ExchangeCurrencyRequest): Promise<ExchangeCurrencyResponse> {
  return apiFetch<ExchangeCurrencyResponse>('/operations/exchange', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function allocateBudget(data: AllocateBudgetRequest): Promise<AllocateBudgetResponse> {
  return apiFetch<AllocateBudgetResponse>('/operations/allocate', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function allocateGroupBudget(
  data: AllocateGroupBudgetRequest,
): Promise<AllocateGroupBudgetResponse> {
  return apiFetch<AllocateGroupBudgetResponse>('/operations/allocate-group', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchOperationsHistory(
  limit = 20,
  offset = 0,
  operationType?: string,
): Promise<OperationHistoryResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });

  if (operationType) {
    params.set('operation_type', operationType);
  }

  return apiFetch<OperationHistoryResponse>(`/operations/history?${params.toString()}`);
}

export async function fetchOperationsAnalytics(
  anchorDate: string,
  periodMode: 'week' | 'month' | 'year',
  operationType: 'expense' | 'income',
  ownerScope: 'all' | 'user' | 'family',
  periods = 6,
): Promise<OperationAnalyticsResponse> {
  const params = new URLSearchParams({
    anchor_date: anchorDate,
    period_mode: periodMode,
    operation_type: operationType,
    owner_scope: ownerScope,
    periods: String(periods),
  });

  return apiFetch<OperationAnalyticsResponse>(`/operations/analytics?${params.toString()}`);
}

export async function reverseOperation(data: ReverseOperationRequest): Promise<ReverseOperationResponse> {
  return apiFetch<ReverseOperationResponse>('/operations/reverse', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function archiveCategory(categoryId: number): Promise<{ category_id: number; kind: string; name: string; is_active: boolean }> {
  return apiFetch<{ category_id: number; kind: string; name: string; is_active: boolean }>(`/categories/${categoryId}/archive`, {
    method: 'POST',
  });
}

export async function updateUserSettings(
  params: { hintsEnabled?: boolean; theme?: string },
): Promise<{ hints_enabled: boolean; theme: string }> {
  const body: Record<string, unknown> = {};
  if (params.hintsEnabled !== undefined) body.hints_enabled = params.hintsEnabled;
  if (params.theme !== undefined) body.theme = params.theme;
  return apiFetch<{ hints_enabled: boolean; theme: string }>('/user/settings', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function fetchMyFamily(): Promise<FamilyInfo | null> {
  try {
    return await apiFetch<FamilyInfo | null>('/family/me');
  } catch {
    return null;
  }
}

export async function createFamily(): Promise<CreateFamilyResponse> {
  return apiFetch<CreateFamilyResponse>('/family', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function fetchFamilyMembers(): Promise<FamilyMember[]> {
  return apiFetch<FamilyMember[]>('/family/members');
}

export async function fetchFamilyInvitations(): Promise<FamilyInvitation[]> {
  return apiFetch<FamilyInvitation[]>('/family/invitations');
}

export async function inviteToFamily(username: string): Promise<{ invitation_id: number; family_id: number; invited_user_id: number; status: string }> {
  return apiFetch('/family/invite', {
    method: 'POST',
    body: JSON.stringify({ username }),
  });
}

export async function acceptInvitation(invitationId: number): Promise<{ invitation_id: number; family_id: number; status: string }> {
  return apiFetch(`/family/invitations/${invitationId}/accept`, { method: 'POST' });
}

export async function declineInvitation(invitationId: number): Promise<{ invitation_id: number; family_id: number; status: string }> {
  return apiFetch(`/family/invitations/${invitationId}/decline`, { method: 'POST' });
}

export async function leaveFamily(): Promise<{ status: string; user_id: number; family_id: number }> {
  return apiFetch('/family/leave', { method: 'POST' });
}

export async function dissolveFamily(): Promise<{ status: string; family_id: number; dissolved_by_user_id: number }> {
  return apiFetch('/family/dissolve', { method: 'POST' });
}

export async function transferBetweenAccounts(data: AccountTransferRequest): Promise<AccountTransferResponse> {
  return apiFetch<AccountTransferResponse>('/operations/account-transfer', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchCategoryAccountCurrencies(categoryId: number): Promise<AccountCurrency[]> {
  return apiFetch<AccountCurrency[]>(`/scheduled-expenses/category/${categoryId}/currencies`);
}

export async function fetchScheduledExpenses(categoryId: number): Promise<ScheduledExpense[]> {
  return apiFetch<ScheduledExpense[]>(`/scheduled-expenses/?category_id=${categoryId}`);
}

export async function createScheduledExpense(
  data: CreateScheduledExpenseRequest,
): Promise<CreateScheduledExpenseResponse> {
  return apiFetch<CreateScheduledExpenseResponse>('/scheduled-expenses/', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchBankAccounts(
  accountKind: 'cash' | 'investment' | 'credit' = 'cash',
): Promise<BankAccount[]> {
  return apiFetch<BankAccount[]>(`/bank-accounts?account_kind=${accountKind}`);
}

export async function createBankAccount(data: CreateBankAccountRequest): Promise<BankAccount> {
  return apiFetch<BankAccount>('/bank-accounts', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function createCreditAccount(data: CreateCreditAccountRequest): Promise<BankAccount> {
  return apiFetch<BankAccount>('/bank-accounts/credit', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function archiveCreditAccount(bankAccountId: number): Promise<{ bank_account_id: number; name: string; is_active: boolean }> {
  return apiFetch(`/bank-accounts/credit/${bankAccountId}/archive`, { method: 'POST' });
}

export async function fetchBankAccountSnapshot(bankAccountId: number): Promise<DashboardBankBalance[]> {
  return apiFetch<DashboardBankBalance[]>(`/bank-accounts/${bankAccountId}/snapshot`);
}

export async function fetchPortfolioPositions(
  status?: 'open' | 'closed',
  investmentAccountId?: number,
): Promise<PortfolioPosition[]> {
  const params = new URLSearchParams();

  if (status) {
    params.set('status', status);
  }

  if (investmentAccountId) {
    params.set('investment_account_id', String(investmentAccountId));
  }

  const query = params.toString();
  return apiFetch<PortfolioPosition[]>(`/portfolio/positions${query ? `?${query}` : ''}`);
}

export async function fetchPortfolioSummary(): Promise<PortfolioSummaryItem[]> {
  return apiFetch<PortfolioSummaryItem[]>('/portfolio/summary');
}

export async function createPortfolioPosition(
  data: CreatePortfolioPositionRequest,
): Promise<PortfolioPosition> {
  return apiFetch<PortfolioPosition>('/portfolio/positions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function topUpPortfolioPosition(
  positionId: number,
  data: TopUpPortfolioPositionRequest,
): Promise<PortfolioPosition> {
  return apiFetch<PortfolioPosition>(`/portfolio/positions/${positionId}/top-up`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function closePortfolioPosition(
  positionId: number,
  data: ClosePortfolioPositionRequest,
): Promise<PortfolioPosition> {
  return apiFetch<PortfolioPosition>(`/portfolio/positions/${positionId}/close`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function partialClosePortfolioPosition(
  positionId: number,
  data: PartialClosePortfolioPositionRequest,
): Promise<PortfolioPosition> {
  return apiFetch<PortfolioPosition>(`/portfolio/positions/${positionId}/partial-close`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchPortfolioAnalytics(dateFrom: string, dateTo: string): Promise<PortfolioAnalyticsData> {
  return apiFetch<PortfolioAnalyticsData>(`/portfolio/analytics?date_from=${dateFrom}&date_to=${dateTo}`);
}

export async function fetchPortfolioEvents(positionId: number): Promise<PortfolioEvent[]> {
  return apiFetch<PortfolioEvent[]>(`/portfolio/positions/${positionId}/events`);
}

export async function recordPortfolioIncome(
  positionId: number,
  data: RecordPortfolioIncomeRequest,
): Promise<RecordPortfolioIncomeResponse> {
  return apiFetch<RecordPortfolioIncomeResponse>(`/portfolio/positions/${positionId}/income`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function recordPortfolioFee(
  positionId: number,
  data: RecordPortfolioFeeRequest,
): Promise<PortfolioPosition> {
  return apiFetch<PortfolioPosition>(`/portfolio/positions/${positionId}/fee`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deletePortfolioPosition(
  positionId: number,
): Promise<DeletePortfolioPositionResponse> {
  return apiFetch<DeletePortfolioPositionResponse>(`/portfolio/positions/${positionId}`, {
    method: 'DELETE',
  });
}

export async function cancelPortfolioIncome(
  eventId: number,
  data: CancelPortfolioIncomeRequest = {},
): Promise<CancelPortfolioIncomeResponse> {
  return apiFetch<CancelPortfolioIncomeResponse>(`/portfolio/events/${eventId}/cancel`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchIncomeSourcePattern(incomeSourceId: number): Promise<IncomePattern | null> {
  return apiFetch<IncomePattern | null>(`/income-sources/${incomeSourceId}/pattern`);
}

export async function upsertIncomeSourcePattern(
  incomeSourceId: number,
  lines: { bank_account_id: number; share: number }[],
): Promise<{ id: number }> {
  return apiFetch<{ id: number }>(`/income-sources/${incomeSourceId}/pattern`, {
    method: 'PUT',
    body: JSON.stringify({ lines }),
  });
}

export async function deleteIncomeSourcePattern(incomeSourceId: number): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/income-sources/${incomeSourceId}/pattern`, {
    method: 'DELETE',
  });
}

export async function recordIncomeSplit(data: RecordIncomeSplitRequest): Promise<RecordIncomeSplitResponse> {
  return apiFetch<RecordIncomeSplitResponse>('/operations/income-split', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteScheduledExpense(
  scheduleId: number,
): Promise<{ status: string; id: number }> {
  return apiFetch<{ status: string; id: number }>(`/scheduled-expenses/${scheduleId}`, {
    method: 'DELETE',
  });
}

// ── Tinkoff integration ──────────────────────────────────────────────────────

export async function getTinkoffAccounts(token: string): Promise<TinkoffBrokerAccount[]> {
  return apiFetch<TinkoffBrokerAccount[]>('/tinkoff/accounts', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export async function connectTinkoff(
  token: string,
  providerAccountId: string,
  linkedAccountId: number,
): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/tinkoff/connect', {
    method: 'POST',
    body: JSON.stringify({
      token,
      provider_account_id: providerAccountId,
      linked_account_id: linkedAccountId,
    }),
  });
}

export async function getTinkoffConnections(): Promise<ExternalConnection[]> {
  return apiFetch<ExternalConnection[]>('/tinkoff/connections');
}

export async function deleteTinkoffConnection(connectionId: number): Promise<{ status: string; id: number }> {
  return apiFetch<{ status: string; id: number }>(`/tinkoff/connections/${connectionId}`, {
    method: 'DELETE',
  });
}

export async function previewTinkoffSync(connectionId: number): Promise<TinkoffPreviewResponse> {
  return apiFetch<TinkoffPreviewResponse>(`/tinkoff/preview/${connectionId}`);
}

export async function applyTinkoffSync(
  connectionId: number,
  depositResolutions: DepositResolution[],
  withdrawalResolutions: WithdrawalResolution[],
): Promise<ApplyTinkoffSyncResponse> {
  return apiFetch<ApplyTinkoffSyncResponse>(`/tinkoff/apply/${connectionId}`, {
    method: 'POST',
    body: JSON.stringify({
      deposit_resolutions: depositResolutions,
      withdrawal_resolutions: withdrawalResolutions,
    }),
  });
}

export async function fetchTinkoffLivePrices(): Promise<TinkoffLivePrice[]> {
  return apiFetch<TinkoffLivePrice[]>('/tinkoff/live-prices');
}
