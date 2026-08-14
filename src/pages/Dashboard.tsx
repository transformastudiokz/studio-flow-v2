/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase nested relation responses are not generated in this legacy project. */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  calculateBestRevenueDay,
  calculateFillRate,
  dashboardPercent,
  type RevenuePoint,
} from "@/lib/dashboard-metrics";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  addMonths,
  endOfMonth,
  format,
  isAfter,
  startOfMonth,
  subMonths,
} from "date-fns";
import { ru } from "date-fns/locale";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  CalendarClock,
  CalendarX2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Crown,
  DoorClosed,
  Loader2,
  Sparkles,
  TicketCheck,
  TrendingUp,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type AdminResult = {
  id: string;
  name: string;
  trialSales: number;
  trialAttended: number;
  memberships: number;
  revenue: number;
};

type DashboardMetrics = {
  revenue: number;
  bestDay: RevenuePoint | null;
  paidTrials: number;
  attendedTrials: number;
  newMemberships: number;
  convertedMemberships: number;
  conductedSessions: number;
  cancelledSessions: number;
  closedSessions: number;
  membershipVisits: number;
  onefitBookings: number;
  fillRate: number;
  unpaidTrials: number;
  endingMemberships: number;
  expiringMemberships: number;
  noShows: number;
  revenueByDay: RevenuePoint[];
  admins: AdminResult[];
  unattributedRevenue: number;
};

const emptyMetrics: DashboardMetrics = {
  revenue: 0,
  bestDay: null,
  paidTrials: 0,
  attendedTrials: 0,
  newMemberships: 0,
  convertedMemberships: 0,
  conductedSessions: 0,
  cancelledSessions: 0,
  closedSessions: 0,
  membershipVisits: 0,
  onefitBookings: 0,
  fillRate: 0,
  unpaidTrials: 0,
  endingMemberships: 0,
  expiringMemberships: 0,
  noShows: 0,
  revenueByDay: [],
  admins: [],
  unattributedRevenue: 0,
};

const cancelledBookingStatuses = new Set(["cancelled", "late_cancel"]);
const occupiedBookingStatuses = new Set(["booked", "completed", "absent"]);
const isTrialName = (value?: string | null) => value?.toLocaleLowerCase("ru-RU").includes("пробн") ?? false;
const related = <T,>(value: T | T[] | null | undefined): T | null => Array.isArray(value) ? value[0] ?? null : value ?? null;
const money = (value: number) => `${new Intl.NumberFormat("ru-RU").format(Math.round(value))} ₸`;
const shortName = (profile: any) => {
  const first = profile?.first_name || "";
  const last = profile?.last_name || "";
  return `${first}${last ? ` ${last.slice(0, 1)}.` : ""}`.trim() || "Без имени";
};

