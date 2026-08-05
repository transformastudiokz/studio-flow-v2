import { UpcomingClasses } from "@/components/dashboard/UpcomingClasses";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchClientStatuses, getClientStatusForBooking } from "@/lib/client-status";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { addDays, endOfDay, format, startOfDay } from "date-fns";
import { ru } from "date-fns/locale";
import {
  AlertCircle,
  ArrowRight,
  CalendarCheck,
  CalendarX2,
  CircleDollarSign,
  Clock3,
  Loader2,
  RefreshCw,
  Sparkles,
  TicketCheck,
  UserRoundCheck,
  WalletCards,
} from "lucide-react";
import { Link } from "react-router-dom";

type DashboardMetrics = {
  bookingsToday: number;
  unpaidStars: number;
  starsToday: number;
  revenueToday: number;
  membershipSales: number;
  trialSales: number;
  otherSales: number;
  activeMemberships: number;
  endingMemberships: number;
  expiringMemberships: number;
  transfersToday: number;
  selfBookingsToday: number;
  cancellationsToday: number;
};

const emptyMetrics: DashboardMetrics = {
  bookingsToday: 0,
  unpaidStars: 0,
  starsToday: 0,
  revenueToday: 0,
  membershipSales: 0,
  trialSales: 0,
  otherSales: 0,
  activeMemberships: 0,
  endingMemberships: 0,
  expiringMemberships: 0,
  transfersToday: 0,
  selfBookingsToday: 0,
  cancellationsToday: 0,
};

const occupiedStatuses = new Set(["booked", "completed"]);
const cancelledStatuses = new Set(["cancelled", "late_cancel"]);
const money = (value: number) => `${new Intl.NumberFormat("ru-RU").format(value)} ₸`;
const isTrialName = (value?: string | null) => value?.toLocaleLowerCase("ru-RU").includes("пробн") ?? false;

