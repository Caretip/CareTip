import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";

export interface TipFlowState {
  businessId: string | null;
  employeeId: string | null;
  employeeName: string | null;
  employeeAvatar: string | null;
  /** When customer started from `/staff/:slug` public profile — used for post-tip navigation */
  staffProfileSlug: string | null;
  /** When customer started from `/{businessSlug}/{employeeSlug}` — used for back navigation */
  staffTipReturnBusinessSlug: string | null;
  staffTipReturnEmployeeSlug: string | null;
  /** Table QR flow: optional venue for reporting and UI */
  locationId: string | null;
  tableId: string | null;
  tippingLocationName: string | null;
  tippingTableName: string | null;
  /** Slug segment for `/table/:qrSlug` (back navigation) */
  tableQrSlug: string | null;
  amount: number | null;
  billAmount: number;
}

export interface TippingVenuePayload {
  locationId: string;
  locationName: string;
  tableId?: string | null;
  tableName?: string | null;
  qrSlug?: string | null;
}

interface TipFlowContextValue extends TipFlowState {
  setBusinessId: (id: string | null) => void;
  setEmployee: (id: string, name: string, avatar?: string) => void;
  setStaffProfileSlug: (slug: string | null) => void;
  setStaffTipReturnPath: (businessSlug: string | null, employeeSlug: string | null) => void;
  setTippingVenue: (venue: TippingVenuePayload | null) => void;
  setAmount: (amount: number) => void;
  setBillAmount: (amount: number) => void;
  reset: () => void;
}

const defaultState: TipFlowState = {
  businessId: null,
  employeeId: null,
  employeeName: null,
  employeeAvatar: null,
  staffProfileSlug: null,
  staffTipReturnBusinessSlug: null,
  staffTipReturnEmployeeSlug: null,
  locationId: null,
  tableId: null,
  tippingLocationName: null,
  tippingTableName: null,
  tableQrSlug: null,
  amount: null,
  billAmount: 85,
};

const TipFlowContext = createContext<TipFlowContextValue | null>(null);

export function TipFlowProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TipFlowState>(defaultState);

  const setBusinessId = useCallback((id: string | null) => {
    setState((prev) => ({ ...prev, businessId: id }));
  }, []);

  const setEmployee = useCallback(
    (id: string, name: string, avatar?: string) => {
      setState((prev) => ({
        ...prev,
        employeeId: id,
        employeeName: name,
        employeeAvatar: avatar ?? prev.employeeAvatar,
      }));
    },
    []
  );

  const setStaffProfileSlug = useCallback((slug: string | null) => {
    setState((prev) => ({
      ...prev,
      staffProfileSlug: slug,
      staffTipReturnBusinessSlug: null,
      staffTipReturnEmployeeSlug: null,
    }));
  }, []);

  const setStaffTipReturnPath = useCallback((businessSlug: string | null, employeeSlug: string | null) => {
    setState((prev) => ({
      ...prev,
      staffTipReturnBusinessSlug: businessSlug,
      staffTipReturnEmployeeSlug: employeeSlug,
      staffProfileSlug: employeeSlug,
    }));
  }, []);

  const setTippingVenue = useCallback((venue: TippingVenuePayload | null) => {
    setState((prev) =>
      venue
        ? {
            ...prev,
            locationId: venue.locationId,
            tableId: venue.tableId ?? null,
            tippingLocationName: venue.locationName,
            tippingTableName: venue.tableName ?? null,
            tableQrSlug: venue.qrSlug ?? null,
          }
        : {
            ...prev,
            locationId: null,
            tableId: null,
            tippingLocationName: null,
            tippingTableName: null,
            tableQrSlug: null,
          }
    );
  }, []);

  const setAmount = useCallback((amount: number) => {
    setState((prev) => ({ ...prev, amount }));
  }, []);

  const setBillAmount = useCallback((amount: number) => {
    setState((prev) => ({ ...prev, billAmount: amount }));
  }, []);

  const reset = useCallback(() => {
    setState(defaultState);
  }, []);

  const value = useMemo<TipFlowContextValue>(
    () => ({
      ...state,
      setBusinessId,
      setEmployee,
      setStaffProfileSlug,
      setStaffTipReturnPath,
      setTippingVenue,
      setAmount,
      setBillAmount,
      reset,
    }),
    [
      state,
      setBusinessId,
      setEmployee,
      setStaffProfileSlug,
      setStaffTipReturnPath,
      setTippingVenue,
      setAmount,
      setBillAmount,
      reset,
    ],
  );

  return (
    <TipFlowContext.Provider value={value}>{children}</TipFlowContext.Provider>
  );
}

export function useTipFlow() {
  const ctx = useContext(TipFlowContext);
  if (!ctx) {
    throw new Error("useTipFlow must be used within TipFlowProvider");
  }
  return ctx;
}

export function useTipFlowOptional() {
  return useContext(TipFlowContext);
}
