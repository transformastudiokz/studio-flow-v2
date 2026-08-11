import { UpcomingClasses } from "@/components/dashboard/UpcomingClasses";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { useState } from "react";

type ActivityDetail = { id: string; clientId: string | null; name: string; description: string };

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
  transferDetails: ActivityDetail[];
  selfBookingDetails: ActivityDetail[];
  cancellationDetails: ActivityDetail[];
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
  transferDetails: [],
  selfBookingDetails: [],
  cancellationDetails: [],
};

const occupiedStatuses = new Set(["booked", "completed"]);
const cancelledStatuses = new Set(["cancelled", "late_cancel"]);
const money = (value: number) => `${new Intl.NumberFormat("ru-RU").format(value)} ₸`;
const isTrialName = (value?: string | null) => value?.toLocaleLowerCase("ru-RU").includes("пробн") ?? false;

const Dashboard = () => {
  const [activityDialog, setActivityDialog] = useState<"transfers" | "self" | "cancellations" | null>(null);
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
          .select("id,start_time,class_type:class_types(name),bookings:bookings(id,user_id,status,user:profiles(id,first_name,last_name))")
          .gte("start_time", startIso)
          .lte("start_time", endIso),
        supabase
          .from("cash_transactions")
          .select("amount,operation_type,title,subscription_id,rental_booking_id")
          .gte("occurred_at", startIso)
          .lte("occurred_at", endIso),
        supabase
          .from("user_subscriptions")
          .select("id,user_id,visits_total,visits_remaining,end_date,is_active,plan:subscription_plans(name,visits_count)"),
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
        .filter((row: any) => row.operation_type === "sale" && row.subscription_id && !isTrialName(row.title))
        .reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
      const otherSales = positiveSales.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0)
        - trialSales
        - membershipSales;

      const subscriptions = subscriptionsResult.data || [];
      const activeSubscriptions = subscriptions.filter((subscription: any) => {
        const plan = Array.isArray(subscription.plan) ? subscription.plan[0] : subscription.plan;
        const baselineVisits = plan?.visits_count ?? subscription.visits_total;
        const isRegularPlan = !isTrialName(plan?.name) && (baselineVisits === null || Number(baselineVisits) >= 4);
        const hasVisits = subscription.visits_remaining === null || Number(subscription.visits_remaining) > 0;
        const hasValidTerm = !subscription.end_date || subscription.end_date >= todayDate;
        return subscription.is_active && isRegularPlan && hasVisits && hasValidTerm;
      });
      const activeClientIds = new Set(activeSubscriptions.map((subscription: any) => subscription.user_id));
      const endingClientIds = new Set(activeSubscriptions
        .filter((subscription: any) => Number(subscription.visits_remaining) > 0 && Number(subscription.visits_remaining) <= 2)
        .map((subscription: any) => subscription.user_id));
      const expiringClientIds = new Set(activeSubscriptions
        .filter((subscription: any) => subscription.end_date && subscription.end_date <= expiryDate)
        .map((subscription: any) => subscription.user_id));

      const changes = changesResult.data || [];
      const transfersToday = changes.filter((change: any) => change.new_data?.event_type === "rescheduled").length;
      const selfBookingsToday = changes.filter((change: any) =>
        change.action === "created" && change.changed_by && change.changed_by === change.user_id,
      ).length;

      const detailUserIds = [...new Set(changes.map((change: any) => change.user_id).filter(Boolean))];
      const { data: detailProfiles, error: profilesError } = detailUserIds.length
        ? await supabase.from("profiles").select("id,first_name,last_name").in("id", detailUserIds)
        : { data: [], error: null };
      if (profilesError) throw profilesError;
      const profileMap = new Map((detailProfiles || []).map((profile: any) => [profile.id, profile]));
      const clientName = (profile: any) => profile
        ? `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || "Клиент"
        : "Клиент";
      const transferDetails = changes
        .filter((change: any) => change.new_data?.event_type === "rescheduled")
        .map((change: any, index: number) => ({ id: `transfer-${index}-${change.user_id}`, clientId: change.user_id || null, name: clientName(profileMap.get(change.user_id)), description: "Перенос на другое занятие" }));
      const selfBookingDetails = changes
        .filter((change: any) => change.action === "created" && change.changed_by && change.changed_by === change.user_id)
        .map((change: any, index: number) => ({ id: `self-${index}-${change.user_id}`, clientId: change.user_id || null, name: clientName(profileMap.get(change.user_id)), description: "Самостоятельная запись клиента" }));
      const cancellationDetails = sessions.flatMap((session: any) =>
        (session.bookings || []).filter((booking: any) => cancelledStatuses.has(booking.status)).map((booking: any) => {
          const user = Array.isArray(booking.user) ? booking.user[0] : booking.user;
          const classType = Array.isArray(session.class_type) ? session.class_type[0] : session.class_type;
          return { id: `cancel-${booking.id}`, clientId: booking.user_id || null, name: clientName(user), description: `${booking.status === "late_cancel" ? "Поздняя отмена" : "Отмена"} · ${format(new Date(session.start_time), "HH:mm")} · ${classType?.name || "занятие"}` };
        }),
      );

      return {
        bookingsToday: activeBookings.length + (onefitResult.count || 0),
        unpaidStars,
        starsToday,
        revenueToday,
        membershipSales,
        trialSales,
        otherSales,
        activeMemberships: activeClientIds.size,
        endingMemberships: endingClientIds.size,
        expiringMemberships: expiringClientIds.size,
        transfersToday,
        selfBookingsToday,
        cancellationsToday: bookings.filter((booking: any) => cancelledStatuses.has(booking.status)).length,
        transferDetails,
        selfBookingDetails,
        cancellationDetails,
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
    <div className="space-y-3 animate-in fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Главная</h1>
        <p className="text-sm capitalize text-muted-foreground">Сегодня, {format(today, "d MMMM", { locale: ru })}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {topCards.map(({ label, value, note, icon: Icon, tone }) => (
          <Card key={label} className="border-border/60 shadow-sm">
            <CardContent className="flex items-center gap-3 p-3">
              <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", tone)}><Icon className="h-4 w-4" /></div>
              <div className="min-w-0">
                <p className="truncate text-sm text-muted-foreground">{label}</p>
                <p className="truncate text-xl font-bold tabular-nums">{value}</p>
                <p className="truncate text-xs text-muted-foreground">{note}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-7">
        <div className="xl:col-span-4"><UpcomingClasses /></div>
        <Card className="xl:col-span-3 border-border/60 shadow-sm">
          <CardHeader className="border-b px-4 py-3"><CardTitle className="text-base">Требует внимания</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {attention.map(({ label, value, icon: Icon, tone, to }) => (
              <Link key={label} to={to} className="flex min-h-10 items-center gap-2 px-4 py-1.5 transition-colors hover:bg-muted/40">
                <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", tone)}><Icon className="h-3.5 w-3.5" /></span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{label}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{value}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-7">
        <Card className="xl:col-span-4 border-border/60 shadow-sm">
          <CardHeader className="px-4 pb-1 pt-3"><CardTitle className="text-base">Продажи сегодня</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <SaleMetric icon={WalletCards} label="Абонементы" value={metrics.membershipSales} />
            <SaleMetric icon={Sparkles} label="Звёздочки" value={metrics.trialSales} />
            <SaleMetric icon={CircleDollarSign} label="Остальная выручка" value={metrics.otherSales} />
          </CardContent>
        </Card>

        <Card className="xl:col-span-3 border-border/60 shadow-sm">
          <CardHeader className="px-4 pb-1 pt-3"><CardTitle className="text-base">Активная клиентская база</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 divide-x">
            <BaseMetric icon={UserRoundCheck} label="Активные клиенты" value={metrics.activeMemberships} />
            <BaseMetric icon={Clock3} label="Истекают за 7 дней" value={metrics.expiringMemberships} />
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardContent className="grid grid-cols-1 divide-y p-0 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <FooterMetric icon={RefreshCw} label="Переносы" value={metrics.transfersToday} note="Все клиенты" onClick={() => setActivityDialog("transfers")} />
          <FooterMetric icon={UserRoundCheck} label="Самозапись" value={metrics.selfBookingsToday} note="Создали клиенты" onClick={() => setActivityDialog("self")} />
          <FooterMetric icon={CalendarX2} label="Отмены" value={metrics.cancellationsToday} note="На занятия сегодня" onClick={() => setActivityDialog("cancellations")} />
        </CardContent>
      </Card>
      <ActivityDialog
        type={activityDialog}
        onClose={() => setActivityDialog(null)}
        items={activityDialog === "transfers" ? metrics.transferDetails : activityDialog === "self" ? metrics.selfBookingDetails : metrics.cancellationDetails}
      />
    </div>
  );
};

const SaleMetric = ({ icon: Icon, label, value }: { icon: typeof WalletCards; label: string; value: number }) => (
  <div className="flex items-center gap-2 px-3 py-2 first:pl-0 last:pr-0">
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon className="h-3.5 w-3.5" /></span>
    <div className="min-w-0"><p className="text-lg font-bold text-emerald-700 tabular-nums">{money(value)}</p><p className="truncate text-xs text-muted-foreground">{label}</p></div>
  </div>
);

const BaseMetric = ({ icon: Icon, label, value }: { icon: typeof UserRoundCheck; label: string; value: number }) => (
  <div className="flex items-center gap-2 px-3 py-2 first:pl-0 last:pr-0">
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>
    <div><p className="text-xl font-bold tabular-nums">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>
  </div>
);

const FooterMetric = ({ icon: Icon, label, value, note, onClick }: { icon: typeof RefreshCw; label: string; value: number; note: string; onClick: () => void }) => (
  <button type="button" onClick={onClick} className="flex items-center justify-center gap-2 px-4 py-2 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
    <Icon className="h-4 w-4 text-muted-foreground" />
    <span className="text-sm text-muted-foreground">{label}</span>
    <strong className="tabular-nums">{value}</strong>
    <span className="hidden text-xs text-muted-foreground lg:inline">· {note}</span>
  </button>
);

const ActivityDialog = ({ type, onClose, items }: { type: "transfers" | "self" | "cancellations" | null; onClose: () => void; items: ActivityDetail[] }) => {
  const titles = { transfers: "Переносы сегодня", self: "Самозаписи сегодня", cancellations: "Отмены сегодня" };
  return (
    <Dialog open={Boolean(type)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{type ? titles[type] : "Действия сегодня"}</DialogTitle>
          <DialogDescription>Нажми на имя, чтобы открыть карточку клиента.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[420px] divide-y overflow-y-auto rounded-lg border">
          {items.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">За сегодня таких действий нет</p> : items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                {item.clientId ? <Link to={`/clients/${item.clientId}`} onClick={onClose} className="font-medium hover:text-primary hover:underline">{item.name}</Link> : <p className="font-medium">{item.name}</p>}
                <p className="truncate text-xs text-muted-foreground">{item.description}</p>
              </div>
              {item.clientId && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default Dashboard;
