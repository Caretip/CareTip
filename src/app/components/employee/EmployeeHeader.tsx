import { Link } from "react-router";
import { Bell, Settings, LogOut } from "lucide-react";
import type { User } from "../../hooks/useAuth";
import { EmployeeProfilePhoto } from "../ui/profile-avatar";

const TEAL = "#e9781c";

interface EmployeeHeaderProps {
  user: User;
  onLogout: () => void;
}

export function EmployeeHeader({ user, onLogout }: EmployeeHeaderProps) {
  return (
    <div className="bg-gradient-to-br from-primary to-accent text-white sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="shrink-0" style={{ boxShadow: `0 0 0 2px ${TEAL}` }}>
              <EmployeeProfilePhoto
                src={user.avatar}
                displayName={user.name ?? "Employee"}
                className="h-12 w-12 ring-0"
              />
            </div>
            <div>
              <h1 className="text-xl font-bold">{user.name ?? "Employee"}</h1>
              <p className="text-sm text-white/80">Staff • Caretip</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/employee/inbox"
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              aria-label="Inbox"
            >
              <Bell className="w-6 h-6" />
            </Link>
            <Link
              to="/employee/settings"
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              aria-label="Settings"
            >
              <Settings className="w-6 h-6" />
            </Link>
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-sm font-medium"
            >
              <LogOut className="w-5 h-5" />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
