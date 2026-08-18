import { Link, useLocation, Outlet } from "react-router-dom";
import { Home, Calendar, User, Dumbbell } from "lucide-react";
import { cn } from "@/lib/utils";
import React from "react";

interface ClientLayoutProps {
  children?: React.ReactNode;
}

export const ClientLayout = ({ children }: ClientLayoutProps) => {
  const location = useLocation();

  const navItems = [
    { name: "Главная", href: "/portal", icon: Home },
    { name: "Расписание", href: "/portal/schedule", icon: Calendar },
    { name: "Тренеры", href: "/portal/instructors", icon: Dumbbell },
    { name: "Профиль", href: "/portal/profile", icon: User },
  ];

  return (
    <div className="client-portal min-h-[100dvh]">
      <main className="mx-auto min-h-[100dvh] w-full max-w-5xl border-x border-transparent md:border-[#e4dfd5]/70">
        <div className="min-h-[100dvh] touch-pan-y pb-[calc(5rem+env(safe-area-inset-bottom))]">
           {children || <Outlet />}
        </div>
      </main>

      {/* Нижнее меню (Dock) */}
      <nav aria-label="Основная навигация" className="fixed bottom-0 left-0 right-0 z-50 mx-auto flex max-w-3xl items-center justify-around border-t border-[#e7e2d8] bg-[#fffefb]/95 px-3 pt-1.5 shadow-[0_-8px_24px_rgba(45,45,45,0.06)] backdrop-blur-md pb-[max(.45rem,env(safe-area-inset-bottom))]">
        {navItems.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <Link
              key={item.name}
              to={item.href}
              className={cn(
                "client-focus flex min-h-12 min-w-16 flex-col items-center justify-center gap-0.5 rounded-xl py-1 text-[var(--client-muted)] transition-colors",
                isActive ? "text-[var(--client-sage-deep)]" : "hover:text-[var(--client-graphite)]"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <item.icon 
                className={cn(
                    "h-[22px] w-[22px] transition-colors",
                    isActive && "fill-[#e4eae4]"
                )} 
                strokeWidth={isActive ? 2.5 : 2} 
              />
              <span className={cn("text-[11px] font-medium", isActive && "font-bold")}>
                {item.name}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
};
