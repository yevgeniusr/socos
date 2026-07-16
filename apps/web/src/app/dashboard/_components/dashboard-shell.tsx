"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { apiJson } from "@/lib/api-client";
import { getToken, getUser, logout, type StoredUser } from "@/lib/auth";

type ToastType = "success" | "error" | "info";

interface Stats {
  totalContacts: number;
  totalInteractions: number;
  xpProgress: number;
  xpNeeded: number;
  levelName: string;
}

interface DashboardStatsResponse {
  user: StoredUser | null;
  stats: Stats | null;
}

interface UpcomingRemindersResponse {
  reminders: Array<{ id: string }>;
  stats: { today: number; thisWeek: number; overdue: number };
}

interface DashboardContextValue {
  showToast: (message: string, type?: ToastType) => void;
  refreshDashboardStats: () => Promise<void>;
  refreshUpcomingReminders: () => Promise<void>;
  user: StoredUser | null;
  stats: Stats | null;
  upcomingCount: number;
  statsStatus: "loading" | "ready" | "error";
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard(): DashboardContextValue {
  const value = useContext(DashboardContext);
  if (!value)
    throw new Error("useDashboard must be used inside DashboardShell");
  return value;
}

function SymbolIcon({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}

function XpBar({ user, stats }: { user: StoredUser; stats: Stats }) {
  const progress = stats.xpProgress;
  const needed = stats.xpNeeded;
  const percent = needed > 0 ? Math.min((progress / needed) * 100, 100) : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[10px] font-bold uppercase text-on-surface-variant">
        <span className="text-secondary">Level {user.level}</span>
        <span>
          {progress} / {needed} XP
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-container-highest">
        <div
          className="h-full rounded-full bg-secondary xp-bar-glow transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function Toast({
  message,
  type,
  onClose,
}: {
  message: string;
  type: ToastType;
  onClose: () => void;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(onClose, 3200);
    return () => window.clearTimeout(timeout);
  }, [onClose]);

  const styles = {
    success: "bg-secondary text-on-secondary",
    error: "bg-error text-on-error",
    info: "bg-primary text-on-primary",
  };

  return (
    <div
      role="status"
      className={`fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-4 right-4 z-[80] rounded-lg px-4 py-3 text-sm font-semibold shadow-2xl sm:bottom-5 sm:left-auto sm:right-6 sm:max-w-sm ${styles[type]}`}
    >
      {message}
    </div>
  );
}

