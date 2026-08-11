import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, addWeeks, endOfWeek, format, formatDistanceToNow, isSameDay, parseISO, startOfWeek } from "date-fns";
import { ru } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Copy, Loader2, Plus, RefreshCw, RotateCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fetchClientStatuses, getClientStatusForBooking } from "@/lib/client-status";
import { normalizeRoom, showsFirstBookingIndicator, type ScheduleSession } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import { CopyWeekDialog } from "@/components/schedule/CopyWeekDialog";
import { ScheduleGrid, type ScheduleView } from "@/components/schedule/ScheduleGrid";
import { SessionEditorDialog } from "@/components/schedule/SessionEditorDialog";
import { SessionParticipantsDialog } from "@/components/schedule/SessionParticipantsDialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

const viewOptions: Array<{ value: ScheduleView; label: string }> = [
  { value: "week", label: "Неделя" },
  { value: "day", label: "День" },
  { value: "trainers", label: "По тренерам" },
  { value: "rooms", label: "По залам" },
];

type ClassTypeOption = { id: string; name: string; color: string | null; duration_min?: number | null };
type CoachOption = { id: string; name: string };

const kazakhstanDate = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

export default function Schedule() {
  const queryClient = useQueryClient();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(new Date());
  const [view, setView] = useState<ScheduleView>(() => window.matchMedia("(max-width: 767px)").matches ? "day" : "week");
  const [coachFilter, setCoachFilter] = useState("all");
  const [roomFilter, setRoomFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [selectedSession, setSelectedSession] = useState<ScheduleSession | null>(null);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<ScheduleSession | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);

  const weekDate = addWeeks(new Date(), weekOffset);
  const weekStart = startOfWeek(weekDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(weekDate, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  useEffect(() => {
    if (selectedDay < weekStart || selectedDay > weekEnd) setSelectedDay(weekStart);
  }, [selectedDay, weekEnd, weekStart]);

  const { data: sessions = [], isLoading } = useQuery<ScheduleSession[]>({
    queryKey: ["schedule_sessions", format(weekStart, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_sessions")
        .select(`
          id, class_type_id, coach_id, start_time, end_time, capacity, room,
          booking_status, booking_closed_reason, is_cancelled, is_client_visible, session_kind,
          class_type:class_types(id,name,color,duration_min),
          coach:coaches(id,name),
          bookings:bookings(id,status,user_id,created_at,user:profiles(id,first_name,last_name,phone,email)),
          onefit_bookings:onefit_bookings(id,client_name,source_status,is_active),
          rental_booking:rental_bookings(id,renter_id,service_id,agreed_price,rental_status,notes,renter:profiles!rental_bookings_renter_id_fkey(id,first_name,last_name,phone,email))
        `)
        .gte("start_time", weekStart.toISOString())
        .lte("start_time", weekEnd.toISOString())
        .order("start_time");
      if (error) throw error;

      const raw = (data || []) as unknown as ScheduleSession[];
      const rentalBookingIds = raw.flatMap((item) => {
        const rental = Array.isArray(item.rental_booking) ? item.rental_booking[0] : item.rental_booking;
        return rental?.id ? [rental.id] : [];
      });
      const financialsByRental = new Map<string, { paid_amount: number; debt_amount: number; payment_status: "paid" | "partial" | "unpaid" }>();
      if (rentalBookingIds.length > 0) {
        const { data: financialRows, error: financialError } = await supabase
          .from("rental_booking_financials")
          .select("rental_booking_id,paid_amount,debt_amount,payment_status")
          .in("rental_booking_id", rentalBookingIds);
        if (financialError) throw financialError;
        for (const row of financialRows || []) {
          financialsByRental.set(row.rental_booking_id, {
            paid_amount: Number(row.paid_amount || 0),
            debt_amount: Number(row.debt_amount || 0),
            payment_status: row.payment_status as "paid" | "partial" | "unpaid",
          });
        }
      }
      const userIds = raw.flatMap((item) => item.bookings.map((booking) => booking.user_id)).filter(Boolean);
      const statuses = await fetchClientStatuses(userIds);
      return raw.map((item) => {
        const rental = Array.isArray(item.rental_booking) ? item.rental_booking[0] : item.rental_booking;
        const rentalWithFinancials = rental
          ? { ...rental, financials: financialsByRental.get(rental.id) || { paid_amount: 0, debt_amount: Number(rental.agreed_price || 0), payment_status: "unpaid" as const } }
          : item.rental_booking;
        return ({
        ...item,
        rental_booking: rentalWithFinancials,
        room: normalizeRoom(item.room),
        firstBookingCount: item.bookings.filter((booking) =>
          showsFirstBookingIndicator(booking.status)
          && getClientStatusForBooking(statuses.get(booking.user_id), booking.id)?.isFirstVisit,
        ).length,
        repeatBookingCount: item.bookings.filter((booking) =>
          showsFirstBookingIndicator(booking.status)
          && getClientStatusForBooking(statuses.get(booking.user_id), booking.id)?.isRepeatBeforeFirstVisit,
        ).length,
      });
      });
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: "always",
  });

  const { data: classTypes = [] } = useQuery({
    queryKey: ["schedule_class_types"],
    queryFn: async () => {
      const { data, error } = await supabase.from("class_types").select("id,name,color,duration_min").order("name");
      if (error) throw error;
      return (data || []) as ClassTypeOption[];
    },
  });

  const { data: coaches = [] } = useQuery({
    queryKey: ["schedule_coaches"],
    queryFn: async () => {
      const { data, error } = await supabase.from("coaches").select("id,name").eq("is_active", true).order("name");
      if (error) throw error;
      return (data || []) as CoachOption[];
    },
  });

  const { data: onefitRuns = [] } = useQuery({
    queryKey: ["onefit_sync_runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("onefit_sync_runs")
        .select("id,status,source_date,found_count,matched_count,unmatched_count,started_at,finished_at")
        .order("started_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 15_000,
  });

  const latestOnefitRun = onefitRuns[0];
  const lastSuccessfulOnefitRun = onefitRuns.find((run) => run.status === "success");
  const onefitRunning = latestOnefitRun?.status === "queued" || latestOnefitRun?.status === "running";

  const requestOnefitSync = useMutation({
    mutationFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const response = await fetch("/api/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session?.access_token || ""}`,
        },
        body: JSON.stringify({ action: "request-onefit-sync", sourceDate: kazakhstanDate() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось запустить обновление OneFit");
    },
    onSuccess: () => {
      toast.success("Обновление OneFit запущено");
      queryClient.invalidateQueries({ queryKey: ["onefit_sync_runs"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  useEffect(() => {
    if (latestOnefitRun?.status === "success" || latestOnefitRun?.status === "partial") {
      queryClient.invalidateQueries({ queryKey: ["schedule_sessions"] });
      queryClient.invalidateQueries({ queryKey: ["schedule_session_details"] });
    }
  }, [latestOnefitRun?.id, latestOnefitRun?.status, queryClient]);

  const filteredSessions = useMemo(() => sessions.filter((session) => {
    if (coachFilter !== "all" && (coachFilter === "none" ? Boolean(session.coach_id) : session.coach_id !== coachFilter)) return false;
    if (roomFilter !== "all" && normalizeRoom(session.room) !== roomFilter) return false;
    if (classFilter !== "all" && session.class_type_id !== classFilter) return false;
    return true;
  }), [classFilter, coachFilter, roomFilter, sessions]);

  const openSession = (session: ScheduleSession) => {
    if (session.session_kind === "rental") {
      openEditor(session);
      return;
    }
    setSelectedSession(session);
    setParticipantsOpen(true);
  };

  const openEditor = (session: ScheduleSession | null, date = selectedDay) => {
    setEditingSession(session);
    setSelectedDay(session ? parseISO(session.start_time) : date);
    setEditorOpen(true);
  };

  const resetFilters = () => {
    setCoachFilter("all");
    setRoomFilter("all");
    setClassFilter("all");
  };

  return (
    <div className="space-y-4 pb-8 animate-in fade-in">
      <header className="space-y-4 border-b pb-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Расписание</h1>
            <p className="mt-1 text-sm capitalize text-muted-foreground">{format(weekStart, "d MMMM", { locale: ru })} — {format(weekEnd, "d MMMM yyyy", { locale: ru })}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border bg-card shadow-sm">
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Предыдущая неделя" onClick={() => setWeekOffset((value) => value - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="ghost" className="h-9 px-3 text-sm" onClick={() => { setWeekOffset(0); setSelectedDay(new Date()); }}>Сегодня</Button>
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Следующая неделя" onClick={() => setWeekOffset((value) => value + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <Button variant="outline" size="sm" onClick={() => setCopyOpen(true)} disabled={sessions.length === 0}><Copy className="mr-1.5 h-4 w-4" />Копировать неделю</Button>
            <Button size="sm" onClick={() => openEditor(null)}><Plus className="mr-1.5 h-4 w-4" />Добавить занятие</Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="inline-flex w-fit max-w-full overflow-x-auto rounded-lg border bg-muted/30 p-1">
            {viewOptions.map((option) => <button key={option.value} type="button" onClick={() => setView(option.value)} className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition", view === option.value ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{option.label}</button>)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
              <span className="hidden sm:inline">
                {onefitRunning
                  ? "OneFit обновляется…"
                  : lastSuccessfulOnefitRun?.finished_at
                    ? `OneFit обновлён ${formatDistanceToNow(parseISO(lastSuccessfulOnefitRun.finished_at), { addSuffix: true, locale: ru })}`
                    : "OneFit ещё не обновлялся"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
                onClick={() => requestOnefitSync.mutate()}
                disabled={requestOnefitSync.isPending || onefitRunning}
                title="Получить свежие записи из OneFit"
              >
                {requestOnefitSync.isPending || onefitRunning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                Обновить
              </Button>
            </div>
            <Select value={classFilter} onValueChange={setClassFilter}><SelectTrigger className="h-9 w-[175px] text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Все направления</SelectItem>{classTypes.map((type) => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}</SelectContent></Select>
            <Select value={coachFilter} onValueChange={setCoachFilter}><SelectTrigger className="h-9 w-[175px] text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Все тренеры</SelectItem><SelectItem value="none">Без тренера</SelectItem>{coaches.map((coach) => <SelectItem key={coach.id} value={coach.id}>{coach.name}</SelectItem>)}</SelectContent></Select>
            <Select value={roomFilter} onValueChange={setRoomFilter}><SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Все залы</SelectItem><SelectItem value="Большой зал">Большой зал</SelectItem><SelectItem value="Малый зал">Малый зал</SelectItem></SelectContent></Select>
            {(classFilter !== "all" || coachFilter !== "all" || roomFilter !== "all") ? <Button variant="ghost" size="icon" className="h-9 w-9" title="Сбросить фильтры" onClick={resetFilters}><RotateCcw className="h-4 w-4" /></Button> : null}
          </div>
        </div>

        <div className={cn("flex gap-1 overflow-x-auto pb-1", view === "week" && "lg:hidden")}>
            {weekDays.map((day) => <button key={day.toISOString()} type="button" onClick={() => setSelectedDay(day)} className={cn("min-w-16 rounded-lg border px-2 py-1.5 text-center transition", isSameDay(selectedDay, day) ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/40")}><span className="block text-[10px] uppercase">{format(day, "EEE", { locale: ru })}</span><span className="block text-sm font-bold">{format(day, "d")}</span></button>)}
        </div>
      </header>

      {isLoading ? (
        <div className="space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-[680px] w-full" /></div>
      ) : (
        <ScheduleGrid view={view} weekDays={weekDays} selectedDay={selectedDay} sessions={filteredSessions} coaches={coaches} onOpenSession={openSession} />
      )}

      <SessionParticipantsDialog session={selectedSession} open={participantsOpen} onOpenChange={setParticipantsOpen} onEdit={(session) => openEditor(session)} />
      <SessionEditorDialog open={editorOpen} onOpenChange={setEditorOpen} session={editingSession} initialDate={selectedDay} classTypes={classTypes} coaches={coaches} />
      <CopyWeekDialog open={copyOpen} onOpenChange={setCopyOpen} sourceWeek={weekStart} sessions={sessions} />
    </div>
  );
}
