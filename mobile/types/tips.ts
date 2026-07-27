export type TipStatus = "success" | "pending" | "failed";

export type TipActivityRow = {
  id: string;
  amount: number;
  status: TipStatus | string;
  createdAt: string;
  employeeId: string;
  locationId: string | null;
  tableId: string | null;
  staffName: string | null;
  locationName: string | null;
  tableName: string | null;
};

export type TipListResult = {
  timezone?: string;
  total: number;
  items: TipActivityRow[];
};

export type TipListParams = {
  take?: number;
  skip?: number;
  q?: string;
  status?: TipStatus;
  range?: "today" | "week" | "month" | "custom";
  fromDate?: string;
  toDate?: string;
  employeeId?: string;
  locationId?: string;
  tableId?: string;
};
