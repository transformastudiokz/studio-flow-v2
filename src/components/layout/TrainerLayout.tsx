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
    <div className="min-h-screen bg-gray-50 pb-24">
      <main className="relative mx-auto min-h-screen max-w-2xl overflow-hidden bg-white shadow-xl">
        <div className="h-full overflow-y-auto pb-20">
          {children || <Outlet />}
        </div>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-50 mx-auto flex max-w-2xl items-center justify-around border-t border-gray-200 bg-white/95 px-6 py-2 shadow-[0_-5px_15px_rgba(0,0,0,0.05)] backdrop-blur-md">
        {navItems.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <Link
              key={item.name}
              to={item.href}
              className={cn(
                "flex flex-col items-center gap-1 transition-all duration-300 active:scale-95 w-20 py-2",
                isActive ? "text-primary" : "text-gray-400 hover:text-gray-600"
              )}
            >
              <item.icon
                className={cn("w-6 h-6 transition-all duration-300", isActive && "fill-primary/20 scale-110")}
                strokeWidth={isActive ? 2.5 : 2}
              />
              <span className={cn("text-[10px] font-medium", isActive && "font-bold")}>{item.name}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
};
