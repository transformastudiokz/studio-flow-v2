import { Button } from "@/components/ui/button";
import { exportPayrollAnalyticsToExcel } from "@/lib/payroll-export";
import {
  buildPayrollAnalytics,
  type PayrollBooking,
  type PayrollCoach,
  type PayrollOneFitBooking,
  type PayrollSession,
  type PayrollSubscription,
} from "@/lib/payroll-analytics";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { addMonths, format, startOfMonth } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Award,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  FileSpreadsheet,
  Loader2,
  Medal,
  RefreshCw,
  Sparkles,
  TrendingUp,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

type RawSession = Omit<PayrollSession, "bookings" | "onefit_bookings"> & {
  bookings: PayrollBooking[] | null;
  onefit_bookings: PayrollOneFitBooking[] | null;
};

type RawSubscription = {
  id: string;
  user_id: string;
  visits_total: number | null;
  start_date: string | null;
  created_at: string | null;
  plan: PayrollSubscription["plan"] | PayrollSubscription["plan"][];
};

type CashRow = {
  subscription_id: string | null;
  amount: number | string | null;
  occurred_at: string;
};

const PAGE_SIZE = 1000;
const money = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₸`;
const getErrorMessage = (value: unknown) => {
  if (value instanceof Error) return value.message;
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") {
    return value.message;
  }
  return "Повтори загрузку. Если ошибка сохранится, данные не будут изменены.";
};
const valueOfRelation = <T,>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;

const fetchBookingHistory = async (beforeIso: string): Promise<PayrollBooking[]> => {
  const rows: PayrollBooking[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("bookings")
      .select("id,session_id,user_id,status,created_at")
      .lt("created_at", beforeIso)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data || []) as PayrollBooking[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
};

const fetchSubscriptions = async (): Promise<RawSubscription[]> => {
  const rows: RawSubscription[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("user_subscriptions")
      .select("id,user_id,visits_total,start_date,created_at,plan:subscription_plans(name,visits_count)")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data || []) as unknown as RawSubscription[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
};

const fetchCashHistory = async (beforeIso: string): Promise<CashRow[]> => {
  const rows: CashRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("cash_transactions")
      .select("subscription_id,amount,occurred_at")
      .not("subscription_id", "is", null)
      .lt("occurred_at", beforeIso)
      .order("occurred_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data || []) as CashRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
};

const OwnerPayroll = () => {
  const [monthOffset, setMonthOffset] = useState(0);
  const [isExporting, setIsExporting] = useState(false);

  const targetMonth = useMemo(() => startOfMonth(addMonths(new Date(), monthOffset)), [monthOffset]);
  const nextMonth = useMemo(() => addMonths(targetMonth, 1), [targetMonth]);
  const monthKey = format(targetMonth, "yyyy-MM");
  const monthLabel = format(targetMonth, "LLLL yyyy", { locale: ru });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["owner_payroll_analytics", monthKey],
    queryFn: async () => {
      const startIso = targetMonth.toISOString();
      const endIso = nextMonth.toISOString();

      const [coachesResult, sessionsResult, bookingHistory, subscriptionsRaw, cashRows] = await Promise.all([
        supabase
          .from("coaches")
          .select("id,name,user_id,rate_per_client")
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("schedule_sessions")
          .select(`
            id,coach_id,start_time,end_time,booking_status,is_cancelled,session_kind,
            bookings:bookings(id,session_id,user_id,status,created_at),
            onefit_bookings:onefit_bookings(is_active,source_status)
          `)
          .gte("start_time", startIso)
          .lt("start_time", endIso)
          .order("start_time", { ascending: true })
          .limit(5000),
        fetchBookingHistory(endIso),
        fetchSubscriptions(),
        fetchCashHistory(endIso),
      ]);

      if (coachesResult.error) throw coachesResult.error;
      if (sessionsResult.error) throw sessionsResult.error;

      const rawCoaches = (coachesResult.data || []) as PayrollCoach[];
      const profileIds = rawCoaches.map((coach) => coach.user_id).filter((id): id is string => Boolean(id));
      let profiles: ProfileRow[] = [];
      if (profileIds.length > 0) {
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("id,first_name,last_name")
          .in("id", profileIds);
        if (profileError) throw profileError;
        profiles = (profileData || []) as ProfileRow[];
      }
      const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
      const coaches = rawCoaches.map<PayrollCoach>((coach) => ({
        ...coach,
        profile: coach.user_id ? profilesById.get(coach.user_id) ?? null : null,
      }));

      const cashBySubscription = new Map<string, CashRow[]>();
      cashRows.forEach((transaction) => {
        if (!transaction.subscription_id) return;
        const current = cashBySubscription.get(transaction.subscription_id) || [];
        current.push(transaction);
        cashBySubscription.set(transaction.subscription_id, current);
      });

      const subscriptions = subscriptionsRaw.map<PayrollSubscription>((subscription) => {
        const transactions = cashBySubscription.get(subscription.id) || [];
        const positive = transactions.find((transaction) => Number(transaction.amount || 0) > 0);
        return {
          id: subscription.id,
          user_id: subscription.user_id,
          visits_total: subscription.visits_total,
          start_date: subscription.start_date,
          created_at: subscription.created_at,
          first_payment_at: positive?.occurred_at ?? null,
          net_paid: transactions.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0),
          plan: valueOfRelation(subscription.plan),
        };
      });

      return buildPayrollAnalytics({
        coaches,
        sessions: (sessionsResult.data || []) as unknown as RawSession[],
        bookingHistory,
        subscriptions,
        now: new Date(Math.min(Date.now(), nextMonth.getTime() - 1)),
      });
    },
  });

  const copyTable = async () => {
    if (!data) return;
    const rows = [
      ["Место", "Имя и фамилия", "Занятий", "Посещений всего", "CRM", "OneFit", "Новые пробные", "Покупки после", "Среднее", "Конверсия", "К выплате"],
      ...data.rows.map((row, index) => [index + 1, row.name, row.sessionCount, row.totalVisits, row.crmVisits, row.onefitVisits, row.trialStars, row.purchasesAfterTrial, row.averageVisits, `${row.conversionRate}%`, row.payment]),
      ["", "ИТОГО", data.totals.sessionCount, data.totals.totalVisits, data.totals.crmVisits, data.totals.onefitVisits, data.totals.trialStars, data.totals.purchasesAfterTrial, data.totals.averageVisits, `${data.totals.conversionRate}%`, data.totals.payment],
    ];
    await navigator.clipboard.writeText(rows.map((row) => row.join("\t")).join("\n"));
    toast.success("Таблица скопирована — её можно вставить в Excel");
  };

  const exportTable = async () => {
    if (!data) return;
    try {
      setIsExporting(true);
      await exportPayrollAnalyticsToExcel({ analytics: data, periodLabel: monthLabel, filenamePeriod: monthKey });
      toast.success("Excel-файл сформирован");
    } catch (exportError) {
      console.error(exportError);
      toast.error("Не удалось сформировать Excel-файл");
    } finally {
      setIsExporting(false);
    }
  };

  const leaders = data?.rows.filter((row) => row.sessionCount > 0).slice(0, 3) || [];

  return (
    <div className="space-y-5 animate-in fade-in pb-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Расчёт зарплаты</h1>
          <p className="mt-1 text-sm text-muted-foreground">Статистика преподавателей накопительным итогом за период</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" size="sm" className="gap-2" disabled={!data || isLoading} onClick={copyTable}>
            <ClipboardCopy className="h-4 w-4" /><span className="hidden sm:inline">Копировать</span>
          </Button>
          <Button variant="outline" size="sm" className="gap-2" disabled={!data || isLoading || isExporting} onClick={exportTable}>
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}Excel
          </Button>
          <div className="flex items-center gap-1 rounded-lg border bg-muted p-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Предыдущий месяц" onClick={() => setMonthOffset((previous) => previous - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="min-w-[118px] px-2 text-center text-sm font-medium capitalize">{monthLabel}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Следующий месяц" onClick={() => setMonthOffset((previous) => previous + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="flex min-h-[360px] items-center justify-center rounded-2xl border bg-white"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
      ) : isError ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-2xl border bg-white p-6 text-center">
          <p className="font-semibold">Не удалось загрузить статистику преподавателей</p>
          <p className="max-w-lg text-sm text-muted-foreground">{getErrorMessage(error)}</p>
          <Button variant="outline" className="gap-2" onClick={() => refetch()}><RefreshCw className="h-4 w-4" />Повторить</Button>
        </div>
      ) : data ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard icon={UserRoundCheck} label="Проведено занятий" value={data.totals.sessionCount} note={`в среднем ${data.averageSessionsPerCoach} на преподавателя`} />
            <MetricCard icon={UsersRound} label="Посещений всего" value={data.totals.totalVisits} note={`${data.totals.crmVisits} CRM · ${data.totals.onefitVisits} OneFit`} />
            <MetricCard icon={TrendingUp} label="Средняя посещаемость" value={data.totals.averageVisits} note={`${data.averageCrmPerSession} CRM · ${data.averageOnefitPerSession} OneFit`} />
            <MetricCard icon={Sparkles} label="Первые клиенты" value={data.totals.trialStars} note={`${data.totals.purchasesAfterTrial} купили абонемент · ${data.totals.conversionRate}%`} />
            <MetricCard icon={Award} label="Итого к выплате" value={money(data.totals.payment)} note={`${data.activeCoachCount} преподавателей с занятиями`} emphasis />
          </section>

          {leaders.length > 0 && (
            <section className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div><h2 className="font-bold">Лидеры по посещаемости</h2><p className="text-xs text-muted-foreground">Рейтинг по общему числу фактических посещений</p></div>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary capitalize">{monthLabel}</span>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {leaders.map((leader, index) => (
                  <div key={leader.id} className={cn("flex items-center gap-3 rounded-xl border p-3", index === 0 ? "border-amber-200 bg-amber-50/60" : "bg-stone-50/60")}>
                    <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold", index === 0 ? "bg-amber-100 text-amber-700" : "bg-white text-muted-foreground")}>{index === 0 ? <Medal className="h-5 w-5" /> : index + 1}</div>
                    <div className="min-w-0 flex-1"><p className="truncate font-semibold">{leader.name}</p><p className="text-xs text-muted-foreground">{leader.sessionCount} занятий · {leader.averageVisits} в среднем</p></div>
                    <div className="text-right"><p className="text-xl font-bold tabular-nums">{leader.totalVisits}</p><p className="text-[11px] text-muted-foreground">посещений</p></div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-2 border-b px-4 py-4 md:px-5">
              <div><h2 className="font-bold">Сводная таблица</h2><p className="text-xs text-muted-foreground">Все значения — накопительным итогом за выбранный месяц</p></div>
              <p className="text-xs text-muted-foreground">Сортировка: фактические посещения</p>
            </div>
            {data.rows.length === 0 ? <div className="py-14 text-center text-sm text-muted-foreground">Активных преподавателей не найдено</div> : (
              <div className="overflow-x-auto">
                <table className="min-w-[1160px] w-full text-sm">
                  <thead className="bg-stone-50 text-xs text-muted-foreground">
                    <tr>
                      <th className="w-14 px-3 py-3 text-center font-semibold">Место</th>
                      <th className="sticky left-0 z-10 min-w-[205px] bg-stone-50 px-3 py-3 text-left font-semibold">Имя и фамилия</th>
                      <TableHead label="Занятия" hint="Проведённые и завершённые занятия" />
                      <TableHead label="Всего" hint="CRM и OneFit вместе" />
                      <TableHead label="По абонементам" hint="Фактически пришедшие CRM-клиенты" />
                      <TableHead label="OneFit" hint="Активные подтверждённые OneFit-посещения" />
                      <TableHead label="Звёздочки" hint="Первое занятие клиента в студии" />
                      <TableHead label="Покупки" hint="Купили абонемент более чем на 2 занятия после первого визита" />
                      <TableHead label="Среднее" hint="Посещений на одно проведённое занятие" />
                      <TableHead label="Конверсия" hint="Покупки после первого занятия / звёздочки" />
                      <th className="min-w-[120px] px-3 py-3 text-right font-semibold">К выплате</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row, index) => (
                      <tr key={row.id} className={cn("border-t transition-colors hover:bg-primary/[0.03]", index === 0 && row.sessionCount > 0 && "bg-amber-50/40")}>
                        <td className="px-3 py-3 text-center tabular-nums text-muted-foreground">{row.sessionCount > 0 ? index + 1 : "—"}</td>
                        <td className={cn("sticky left-0 z-10 px-3 py-3 font-semibold", index === 0 && row.sessionCount > 0 ? "bg-[#fffdf5]" : "bg-white")}>{row.name}</td>
                        <NumberCell value={row.sessionCount} /><NumberCell value={row.totalVisits} strong /><NumberCell value={row.crmVisits} /><NumberCell value={row.onefitVisits} blue /><NumberCell value={row.trialStars} gold /><NumberCell value={row.purchasesAfterTrial} /><NumberCell value={row.averageVisits} />
                        <td className="px-3 py-3 text-center font-medium tabular-nums">{row.conversionRate}%</td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums">{money(row.payment)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 bg-primary/[0.07] font-bold">
                    <tr>
                      <td /><td className="sticky left-0 z-10 bg-[#f3f7f4] px-3 py-3">Итого</td>
                      <NumberCell value={data.totals.sessionCount} /><NumberCell value={data.totals.totalVisits} strong /><NumberCell value={data.totals.crmVisits} /><NumberCell value={data.totals.onefitVisits} blue /><NumberCell value={data.totals.trialStars} gold /><NumberCell value={data.totals.purchasesAfterTrial} /><NumberCell value={data.totals.averageVisits} />
                      <td className="px-3 py-3 text-center tabular-nums">{data.totals.conversionRate}%</td><td className="px-3 py-3 text-right tabular-nums text-primary">{money(data.totals.payment)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-dashed bg-stone-50/70 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Как считаются показатели:</strong> занятие попадает в отчёт после окончания; отменённые занятия не считаются. CRM — только статусы «Пришёл/Посетил». OneFit — только активные подтверждённые визиты. Звёздочка — первая неотменённая запись клиента в студии. Покупка — оплаченный абонемент более чем на 2 занятия, оформленный после первого занятия клиента.
          </section>
        </>
      ) : null}
    </div>
  );
};

const MetricCard = ({ icon: Icon, label, value, note, emphasis = false }: { icon: typeof UsersRound; label: string; value: string | number; note: string; emphasis?: boolean }) => (
  <div className={cn("rounded-xl border bg-white p-4 shadow-sm", emphasis && "border-primary/25 bg-primary/[0.045]")}>
    <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground"><span className={cn("flex h-7 w-7 items-center justify-center rounded-lg bg-stone-100", emphasis && "bg-primary/10 text-primary")}><Icon className="h-4 w-4" /></span>{label}</div>
    <p className={cn("text-2xl font-bold tabular-nums", emphasis && "text-primary")}>{value}</p>
    <p className="mt-1 truncate text-[11px] text-muted-foreground" title={note}>{note}</p>
  </div>
);

const TableHead = ({ label, hint }: { label: string; hint: string }) => <th className="min-w-[100px] px-3 py-3 text-center font-semibold" title={hint}>{label}</th>;
const NumberCell = ({ value, strong = false, blue = false, gold = false }: { value: number; strong?: boolean; blue?: boolean; gold?: boolean }) => <td className={cn("px-3 py-3 text-center tabular-nums", strong && "font-bold", blue && "font-semibold text-sky-700", gold && "font-semibold text-amber-600")}>{value}</td>;

export default OwnerPayroll;
