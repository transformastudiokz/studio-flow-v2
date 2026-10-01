import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  Home,
  Users,
  Calendar,
  CreditCard,
  ClipboardCheck,
  UserCog,
  Settings,
  LogOut,
  Megaphone,
  Percent,
  Globe,
  Tags,
  Dumbbell,
  DollarSign,
  ScrollText,
  UserRoundPlus,
  WalletCards,
  UsersRound,
  HandCoins,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { useCurrentProfile } from "@/hooks/use-current-profile";
import { formatResponsibleShortName } from "@/lib/person-name";

// ВАЖНО: Используем "export const", чтобы соответствовать import { Sidebar } в AdminLayout
export const Sidebar = () => {
  const location = useLocation();
  const { data: currentProfile, isLoading: isProfileLoading } = useCurrentProfile();
  const currentUserRole = currentProfile?.role;
  const accountName = isProfileLoading
    ? "Загрузка…"
    : currentProfile
      ? formatResponsibleShortName(currentProfile)
      : "Сотрудник";
  const roleLabel = currentUserRole === "owner" ? "Управляющий" : currentUserRole === "admin" ? "Администратор" : "Сотрудник";

  const navigation = [
    { name: "Главная", href: "/dashboard", icon: Home },
    { name: "Клиенты", href: "/clients", icon: Users },
    { name: "Расписание", href: "/schedule", icon: Calendar },
    { name: "Виды занятий", href: "/class-types", icon: Dumbbell },
    { name: "Абонементы", href: "/subscriptions", icon: CreditCard },
    { name: "Касса", href: "/cash", icon: WalletCards },
    { name: "Услуги", href: "/services", icon: HandCoins },
    { name: "Виды абонементов", href: "/admin/plans", icon: Tags },
    { name: "Посещаемость", href: "/attendance", icon: ClipboardCheck },
    { name: "Инструкторы", href: "/instructors", icon: UserCog },
    { name: "Новости", href: "/news", icon: Megaphone },
    { name: "Пробные", href: "/trials", icon: Percent },
    { name: "Новый клиент", href: "/admin/new-client", icon: UserRoundPlus },
    ...(currentUserRole === 'owner' ? [
      { name: "Агрегаторы", href: "/aggregators", icon: Globe },
      { name: "Сотрудники", href: "/staff", icon: UsersRound },
      { name: "Расчёт зарплаты", href: "/owner/payroll", icon: DollarSign },
      { name: "Журнал событий", href: "/owner/logs", icon: ScrollText },
    ] : []),
    { name: "Настройки", href: "/settings", icon: Settings },
  ];

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <aside className="fixed left-0 top-0 z-50 flex h-screen w-28 flex-col border-r border-slate-800 bg-slate-900 text-white shadow-xl shadow-slate-950/10">
      <div className="flex h-20 shrink-0 items-center justify-center border-b border-slate-800/80 px-2">
        <Link
          to="/dashboard"
          aria-label="Balance — главная"
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-blue-500 text-3xl font-black leading-none text-white shadow-lg shadow-primary/20 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        >
          B
        </Link>
      </div>

      <nav className="scrollbar-hide flex-1 space-y-1 overflow-y-auto px-2 py-3" aria-label="Основное меню">
        {navigation.map((item) => {
          const isActive = item.href === "/dashboard"
            ? location.pathname === item.href
            : location.pathname === item.href || location.pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.name}
              to={item.href}
              title={item.name}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group relative flex min-h-[58px] w-full flex-col items-center justify-center gap-1 rounded-xl px-1.5 py-2 text-center transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900",
                isActive
                  ? "bg-primary/95 text-white shadow-md shadow-primary/20 after:absolute after:inset-y-2 after:right-[-8px] after:w-[3px] after:rounded-l-full after:bg-emerald-300"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              )}
            >
              <item.icon className={cn("h-6 w-6 shrink-0 stroke-[1.8]", isActive ? "text-white" : "text-slate-300 group-hover:text-white")} aria-hidden="true" />
              <span className="line-clamp-2 max-w-full text-[10px] font-semibold leading-[12px] tracking-[-0.01em]">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-slate-800 p-2">
        <div
          className="mb-1.5 min-w-0 rounded-lg border border-slate-700/70 bg-slate-800/70 px-1.5 py-1.5 text-center"
          title={`Текущая учётная запись: ${accountName}`}
          aria-label={`Текущая учётная запись: ${accountName}`}
        >
          <span className="block w-full truncate text-[10px] font-semibold leading-3 text-white">{accountName}</span>
          <span className="mt-0.5 block w-full truncate text-[9px] leading-3 text-slate-400">{roleLabel}</span>
        </div>
        <Button 
          variant="ghost" 
          className="h-12 w-full flex-col gap-1 rounded-xl px-1 text-red-400 hover:bg-red-900/20 hover:text-red-300"
          onClick={handleLogout}
          title={`Выйти из учётной записи ${accountName}`}
          aria-label={`Выйти из учётной записи ${accountName}`}
        >
          <LogOut className="h-6 w-6" />
          <span className="text-[10px] font-semibold leading-none">Выйти</span>
        </Button>
      </div>
    </aside>
  );
};
