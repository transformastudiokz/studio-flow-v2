import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Session } from "@supabase/supabase-js";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getRoleCheckMode,
  shouldBlockProtectedRoute,
  type RoleCheckMode,
} from "@/lib/auth-guard";

// === Layouts ===
import { AdminLayout } from "./components/layout/AdminLayout";
import { ClientLayout } from "./components/layout/ClientLayout"; 

// === Pages (Админка) ===
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard"; 
import Clients from "./pages/Clients";
import ClientDetail from "./pages/ClientDetail";
import Schedule from "./pages/Schedule";
import Subscriptions from "./pages/Subscriptions";
import Attendance from "./pages/Attendance";
import Instructors from "./pages/Instructors";
import Trials from "./pages/Trials";
import Settings from "./pages/Settings";
import SubscriptionPlans from "./pages/SubscriptionPlans"; 
import ClassTypes from "./pages/ClassTypes";
import Aggregators from "./pages/Aggregators";
import News from "./pages/News";
import Cash from "./pages/Cash";
import Services from "./pages/Services";
import Staff from "./pages/Staff";
import ChangePassword from "./pages/ChangePassword";
import NotFound from "./pages/NotFound";

import AllUsers from "./pages/admin/AllUsers";
import AdminCheckIn from "./pages/admin/AdminCheckIn";
import OwnerPayroll from "./pages/OwnerPayroll";
import OwnerLogs from "./pages/OwnerLogs";
import NewClient from "./pages/admin/NewClient";
import AdminManage from "./pages/admin/AdminManage";
import TrainerLogin from "./pages/trainer/TrainerLogin";
import TrainerHome from "./pages/trainer/TrainerHome";
import TrainerSchedule from "./pages/trainer/TrainerSchedule";
import { TrainerLayout } from "./components/layout/TrainerLayout";

// === Pages (Клиентский портал) ===
import ClientLogin from "./pages/portal/ClientLogin";
import ClientHome from "./pages/portal/ClientHome";
import ClientSchedule from "./pages/portal/ClientSchedule";
import ClientInstructors from "./pages/portal/ClientInstructors";
import ClientProfile from "./pages/portal/ClientProfile";
import ClientPricing from "./pages/portal/ClientPricing";

const queryClient = new QueryClient();

// === КОМПОНЕНТ ЗАЩИТЫ ===
export const ProtectedRoute = ({ children, checkAdmin = false }: { children?: React.ReactNode, checkAdmin?: boolean }) => {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const activeUserIdRef = useRef<string | null>(null);
  const roleCheckRef = useRef<{ userId: string; promise: Promise<void> } | null>(null);

  const checkUserRole = useCallback((userId: string, mode: RoleCheckMode) => {
    if (roleCheckRef.current?.userId === userId) {
      return roleCheckRef.current.promise;
    }

    const promise = (async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('role, must_change_password, is_active')
          .eq('id', userId)
          .maybeSingle();

        if (activeUserIdRef.current !== userId) return;

        if (error) {
          console.error("Ошибка проверки роли (RLS или рекурсия):", error);
          if (mode === "blocking") setIsAdmin(false);
          return;
        }

        setMustChangePassword(Boolean(data?.must_change_password));
        setIsAdmin(['admin', 'owner'].includes(data?.role) && data?.is_active !== false);
      } catch (err) {
        console.error("Критическая ошибка:", err);
        if (activeUserIdRef.current === userId && mode === "blocking") {
          setIsAdmin(false);
        }
      }
    })();

    roleCheckRef.current = { userId, promise };
    void promise.finally(() => {
      if (roleCheckRef.current?.promise === promise) {
        roleCheckRef.current = null;
      }
    });

    return promise;
  }, []);

  useEffect(() => {
    let isActive = true;

    const applySession = (nextSession: Session | null) => {
      if (!isActive) return;

      setSession(nextSession);

      if (!nextSession?.user) {
        activeUserIdRef.current = null;
        setIsAdmin(false);
        return;
      }

      if (!checkAdmin) {
        activeUserIdRef.current = nextSession.user.id;
        setIsAdmin(false);
        return;
      }

      const mode = getRoleCheckMode(activeUserIdRef.current, nextSession.user.id);
      activeUserIdRef.current = nextSession.user.id;

      if (mode === "blocking") {
        setIsAdmin(null);
      }

      void checkUserRole(nextSession.user.id, mode);
    };

    // Первая проверка блокирует интерфейс, пока права пользователя неизвестны.
    void supabase.auth.getSession().then(({ data: { session } }) => applySession(session));

    // Последующие обновления токена проверяют права в фоне, не размонтируя формы.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      applySession(nextSession);
    });

    return () => {
      isActive = false;
      activeUserIdRef.current = null;
      subscription.unsubscribe();
    };
  }, [checkAdmin, checkUserRole]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // 1. Состояние загрузки
  if (shouldBlockProtectedRoute(session, checkAdmin, isAdmin)) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  // 2. Нет сессии -> На соответствующую страницу входа
  if (session === null) {
    return <Navigate to={checkAdmin ? "/login" : "/portal/login"} replace />;
  }

  if (checkAdmin && mustChangePassword) return <Navigate to="/change-password" replace />;

  // 3. Есть сессия, но нет прав администратора
  if (checkAdmin && !isAdmin) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center p-4 text-center bg-gray-50 gap-4">
        <h1 className="text-2xl font-bold text-destructive">Доступ запрещен</h1>
        <p className="text-muted-foreground">У вас нет прав администратора для доступа к этой части системы.</p>
        <Button variant="outline" onClick={handleLogout}>
          <LogOut className="mr-2 h-4 w-4" /> Выйти и войти под другим аккаунтом
        </Button>
      </div>
    );
  }

  return children ? <>{children}</> : <Outlet />;
};

