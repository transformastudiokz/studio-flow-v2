import { Link, useLocation, Outlet } from "react-router-dom";
import { Home, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import React from "react";

interface TrainerLayoutProps {
  children?: React.ReactNode;
}

export const TrainerLayout = ({ children }: TrainerLayoutProps) => {
  const location = useLocation();

  const navItems = [
    { name: "Главная", href: "/trainer", icon: Home },
    { name: "Расписание", href: "/trainer/schedule", icon: Calendar },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="relative mx-auto min-h-screen max-w-2xl overflow-hidden bg-white shadow-xl">
        <div className="h-full overflow-y-auto pb-12">
          {children || <Outlet />}
        </div>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-50 mx-auto flex h-12 max-w-2xl items-center justify-around border-t border-gray-200 bg-white/95 px-6 shadow-[0_-5px_15px_rgba(0,0,0,0.05)] backdrop-blur-md">
        {navItems.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <Link
              key={item.name}
              to={item.href}
              className={cn(
                "flex w-20 flex-col items-center gap-0.5 py-1 transition-all duration-300 active:scale-95",
                isActive ? "text-primary" : "text-gray-400 hover:text-gray-600"
              )}
            >
              <item.icon
                className={cn("h-5 w-5 transition-all duration-300", isActive && "scale-105 fill-primary/20")}
                strokeWidth={isActive ? 2.5 : 2}
              />
              <span className={cn("text-[9px] font-medium", isActive && "font-bold")}>{item.name}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
};
