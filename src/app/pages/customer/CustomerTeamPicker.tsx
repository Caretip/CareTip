import { Search } from "lucide-react";
import { ProfileAvatar } from "../../components/ui/profile-avatar";
import { customerFlowUi as cf } from "./customerFlowUi";

export type CustomerTeamPickerEmployee = {
  id: string;
  name: string;
  jobTitle?: string | null;
  avatar?: string | null;
};

type CustomerTeamPickerProps<T extends CustomerTeamPickerEmployee> = {
  searchLabel: string;
  searchPlaceholder: string;
  teamLabel: string;
  emptyLabel: string;
  tipButtonLabel: string;
  tipButtonAria: (employeeName: string) => string;
  query: string;
  onQueryChange: (value: string) => void;
  employees: T[];
  onPick: (employee: T) => void;
};

/** Search + surface-level employee grid — no Team card, no employee cards. */
export function CustomerTeamPicker<T extends CustomerTeamPickerEmployee>({
  searchLabel,
  searchPlaceholder,
  teamLabel,
  emptyLabel,
  tipButtonLabel,
  tipButtonAria,
  query,
  onQueryChange,
  employees,
  onPick,
}: CustomerTeamPickerProps<T>) {
  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="customer-team-search" className={cf.surfaceSectionLabel}>
          {searchLabel}
        </label>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            id="customer-team-search"
            type="search"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className={`${cf.inputField} pl-11`}
            autoComplete="off"
          />
        </div>
      </div>

      <div>
        <h2 className={cf.surfaceSectionLabel}>{teamLabel}</h2>
        {employees.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ul
            className="mt-4 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 sm:gap-x-5 sm:gap-y-8 lg:gap-x-8 lg:gap-y-10"
            data-customer-team
          >
            {employees.map((emp) => (
              <li key={emp.id} className="flex min-w-0 flex-col items-center text-center">
                <ProfileAvatar
                  src={emp.avatar}
                  displayName={emp.name}
                  variant="square"
                  lightbox={false}
                  className={cf.employeeGridPhoto}
                />
                <span className="mt-2.5 w-full truncate text-sm font-semibold leading-tight text-foreground">
                  {emp.name}
                </span>
                {emp.jobTitle ? (
                  <span className="mt-0.5 w-full truncate text-xs leading-snug text-muted-foreground">
                    {emp.jobTitle}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => onPick(emp)}
                  className={cf.employeeTipCta}
                  aria-label={tipButtonAria(emp.name)}
                >
                  {tipButtonLabel}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