export default function DashboardShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState<StoredUser | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsStatus, setStatsStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [upcomingCount, setUpcomingCount] = useState(0);
  const [toast, setToast] = useState<{
    message: string;
    type: ToastType;
  } | null>(null);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    setToast({ message, type });
  }, []);

  const refreshDashboardStats = useCallback(async () => {
    setStatsStatus("loading");
    try {
      const response = await apiJson<DashboardStatsResponse>(
        "/api/gamification/stats"
      );
      if (response.user) setUser(response.user);
      setStats(response.stats);
      setStatsStatus("ready");
    } catch (error) {
      setStatsStatus("error");
      throw error;
    }
  }, []);

  const refreshUpcomingReminders = useCallback(async () => {
    const response = await apiJson<UpcomingRemindersResponse>(
      "/api/reminders/upcoming"
    );
    setUpcomingCount(response.reminders.length);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/auth/login");
      return;
    }
    setUser(getUser());
    setAuthenticated(true);
  }, [router]);

  useEffect(() => {
    if (!authenticated) return;
    void refreshDashboardStats().catch(() => undefined);
  }, [authenticated, refreshDashboardStats]);

  useEffect(() => {
    if (!authenticated) return;
    void refreshUpcomingReminders().catch(() => undefined);
  }, [authenticated, refreshUpcomingReminders]);

  const contextValue = useMemo(
    () => ({
      showToast,
      refreshDashboardStats,
      refreshUpcomingReminders,
      user,
      stats,
      upcomingCount,
      statsStatus,
    }),
    [
      refreshDashboardStats,
      refreshUpcomingReminders,
      showToast,
      stats,
      statsStatus,
      upcomingCount,
      user,
    ]
  );

  async function handleLogout() {
    await logout();
    router.replace("/auth/login");
  }

  if (!authenticated) {
    return (
      <div
        className="min-h-[100dvh] bg-surface"
        aria-label="Loading dashboard"
      />
    );
  }

  const navItems = [
    { label: "Today", icon: "today", href: "/dashboard/today" },
    { label: "Contacts", icon: "contacts", href: "/dashboard/contacts" },
    {
      label: "Approvals",
      icon: "approval",
      href: "/dashboard/approvals",
    },
    { label: "Calendar", icon: "calendar_month", disabled: true },
    { label: "Gamification", icon: "military_tech", disabled: true },
    { label: "Settings", icon: "settings", disabled: true },
  ];
  const statsReady = statsStatus === "ready" && user !== null && stats !== null;

  return (
    <DashboardContext.Provider value={contextValue}>
      <div className="flex min-h-[100dvh] bg-surface text-on-surface">
        <aside className="sticky top-0 hidden h-[100dvh] w-64 shrink-0 flex-col border-r border-outline-variant/20 bg-surface px-3 py-6 lg:flex">
          <Link
            href="/dashboard/today"
            className="mb-8 px-3 text-xl font-black text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            SOCOS
          </Link>
          <nav aria-label="Dashboard" className="flex-1 space-y-1">
            {navItems.map((item) => {
              const active = item.href ? pathname.startsWith(item.href) : false;
              if (item.href) {
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${active ? "bg-primary text-on-primary" : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"}`}
                  >
                    <SymbolIcon name={item.icon} className="text-[20px]" />
                    {item.label}
                  </Link>
                );
              }
              return (
                <button
                  key={item.label}
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold text-on-surface-variant opacity-50"
                >
                  <SymbolIcon name={item.icon} className="text-[20px]" />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="border-t border-outline-variant/20 px-2 pt-4">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-container-high font-bold text-primary">
                {user?.name?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">
                  {user?.name ?? "Account"}
                </p>
                <p className="text-[10px] text-on-surface-variant">
                  {statsStatus === "loading"
                    ? "Momentum loading..."
                    : statsReady
                      ? `${stats.levelName} / ${upcomingCount} reminders`
                      : "Momentum unavailable."}
                </p>
              </div>
            </div>
            {statsReady ? (
              <>
                <XpBar user={user} stats={stats} />
                <p className="mt-2 text-center text-[10px] text-on-surface-variant">
                  {stats.totalContacts} contacts / {user.xp} XP
                </p>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-lg text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high hover:text-error focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              <SymbolIcon name="logout" className="text-[18px]" />
              Sign out
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-outline-variant/20 bg-surface/95 px-4 backdrop-blur lg:hidden">
            <Link href="/dashboard/today" className="font-black text-primary">
              SOCOS
            </Link>
            <div className="flex items-center gap-1">
              <span className="mr-1 text-xs text-on-surface-variant">
                {statsStatus === "loading"
                  ? "Stats loading"
                  : statsReady
                    ? `Lv ${user.level}`
                    : "Stats unavailable"}
              </span>
              <button
                type="button"
                onClick={() => void handleLogout()}
                aria-label="Sign out"
                title="Sign out"
                className="flex size-11 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <SymbolIcon name="logout" className="text-[21px]" />
              </button>
            </div>
          </header>
          <div className="pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">
            {children}
          </div>
          <nav
            aria-label="Mobile dashboard"
            className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-outline-variant/30 bg-surface/98 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
          >
            {navItems.slice(0, 3).map((item) => {
              const active = item.href ? pathname.startsWith(item.href) : false;
              return (
                <Link
                  key={item.label}
                  href={item.href ?? "/dashboard/today"}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${active ? "text-primary" : "text-on-surface-variant"}`}
                >
                  <SymbolIcon name={item.icon} className="text-[21px]" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </DashboardContext.Provider>
  );
}