// === TRAINER ROUTE ===
const TrainerRoute = ({ children }: { children?: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [isTrainer, setIsTrainer] = useState<boolean | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        supabase.from('profiles').select('role,must_change_password,is_active').eq('id', session.user.id).maybeSingle()
          .then(({ data }) => { setIsTrainer(data?.role === 'trainer' && data?.is_active !== false); setMustChangePassword(Boolean(data?.must_change_password)); });
      } else {
        setIsTrainer(false);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        supabase.from('profiles').select('role,must_change_password,is_active').eq('id', session.user.id).maybeSingle()
          .then(({ data }) => { setIsTrainer(data?.role === 'trainer' && data?.is_active !== false); setMustChangePassword(Boolean(data?.must_change_password)); });
      } else {
        setIsTrainer(false);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined || isTrainer === null) {
    return <div className="h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (session === null) return <Navigate to="/trainer/login" replace />;
  if (mustChangePassword) return <Navigate to="/change-password" replace />;
  if (!isTrainer) return <Navigate to="/trainer/login" replace />;
  return children ? <>{children}</> : <Outlet />;
};

// === ОСНОВНОЕ ПРИЛОЖЕНИЕ ===
const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Публичные маршруты */}
          <Route path="/login" element={<Login />} />
          <Route path="/portal/login" element={<ClientLogin />} />
          <Route path="/change-password" element={<ChangePassword />} />

          {/* === АДМИНКА === */}
          <Route element={<ProtectedRoute checkAdmin><AdminLayout /></ProtectedRoute>}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/clients/:id" element={<ClientDetail />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/subscriptions" element={<Subscriptions />} />
            <Route path="/cash" element={<Cash />} />
            <Route path="/services" element={<Services />} />
            <Route path="/staff" element={<Staff />} />
            <Route path="/attendance" element={<Attendance />} />
            <Route path="/instructors" element={<Instructors />} />
            <Route path="/trials" element={<Trials />} />
            <Route path="/aggregators" element={<Aggregators />} />
            <Route path="/news" element={<News />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/admin/plans" element={<SubscriptionPlans />} />
            <Route path="/class-types" element={<ClassTypes />} />
            <Route path="/admin/users" element={<AllUsers />} />
            <Route path="/admin/checkin" element={<AdminCheckIn />} />
            <Route path="/owner/payroll" element={<OwnerPayroll />} />
            <Route path="/owner/logs" element={<OwnerLogs />} />
            <Route path="/admin/new-client" element={<NewClient />} />
            <Route path="/admin/manage" element={<AdminManage />} />
          </Route>

          {/* === ТРЕНЕРСКИЙ ПОРТАЛ === */}
          <Route path="/trainer/login" element={<TrainerLogin />} />
          <Route element={<TrainerRoute><TrainerLayout /></TrainerRoute>}>
            <Route path="/trainer" element={<TrainerHome />} />
            <Route path="/trainer/schedule" element={<TrainerSchedule />} />
          </Route>

          {/* === КЛИЕНТСКИЙ ПОРТАЛ === */}
          <Route element={<ProtectedRoute><ClientLayout /></ProtectedRoute>}>
              <Route path="/portal" element={<ClientHome />} />
              <Route path="/portal/schedule" element={<ClientSchedule />} />
              <Route path="/portal/instructors" element={<ClientInstructors />} />
              <Route path="/portal/profile" element={<ClientProfile />} />
              <Route path="/portal/pricing" element={<ClientPricing />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
