import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";

export const AdminLayout = () => {
  const { pathname } = useLocation();
  const isSchedule = pathname === "/schedule";

  return (
    // 1. УБРАЛИ 'flex', оставили просто min-h-screen
    <div className="min-h-screen bg-slate-50 relative">
      
      {/* Боковое меню (Desktop) */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {/* Основная область */}
      {/* w-full = на мобильном ширина 100% */}
      {/* ml-0 = на мобильном отступа слева нет */}
      {/* md:ml-28 = компактная панель 112px на компьютере */}
      {/* pb-20 = отступ снизу, чтобы мобильное меню не закрывало контент */}
      <main className="ml-0 min-h-screen w-full p-4 pb-24 transition-all md:ml-28 md:w-auto md:p-6 md:pb-8 xl:p-8">
        {/* Расписание использует всю ширину; остальные разделы сохраняют комфортный предел. */}
        <div className={isSchedule ? "mx-auto max-w-none space-y-6 animate-in fade-in" : "mx-auto max-w-7xl space-y-6 animate-in fade-in"}>
          <Outlet />
        </div>
      </main>

      {/* Мобильное меню (Mobile) */}
      <MobileNav />
      
    </div>
  );
};