const Dashboard = () => {
  const today = new Date();
  const dayStart = startOfDay(today);
  const dayEnd = endOfDay(today);

  const { data: metrics = emptyMetrics, isLoading } = useQuery({
    queryKey: ["dashboard_metrics", format(today, "yyyy-MM-dd")],
    queryFn: async (): Promise<DashboardMetrics> => {
      const startIso = dayStart.toISOString();
      const endIso = dayEnd.toISOString();
      const todayDate = format(today, "yyyy-MM-dd");
      const expiryDate = format(addDays(today, 7), "yyyy-MM-dd");

      const [sessionsResult, cashResult, subscriptionsResult, changesResult, onefitResult] = await Promise.all([
        supabase
          .from("schedule_sessions")
          .select("id, bookings:bookings(id,user_id,status)")
          .gte("start_time", startIso)
          .lte("start_time", endIso),
        supabase
          .from("cash_transactions")
          .select("amount,operation_type,title")
          .gte("occurred_at", startIso)
          .lte("occurred_at", endIso),
        supabase
          .from("user_subscriptions")
          .select("id,visits_remaining,end_date,is_active,plan:subscription_plans(name)"),
        supabase
          .from("booking_change_log")
          .select("action,changed_by,user_id,new_data")
          .gte("changed_at", startIso)
          .lte("changed_at", endIso),
        supabase
          .from("onefit_bookings")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true)
          .eq("source_date", todayDate),
      ]);

      if (sessionsResult.error) throw sessionsResult.error;
      if (cashResult.error) throw cashResult.error;
      if (subscriptionsResult.error) throw subscriptionsResult.error;
      if (changesResult.error) throw changesResult.error;

      const sessions = sessionsResult.data || [];
      const bookings = sessions.flatMap((session: any) => session.bookings || []);
      const activeBookings = bookings.filter((booking: any) => occupiedStatuses.has(booking.status));
      const clientIds = activeBookings.map((booking: any) => booking.user_id).filter(Boolean);
      const clientStatuses = await fetchClientStatuses(clientIds);
      const bookingStatuses = activeBookings.map((booking: any) =>
        getClientStatusForBooking(clientStatuses.get(booking.user_id), booking.id),
      );

      const starsToday = bookingStatuses.filter((status) => status?.isFirstVisit).length;
      const unpaidStars = bookingStatuses.filter(
        (status) => status?.isFirstVisit && !status.hasCurrentTrial,
      ).length;

      const cashRows = cashResult.data || [];
      const revenueToday = cashRows.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
      const positiveSales = cashRows.filter((row: any) => Number(row.amount || 0) > 0);
      const trialSales = positiveSales
        .filter((row: any) => isTrialName(row.title))
        .reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
      const membershipSales = positiveSales
        .filter((row: any) => row.operation_type === "sale" && !isTrialName(row.title))
        .reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
      const otherSales = positiveSales.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0)
        - trialSales
        - membershipSales;

      const subscriptions = subscriptionsResult.data || [];
      const activeSubscriptions = subscriptions.filter((subscription: any) => {
        const hasVisits = Number(subscription.visits_remaining || 0) > 0;
        const hasValidTerm = Boolean(subscription.end_date && subscription.end_date >= todayDate);
        return subscription.is_active && (hasVisits || hasValidTerm);
      });
      const endingMemberships = activeSubscriptions.filter((subscription: any) => {
        const plan = Array.isArray(subscription.plan) ? subscription.plan[0] : subscription.plan;
        return !isTrialName(plan?.name)
          && Number(subscription.visits_remaining || 0) > 0
          && Number(subscription.visits_remaining || 0) <= 2;
      }).length;
      const expiringMemberships = activeSubscriptions.filter((subscription: any) =>
        subscription.end_date && subscription.end_date <= expiryDate,
      ).length;

      const changes = changesResult.data || [];
      const transfersToday = changes.filter((change: any) => change.new_data?.event_type === "rescheduled").length;
      const selfBookingsToday = changes.filter((change: any) =>
        change.action === "created" && change.changed_by && change.changed_by === change.user_id,
      ).length;

      return {
        bookingsToday: activeBookings.length + (onefitResult.count || 0),
        unpaidStars,
        starsToday,
        revenueToday,
        membershipSales,
        trialSales,
        otherSales,
        activeMemberships: activeSubscriptions.length,
        endingMemberships,
        expiringMemberships,
        transfersToday,
        selfBookingsToday,
        cancellationsToday: bookings.filter((booking: any) => cancelledStatuses.has(booking.status)).length,
      };
    },
  });

  if (isLoading) {
    return <div className="flex h-[80vh] items-center justify-center"><Loader2 className="h-9 w-9 animate-spin text-primary" /></div>;
  }

  const topCards = [
    { label: "Записано сегодня", value: metrics.bookingsToday, note: "Все актуальные записи", icon: CalendarCheck, tone: "text-emerald-700 bg-emerald-50" },
    { label: "Неоплаченные звёздочки", value: metrics.unpaidStars, note: "Новые клиенты без оплаты", icon: AlertCircle, tone: "text-red-600 bg-red-50" },
    { label: "Звёздочки", value: metrics.starsToday, note: "Первые записи сегодня", icon: Sparkles, tone: "text-amber-600 bg-amber-50" },
    { label: "Выручка сегодня", value: money(metrics.revenueToday), note: "С учётом возвратов", icon: CircleDollarSign, tone: "text-emerald-700 bg-emerald-50" },
  ];

  const attention = [
    { label: "Неоплаченные звёздочки", value: metrics.unpaidStars, icon: AlertCircle, tone: "text-red-600 bg-red-50", to: "/trials" },
    { label: "Абонементы: осталось 1–2 занятия", value: metrics.endingMemberships, icon: TicketCheck, tone: "text-amber-600 bg-amber-50", to: "/subscriptions" },
    { label: "Истекают в ближайшие 7 дней", value: metrics.expiringMemberships, icon: Clock3, tone: "text-violet-600 bg-violet-50", to: "/subscriptions" },
    { label: "Отмены сегодня", value: metrics.cancellationsToday, icon: CalendarX2, tone: "text-slate-600 bg-slate-100", to: "/schedule" },
  ];

  return (
    <div className="space-y-5 animate-in fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Главная</h1>
        <p className="mt-1 text-sm capitalize text-muted-foreground">Сегодня, {format(today, "d MMMM", { locale: ru })}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {topCards.map(({ label, value, note, icon: Icon, tone }) => (
          <Card key={label} className="border-border/60 shadow-sm">
            <CardContent className="flex items-center gap-4 p-4">
              <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", tone)}><Icon className="h-5 w-5" /></div>
              <div className="min-w-0">
                <p className="truncate text-sm text-muted-foreground">{label}</p>
                <p className="mt-0.5 truncate text-2xl font-bold tabular-nums">{value}</p>
                <p className="truncate text-xs text-muted-foreground">{note}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-7">
        <div className="xl:col-span-4"><UpcomingClasses /></div>
        <Card className="xl:col-span-3 border-border/60 shadow-sm">
          <CardHeader className="border-b p-5"><CardTitle className="text-lg">Требует внимания</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {attention.map(({ label, value, icon: Icon, tone, to }) => (
              <Link key={label} to={to} className="flex min-h-16 items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/40">
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", tone)}><Icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1 text-sm font-medium">{label}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{value}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-7">
        <Card className="xl:col-span-4 border-border/60 shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="text-lg">Продажи сегодня</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <SaleMetric icon={WalletCards} label="Абонементы" value={metrics.membershipSales} />
            <SaleMetric icon={Sparkles} label="Звёздочки" value={metrics.trialSales} />
            <SaleMetric icon={CircleDollarSign} label="Остальная выручка" value={metrics.otherSales} />
          </CardContent>
        </Card>

        <Card className="xl:col-span-3 border-border/60 shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="text-lg">Активная клиентская база</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 divide-x">
            <BaseMetric icon={UserRoundCheck} label="Активные абонементы" value={metrics.activeMemberships} />
            <BaseMetric icon={Clock3} label="Истекают за 7 дней" value={metrics.expiringMemberships} />
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardContent className="grid grid-cols-1 divide-y p-0 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <FooterMetric icon={RefreshCw} label="Переносы" value={metrics.transfersToday} note="Все клиенты" />
          <FooterMetric icon={UserRoundCheck} label="Самозапись" value={metrics.selfBookingsToday} note="Создали клиенты" />
          <FooterMetric icon={CalendarX2} label="Отмены" value={metrics.cancellationsToday} note="На занятия сегодня" />
        </CardContent>
      </Card>
    </div>
  );
};

const SaleMetric = ({ icon: Icon, label, value }: { icon: typeof WalletCards; label: string; value: number }) => (
  <div className="flex items-center gap-3 px-4 py-3 first:pl-0 last:pr-0">
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>
    <div className="min-w-0"><p className="text-xl font-bold text-emerald-700 tabular-nums">{money(value)}</p><p className="truncate text-xs text-muted-foreground">{label}</p></div>
  </div>
);

const BaseMetric = ({ icon: Icon, label, value }: { icon: typeof UserRoundCheck; label: string; value: number }) => (
  <div className="flex items-center gap-3 px-4 first:pl-0 last:pr-0">
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
    <div><p className="text-2xl font-bold tabular-nums">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>
  </div>
);

const FooterMetric = ({ icon: Icon, label, value, note }: { icon: typeof RefreshCw; label: string; value: number; note: string }) => (
  <div className="flex items-center justify-center gap-3 px-5 py-3">
    <Icon className="h-4 w-4 text-muted-foreground" />
    <span className="text-sm text-muted-foreground">{label}</span>
    <strong className="tabular-nums">{value}</strong>
    <span className="hidden text-xs text-muted-foreground lg:inline">· {note}</span>
  </div>
);

export default Dashboard;
