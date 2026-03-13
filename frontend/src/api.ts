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
} from './types';
import { getTelegramInitData, getTelegramUserId } from './telegram';

const API_BASE = '/api/v1';

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

  if (text.includes('Insufficient budget in category')) {
    return 'Недостаточно бюджета в категории';
  }

  if (text.includes('Expense category and bank account must have the same owner')) {
    return 'Выбран неподходящий счет для этой категории';
  }

  if (text.includes('Budget allocation across different owners is not supported')) {
    return 'Нельзя переводить между личными и семейными категориями';
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

export async function createFamily(name: string): Promise<CreateFamilyResponse> {
  return apiFetch<CreateFamilyResponse>('/family', {
    method: 'POST',
    body: JSON.stringify({ name }),
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
