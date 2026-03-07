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
