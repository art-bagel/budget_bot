import type {
  UserContext,
  Category,
  Currency,
  DashboardOverview,
  GroupMember,
  IncomeSource,
  AllocateBudgetRequest,
  AllocateBudgetResponse,
  AllocateGroupBudgetRequest,
  AllocateGroupBudgetResponse,
  OperationHistoryResponse,
  RecordExpenseRequest,
  RecordExpenseResponse,
  RecordIncomeRequest,
  RecordIncomeResponse,
} from './types';

const API_BASE = '/api/v1';

function getTelegramUserId(): string {
  // Telegram WebApp — будет window.Telegram.WebApp.initDataUnsafe.user.id
  // Локальная разработка — фиксированный тестовый id
  return '1';
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Telegram-User-Id': getTelegramUserId(),
    ...(init?.headers as Record<string, string> || {}),
  };

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `API error: ${response.status}`);
  }
  return response.json();
}

export async function register(baseCurrencyCode: string): Promise<UserContext> {
  return apiFetch<UserContext>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ base_currency_code: baseCurrencyCode }),
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

export async function createCategory(name: string, kind: string): Promise<{ id: number }> {
  return apiFetch<{ id: number }>('/categories', {
    method: 'POST',
    body: JSON.stringify({ name, kind }),
  });
}

export async function fetchGroupMembers(groupId: number): Promise<GroupMember[]> {
  return apiFetch<GroupMember[]>(`/groups/${groupId}/members`);
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