const Dashboard = () => {
  const today = new Date();
  const [month, setMonth] = useState(startOfMonth(today));
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const monthLabel = format(month, "LLLL yyyy", { locale: ru });
  const isCurrentMonth = format(month, "yyyy-MM") === format(today, "yyyy-MM");

  const { data: metrics = emptyMetrics, isLoading, isError } = useQuery({
    queryKey: ["dashboard_month", format(month, "yyyy-MM")],
    queryFn: async (): Promise<DashboardMetrics> => {
      const startIso = monthStart.toISOString();
      const endIso = monthEnd.toISOString();
      const todayDate = format(today, "yyyy-MM-dd");
      const expiryDate = format(new Date(today.getTime() + 7 * 86_400_000), "yyyy-MM-dd");

      const [cashResult, sessionsResult, subscriptionsResult, onefitResult, staffResult] = await Promise.all([
        supabase.from("cash_transactions").select(`
          id, occurred_at, amount, operation_type, client_id, subscription_id,
          responsible_user_id, related_transaction_id, title,
          plan:subscription_plans(name,visits_count),
          responsible:profiles!cash_transactions_responsible_user_id_fkey(id,first_name,last_name,role,is_active)
        `).gte("occurred_at", startIso).lte("occurred_at", endIso).limit(5000),
        supabase.from("schedule_sessions").select(`
          id,start_time,end_time,capacity,booking_status,is_cancelled,session_kind,
          bookings:bookings(id,user_id,status,subscription_id),
          onefit_bookings:onefit_bookings(id,is_active,source_status)
        `).gte("start_time", startIso).lte("start_time", endIso).limit(5000),
        supabase.from("user_subscriptions").select(`
          id,user_id,visits_total,visits_remaining,end_date,is_active,start_date,sale_responsible_user_id,
          plan:subscription_plans(name,visits_count)
        `).limit(5000),
        supabase.from("onefit_bookings").select("id,session_id,source_date,source_status,is_active")
          .gte("source_date", format(monthStart, "yyyy-MM-dd"))
          .lte("source_date", format(monthEnd, "yyyy-MM-dd"))
          .eq("is_active", true).limit(5000),
        supabase.from("profiles").select("id,first_name,last_name,role,is_active").eq("role", "admin").eq("is_active", true).limit(5000),
      ]);

      if (cashResult.error) throw cashResult.error;
      if (sessionsResult.error) throw sessionsResult.error;
      if (subscriptionsResult.error) throw subscriptionsResult.error;
      if (onefitResult.error) throw onefitResult.error;
      if (staffResult.error) throw staffResult.error;

      const cashRows = cashResult.data || [];
      const sessions = (sessionsResult.data || []).filter((session: any) => session.session_kind !== "rental");
      const subscriptions = subscriptionsResult.data || [];
      const absentBookings: any[] = [];
      const allBookings = sessions.flatMap((session: any) => (session.bookings || []).map((booking: any) => ({ ...booking, session })));
      allBookings.forEach((booking: any) => {
        if (booking.status === "absent") absentBookings.push(booking);
      });

      const saleTransactions = cashRows.filter((row: any) => row.operation_type === "sale" && Number(row.amount) > 0);
      const subscriptionNet = new Map<string, number>();
      cashRows.forEach((row: any) => {
        if (!row.subscription_id) return;
        subscriptionNet.set(row.subscription_id, (subscriptionNet.get(row.subscription_id) || 0) + Number(row.amount || 0));
      });
      const trialTransactions = saleTransactions.filter((row: any) => {
        const plan = related<any>(row.plan);
        return isTrialName(plan?.name || row.title) && (!row.subscription_id || (subscriptionNet.get(row.subscription_id) || 0) > 0);
      });
      const regularTransactions = saleTransactions.filter((row: any) => {
        const plan = related<any>(row.plan);
        return Number(plan?.visits_count) > 2 && !isTrialName(plan?.name) && (!row.subscription_id || (subscriptionNet.get(row.subscription_id) || 0) > 0);
      });
      const paidTrialClients = new Set(trialTransactions.map((row: any) => row.client_id).filter(Boolean));
      const trialAttendanceByClient = new Map<string, Date>();
      trialTransactions.forEach((sale: any) => {
        const attendance = allBookings
          .filter((booking: any) => booking.user_id === sale.client_id && booking.status === "completed" && (!sale.subscription_id || booking.subscription_id === sale.subscription_id) && new Date(booking.session.start_time) >= new Date(sale.occurred_at))
          .sort((a: any, b: any) => new Date(a.session.start_time).getTime() - new Date(b.session.start_time).getTime())[0];
        if (attendance && !trialAttendanceByClient.has(sale.client_id)) trialAttendanceByClient.set(sale.client_id, new Date(attendance.session.start_time));
      });
      const attendedTrialClients = new Set(trialAttendanceByClient.keys());
      const membershipClients = new Set(regularTransactions.map((row: any) => row.client_id).filter(Boolean));
      const convertedMembershipClients = new Set(regularTransactions.filter((sale: any) => {
        const attendedAt = trialAttendanceByClient.get(sale.client_id);
        return attendedAt && new Date(sale.occurred_at) >= attendedAt;
      }).map((row: any) => row.client_id).filter(Boolean));

      const revenueByDate = new Map<string, number>();
      cashRows.forEach((row: any) => {
        const date = format(new Date(row.occurred_at), "yyyy-MM-dd");
        revenueByDate.set(date, (revenueByDate.get(date) || 0) + Number(row.amount || 0));
      });
      const revenueByDay = Array.from(revenueByDate, ([date, value]) => ({
        date,
        value,
        label: format(new Date(`${date}T12:00:00`), "d MMM", { locale: ru }),
      })).sort((a, b) => a.date.localeCompare(b.date));
      const bestDay = calculateBestRevenueDay(revenueByDay);

      const regularSubscriptionClientIds = new Set(subscriptions.filter((subscription: any) => {
        const plan = related<any>(subscription.plan);
        return Number(plan?.visits_count ?? subscription.visits_total) > 2 && !isTrialName(plan?.name);
      }).map((subscription: any) => subscription.user_id));
      const regularSubscriptionIds = new Set(subscriptions.filter((subscription: any) => {
        const plan = related<any>(subscription.plan);
        return Number(plan?.visits_count ?? subscription.visits_total) > 2 && !isTrialName(plan?.name);
      }).map((subscription: any) => subscription.id));
      const membershipVisits = allBookings.filter((booking: any) => booking.status === "completed" && booking.subscription_id && regularSubscriptionIds.has(booking.subscription_id)).length;

      const activeRegular = subscriptions.filter((subscription: any) => {
        const plan = related<any>(subscription.plan);
        const regular = Number(plan?.visits_count ?? subscription.visits_total) > 2 && !isTrialName(plan?.name);
        const hasVisits = subscription.visits_remaining === null || Number(subscription.visits_remaining) > 0;
        const validDate = !subscription.end_date || subscription.end_date >= todayDate;
        return regular && subscription.is_active && hasVisits && validDate;
      });
      const endingMemberships = new Set(activeRegular.filter((subscription: any) => Number(subscription.visits_remaining) <= 2).map((subscription: any) => subscription.user_id)).size;
      const expiringMemberships = new Set(activeRegular.filter((subscription: any) => subscription.end_date && subscription.end_date <= expiryDate).map((subscription: any) => subscription.user_id)).size;

      const trialSubscriptionClientIds = new Set(subscriptions.filter((subscription: any) => isTrialName(related<any>(subscription.plan)?.name)).map((subscription: any) => subscription.user_id));
      const currentMonthBookings = allBookings.filter((booking: any) => !cancelledBookingStatuses.has(booking.status));
      const unpaidTrials = new Set(currentMonthBookings.filter((booking: any) => {
        if (!booking.user_id) return false;
        return !trialSubscriptionClientIds.has(booking.user_id) && !regularSubscriptionClientIds.has(booking.user_id);
      }).map((booking: any) => booking.user_id)).size;

      const pastSessions = sessions.filter((session: any) => !isAfter(new Date(session.start_time), today));
      const conductedSessions = pastSessions.filter((session: any) => session.booking_status !== "cancelled" && !session.is_cancelled).length;
      const cancelledSessions = sessions.filter((session: any) => session.booking_status === "cancelled" || session.is_cancelled).length;
      const closedSessions = sessions.filter((session: any) => session.booking_status === "closed" && !session.is_cancelled).length;
      const fillSessions = pastSessions.filter((session: any) => session.booking_status !== "cancelled" && Number(session.capacity) > 0);
      const occupied = fillSessions.reduce((sum: number, session: any) => {
        const crm = (session.bookings || []).filter((booking: any) => occupiedBookingStatuses.has(booking.status)).length;
        const onefit = (session.onefit_bookings || []).filter((booking: any) => booking.is_active && booking.source_status !== "cancelled").length;
        return sum + crm + onefit;
      }, 0);
      const capacity = fillSessions.reduce((sum: number, session: any) => sum + Number(session.capacity || 0), 0);

      const adminMap = new Map<string, AdminResult>();
      (staffResult.data || []).forEach((profile: any) => adminMap.set(profile.id, { id: profile.id, name: shortName(profile), trialSales: 0, trialAttended: 0, memberships: 0, revenue: 0 }));
      const trialClientsByAdmin = new Map<string, Set<string>>();
      const membershipClientsByAdmin = new Map<string, Set<string>>();
      cashRows.forEach((row: any) => {
        // Revenue belongs to the employee who actually accepted this payment.
        // A later instalment must not be credited to the employee who created
        // the subscription, otherwise the cash desk and team ranking diverge.
        const responsibleId = row.responsible_user_id;
        if (!responsibleId || !adminMap.has(responsibleId)) return;
        adminMap.get(responsibleId)!.revenue += Number(row.amount || 0);
      });
      trialTransactions.forEach((row: any) => {
        if (!row.responsible_user_id || !adminMap.has(row.responsible_user_id)) return;
        const clients = trialClientsByAdmin.get(row.responsible_user_id) || new Set<string>();
        if (row.client_id) clients.add(row.client_id);
        trialClientsByAdmin.set(row.responsible_user_id, clients);
      });
      regularTransactions.forEach((row: any) => {
        if (!row.responsible_user_id || !adminMap.has(row.responsible_user_id)) return;
        const clients = membershipClientsByAdmin.get(row.responsible_user_id) || new Set<string>();
        if (row.client_id) clients.add(row.client_id);
        membershipClientsByAdmin.set(row.responsible_user_id, clients);
      });
      adminMap.forEach((admin, id) => {
        const trialClients = trialClientsByAdmin.get(id) || new Set<string>();
        admin.trialSales = trialClients.size;
        admin.trialAttended = [...trialClients].filter((clientId) => attendedTrialClients.has(clientId)).length;
        admin.memberships = membershipClientsByAdmin.get(id)?.size || 0;
      });
      const admins = [...adminMap.values()].sort((a, b) => b.memberships - a.memberships || b.trialAttended - a.trialAttended || b.revenue - a.revenue);
      const attributedRevenue = admins.reduce((sum, admin) => sum + admin.revenue, 0);

      return {
        revenue: cashRows.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0),
        bestDay,
        paidTrials: paidTrialClients.size,
        attendedTrials: attendedTrialClients.size,
        newMemberships: membershipClients.size,
        convertedMemberships: convertedMembershipClients.size,
        conductedSessions,
        cancelledSessions,
        closedSessions,
        membershipVisits,
        onefitBookings: (onefitResult.data || []).filter((booking: any) => booking.source_status !== "cancelled").length,
        fillRate: calculateFillRate(occupied, capacity),
        unpaidTrials,
        endingMemberships,
        expiringMemberships,
        noShows: absentBookings.length,
        revenueByDay,
        admins,
        unattributedRevenue: cashRows.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0) - attributedRevenue,
      };
    },
  });

  const maxRevenue = useMemo(() => Math.max(0, ...metrics.revenueByDay.map((point) => point.value)), [metrics.revenueByDay]);

  if (isLoading) return <div className="flex h-[70vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (isError) return <Card><CardContent className="flex min-h-48 flex-col items-center justify-center gap-2 text-center"><AlertCircle className="h-8 w-8 text-destructive" /><p className="font-semibold">Не удалось загрузить дашборд</p><p className="text-sm text-muted-foreground">Обнови страницу. Если ошибка повторится, она будет видна в журнале.</p></CardContent></Card>;

  const topCards = [
    { label: "Выручка месяца", value: money(metrics.revenue), note: "Поступления минус возвраты", icon: CircleDollarSign },
    { label: "Лучший день", value: metrics.bestDay ? money(metrics.bestDay.value) : "—", note: metrics.bestDay ? format(new Date(`${metrics.bestDay.date}T12:00:00`), "d MMMM", { locale: ru }) : "Пока нет операций", icon: TrendingUp },
    { label: "Оплачено первых занятий", value: metrics.paidTrials, note: "Уникальные клиенты", icon: Sparkles },
    { label: "Новые абонементы", value: metrics.newMemberships, note: "Тарифы больше 2 занятий", icon: TicketCheck },
  ];

  const attention = [
    { label: "Записи клиентов без оплаты", value: metrics.unpaidTrials, icon: AlertCircle, to: "/trials", tone: "text-red-600 bg-red-50" },
    { label: "Осталось 1–2 занятия", value: metrics.endingMemberships, icon: TicketCheck, to: "/subscriptions", tone: "text-amber-700 bg-amber-50" },
    { label: "Истекают за 7 дней", value: metrics.expiringMemberships, icon: Clock3, to: "/subscriptions", tone: "text-violet-700 bg-violet-50" },
    { label: "Не пришли на занятия", value: metrics.noShows, icon: CalendarX2, to: "/attendance", tone: "text-slate-700 bg-slate-100" },
  ];

  return (
    <div className="space-y-3 animate-in fade-in">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Главная</h1>
          <p className="text-sm capitalize text-muted-foreground">{monthLabel}</p>
        </div>
        <div className="flex items-center rounded-xl border bg-card p-1 shadow-sm">
          <button type="button" aria-label="Предыдущий месяц" onClick={() => setMonth((value) => subMonths(value, 1))} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><ArrowLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => setMonth(startOfMonth(today))} className="min-w-32 rounded-lg px-3 py-2 text-sm font-semibold capitalize hover:bg-muted">{monthLabel}</button>
          <button type="button" aria-label="Следующий месяц" disabled={isCurrentMonth} onClick={() => setMonth((value) => addMonths(value, 1))} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><ArrowRight className="h-4 w-4" /></button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {topCards.map(({ label, value, note, icon: Icon }, index) => (
          <Card key={label} className="border-border/60 shadow-sm">
            <CardContent className="flex min-h-[92px] items-center gap-3 p-3.5">
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", index === 0 ? "bg-primary/12 text-primary" : "bg-[#f3f0e8] text-[#68746c]")}><Icon className="h-4 w-4" /></span>
              <div className="min-w-0"><p className="truncate text-xs text-muted-foreground">{label}</p><p className="truncate text-xl font-bold tabular-nums md:text-2xl">{value}</p><p className="truncate text-[11px] text-muted-foreground">{note}</p></div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-3 xl:grid-cols-12">
        <Card className="border-border/60 shadow-sm xl:col-span-7">
          <CardHeader className="px-4 pb-2 pt-3"><CardTitle className="text-base">Воронка первых занятий</CardTitle></CardHeader>
          <CardContent className="grid gap-2 px-4 pb-4 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
            <FunnelStage label="Оплатили" value={metrics.paidTrials} note="первых занятий" />
            <Conversion value={dashboardPercent(metrics.attendedTrials, metrics.paidTrials)} label="дошли" />
            <FunnelStage label="Пришли" value={metrics.attendedTrials} note="на первое занятие" />
            <Conversion value={dashboardPercent(metrics.convertedMemberships, metrics.attendedTrials)} label="купили" />
            <FunnelStage label="Стали клиентами" value={metrics.convertedMemberships} note="из когорты первых занятий" />
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm xl:col-span-5">
          <CardHeader className="border-b px-4 py-3"><CardTitle className="text-base">Требует внимания сейчас</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {attention.map(({ label, value, icon: Icon, to, tone }) => (
              <Link key={label} to={to} className="flex min-h-10 items-center gap-2 px-4 py-1.5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", tone)}><Icon className="h-3.5 w-3.5" /></span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{label}</span><strong className="tabular-nums">{value}</strong><ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3 xl:grid-cols-12">
        <Card className="border-border/60 shadow-sm xl:col-span-7">
          <CardHeader className="px-4 pb-2 pt-3"><CardTitle className="text-base">Работа студии</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 px-4 pb-4 sm:grid-cols-3">
            <StudioMetric icon={CalendarCheck} label="Проведено занятий" value={metrics.conductedSessions} />
            <StudioMetric icon={CalendarX2} label="Отменено занятий" value={metrics.cancelledSessions} />
            <StudioMetric icon={DoorClosed} label="Закрыта запись" value={metrics.closedSessions} />
            <StudioMetric icon={UserRoundCheck} label="Посещений по абонементам" value={metrics.membershipVisits} />
            <StudioMetric icon={UsersRound} label="Записей OneFit" value={metrics.onefitBookings} blue />
            <StudioMetric icon={CalendarClock} label="Средняя загрузка" value={`${metrics.fillRate}%`} />
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm xl:col-span-5">
          <CardHeader className="px-4 pb-1 pt-3"><CardTitle className="text-base">Динамика выручки</CardTitle></CardHeader>
          <CardContent className="h-[190px] px-1 pb-2">
            {metrics.revenueByDay.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.revenueByDay} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e9e6df" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#7b817d" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#7b817d" }} axisLine={false} tickLine={false} tickFormatter={(value) => `${Math.round(value / 1000)}к`} />
                  <Tooltip formatter={(value: number) => money(value)} labelStyle={{ color: "#303832" }} />
                  <Bar dataKey="value" fill="#557d68" radius={[5, 5, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="grid h-full place-items-center text-sm text-muted-foreground">В этом месяце операций пока нет</div>}
          </CardContent>
          {maxRevenue > 0 && <p className="px-4 pb-3 text-[11px] text-muted-foreground">Максимум за день: {money(maxRevenue)}</p>}
        </Card>
      </section>

      <Card className="overflow-hidden border-border/60 shadow-sm">
        <CardHeader className="flex-row items-center justify-between border-b px-4 py-3">
          <div><CardTitle className="text-base">Результаты команды — <span className="capitalize">{monthLabel}</span></CardTitle><p className="mt-0.5 text-xs text-muted-foreground">Общий результат: {metrics.paidTrials} первых занятий · {metrics.newMemberships} новых клиентов · {money(metrics.revenue)}</p></div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/35 text-left text-xs text-muted-foreground"><tr><th className="w-14 px-4 py-2">Место</th><th className="px-3 py-2">Администратор</th><th className="px-3 py-2 text-right">Первые занятия</th><th className="px-3 py-2 text-right">Пришли</th><th className="px-3 py-2 text-right">Абонементы</th><th className="px-4 py-2 text-right">Выручка</th></tr></thead>
            <tbody className="divide-y">
              {metrics.admins.map((admin, index) => (
                <tr key={admin.id} className={cn("transition-colors hover:bg-muted/25", index === 0 && (admin.memberships > 0 || admin.trialSales > 0) && "bg-amber-50/45")}>
                  <td className="px-4 py-2.5"><span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold", index === 0 && (admin.memberships > 0 || admin.trialSales > 0) ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground")}>{index === 0 && (admin.memberships > 0 || admin.trialSales > 0) ? <Crown className="h-3.5 w-3.5" /> : index + 1}</span></td>
                  <td className="px-3 py-2.5 font-medium">{admin.name}</td><td className="px-3 py-2.5 text-right tabular-nums">{admin.trialSales}</td><td className="px-3 py-2.5 text-right tabular-nums">{admin.trialAttended}</td><td className="px-3 py-2.5 text-right font-semibold tabular-nums">{admin.memberships}</td><td className="px-4 py-2.5 text-right font-semibold tabular-nums">{money(admin.revenue)}</td>
                </tr>
              ))}
              {!metrics.admins.length && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Активные администраторы не найдены</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
};

const FunnelStage = ({ label, value, note }: { label: string; value: number; note: string }) => <div className="rounded-xl bg-[#f7f5ef] px-3 py-3 text-center"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="text-2xl font-bold tabular-nums">{value}</p><p className="text-[10px] text-muted-foreground">{note}</p></div>;
const Conversion = ({ value, label }: { value: number; label: string }) => <div className="flex items-center justify-center gap-1 text-primary sm:flex-col"><ChevronRight className="hidden h-4 w-4 sm:block" /><span className="text-xs font-bold tabular-nums">{value}%</span><span className="text-[9px] text-muted-foreground">{label}</span></div>;
const StudioMetric = ({ icon: Icon, label, value, blue = false }: { icon: typeof CalendarCheck; label: string; value: number | string; blue?: boolean }) => <div className="flex min-h-14 items-center gap-2 rounded-xl border border-border/55 bg-card px-3 py-2"><span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", blue ? "bg-sky-50 text-sky-600" : "bg-primary/10 text-primary")}><Icon className="h-4 w-4" /></span><div className="min-w-0"><p className="text-lg font-bold tabular-nums">{value}</p><p className="truncate text-[10px] text-muted-foreground">{label}</p></div></div>;

export default Dashboard;
