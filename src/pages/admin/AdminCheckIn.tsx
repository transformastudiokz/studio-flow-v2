import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { updateBookingStatus } from "@/lib/booking-status";
import { format, addDays, addWeeks, isSameDay, startOfWeek, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { ChevronLeft, ChevronRight, UserPlus, Search, Users, Loader2, Phone, Globe, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const AdminCheckIn = () => {
  const queryClient = useQueryClient();

  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(new Date());
  const [pendingBookingIds, setPendingBookingIds] = useState<Set<string>>(() => new Set());
  const [walkInSessionId, setWalkInSessionId] = useState<string | null>(null);
  const [walkInSearch, setWalkInSearch] = useState("");
  const [walkInClientId, setWalkInClientId] = useState<string | null>(null);
  const [aggInputs, setAggInputs] = useState<Record<string, { name: string; count: string }>>({});
  const [savingAgg, setSavingAgg] = useState<string | null>(null);

  const weekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i));

  // Sessions + bookings for selected day
  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ["checkin_day", format(selectedDay, "yyyy-MM-dd")],
    queryFn: async () => {
      const dayStart = new Date(selectedDay);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(selectedDay);
      dayEnd.setHours(23, 59, 59, 999);
      const { data, error } = await supabase
        .from("schedule_sessions")
        .select(`
          id, start_time, end_time, capacity,
          class_type:class_types(name, color),
          coach:coaches(name),
          bookings(id, status, subscription_id, user:profiles(first_name, last_name, phone)),
          aggregators:aggregator_session_visits(id, aggregator_name, visit_count)
        `)
        .gte("start_time", dayStart.toISOString())
        .lte("start_time", dayEnd.toISOString())
        .order("start_time");
      if (error) throw error;
      return data || [];
    },
  });

  // Active clients for walk-in dialog
  const { data: activeClients = [], isLoading: loadingClients } = useQuery({
    queryKey: ["walkin_clients_checkin"],
    queryFn: async () => {
      const todayStr = new Date().toISOString().split("T")[0];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, phone")
        .eq("role", "client")
        .order("first_name");
      const { data: subs } = await supabase
        .from("user_subscriptions")
        .select("id, user_id, visits_remaining, end_date, plan:subscription_plans(name)")
        .eq("is_active", true)
        .gt("visits_remaining", 0)
        .or("end_date.is.null,end_date.gte." + todayStr);
      return (profiles || [])
        .map((p: any) => ({
          ...p,
          subscription: subs?.find((s: any) => s.user_id === p.id) || null,
        }))
        .filter((p: any) => p.subscription !== null);
    },
    enabled: !!walkInSessionId,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ bookingId, status }: { bookingId: string; status: string }) => {
      await updateBookingStatus(bookingId, status);
    },
    onMutate: ({ bookingId }) => setPendingBookingIds((current) => new Set(current).add(bookingId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checkin_day", format(selectedDay, "yyyy-MM-dd")] });
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
    onSettled: (_data, _error, variables) => setPendingBookingIds((current) => {
      const next = new Set(current);
      next.delete(variables.bookingId);
      return next;
    }),
  });

  const deleteBookingMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      await updateBookingStatus(bookingId, "cancelled");
    },
    onSuccess: () => {
      toast.success("Запись удалена");
      queryClient.invalidateQueries({ queryKey: ["checkin_day", format(selectedDay, "yyyy-MM-dd")] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const walkInMutation = useMutation({
    mutationFn: async ({ clientId, sessionId }: { clientId: string; sessionId: string }) => {
      const todayStr = new Date().toISOString().split("T")[0];
      const { data: existing } = await supabase
        .from("bookings")
        .select("id")
        .eq("session_id", sessionId)
        .eq("user_id", clientId)
        .not("status", "in", '("cancelled","late_cancel")')
        .maybeSingle();
      if (existing) throw new Error("Клиент уже записан на это занятие");
      const { data: subs } = await supabase
        .from("user_subscriptions")
        .select("id")
        .eq("user_id", clientId)
        .eq("is_active", true)
        .gt("visits_remaining", 0)
        .or("end_date.is.null,end_date.gte." + todayStr)
        .order("end_date", { ascending: true, nullsFirst: false })
        .limit(1);
      if (!subs || subs.length === 0) throw new Error("Нет активного абонемента");
      const { error } = await supabase.from("bookings").insert({
        session_id: sessionId,
        user_id: clientId,
        subscription_id: subs[0].id,
        status: "booked",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Клиент записан!");
      setWalkInSessionId(null);
      setWalkInClientId(null);
      setWalkInSearch("");
      queryClient.invalidateQueries({ queryKey: ["checkin_day", format(selectedDay, "yyyy-MM-dd")] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleSaveAgg = async (sessionId: string) => {
    const inp = aggInputs[sessionId] || { name: "1Fit", count: "" };
    if (!inp.count || parseInt(inp.count) <= 0) {
      toast.error("Введите количество клиентов");
      return;
    }
    setSavingAgg(sessionId);
    const { error } = await supabase.from("aggregator_session_visits").insert({
      session_id: sessionId,
      aggregator_name: inp.name || "1Fit",
      visit_count: parseInt(inp.count),
      price_per_visit: 0,
    });
    setSavingAgg(null);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Агрегатор записан");
      setAggInputs((prev) => ({ ...prev, [sessionId]: { name: inp.name || "1Fit", count: "" } }));
      queryClient.invalidateQueries({ queryKey: ["checkin_day", format(selectedDay, "yyyy-MM-dd")] });
    }
  };

  const getStatusBg = (status: string) => {
    if (status === "completed") return "bg-green-50 border-green-100";
    if (status === "absent") return "bg-orange-50 border-orange-100";
    if (status === "cancelled") return "bg-red-50 border-red-100";
    if (status === "late_cancel") return "bg-red-100 border-red-200";
    return "bg-slate-50 border-gray-100";
  };

  const walkInSession = (sessions as any[]).find((s) => s.id === walkInSessionId);
  const filteredWalkIn = activeClients.filter((c: any) => {
    const q = walkInSearch.toLowerCase();
    return !q || `${c.first_name} ${c.last_name} ${c.phone}`.toLowerCase().includes(q);
  });

  return (
    <div className="flex flex-col gap-4 pb-20 animate-in fade-in">
      <div>
        <h1 className="text-xl font-bold">Запись / Посещаемость</h1>
        <p className="text-xs text-muted-foreground">Выберите день</p>
      </div>

      {/* ── Day picker ─────────────────────────────────────────────── */}
      <div className="space-y-2 bg-white border border-gray-100 rounded-2xl p-3 shadow-sm">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setWeekOffset((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs font-medium text-muted-foreground capitalize">
            {format(weekStart, "d MMM", { locale: ru })} — {format(addDays(weekStart, 6), "d MMM yyyy", { locale: ru })}
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setWeekOffset((p) => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {weekDays.map((day) => {
            const isSelected = isSameDay(day, selectedDay);
            const isToday = isSameDay(day, new Date());
            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDay(day)}
                className={cn(
                  "flex flex-col items-center py-1.5 rounded-lg border transition-all",
                  isSelected
                    ? "bg-primary text-white border-primary shadow-md"
                    : isToday
                    ? "border-blue-300 bg-blue-50/50 text-gray-700"
                    : "bg-white border-gray-100 text-gray-500"
                )}
              >
                <span className="text-[9px] font-bold uppercase">
                  {format(day, "EEE", { locale: ru }).slice(0, 2)}
                </span>
                <span className="text-sm font-bold leading-tight">{format(day, "d")}</span>
              </button>
            );
          })}
        </div>
        <p className="text-center text-xs text-muted-foreground capitalize pt-0.5">
          {format(selectedDay, "eeee, d MMMM", { locale: ru })}
        </p>
      </div>

      {/* ── Sessions ───────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin text-primary" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-12 border border-dashed rounded-2xl text-muted-foreground text-sm">
          На этот день занятий нет
        </div>
      ) : (
        (sessions as any[]).map((session) => {
          const activeBookings = (session.bookings || []).filter(
            (b: any) => b.status !== "cancelled" && b.status !== "late_cancel"
          );
          const allBookings = session.bookings || [];
          const aggInp = aggInputs[session.id] || { name: "1Fit", count: "" };
          const existingAggs: any[] = session.aggregators || [];

          return (
            <div
              key={session.id}
              className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden"
            >
              {/* Session header */}
              <div className="flex">
                <div
                  className="w-1.5 shrink-0"
                  style={{ backgroundColor: session.class_type?.color || "#3b82f6" }}
                />
                <div className="p-3 flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-sm truncate">{session.class_type?.name}</p>
                      <p className="text-xs text-gray-500">
                        {format(parseISO(session.start_time), "HH:mm")}
                        {session.end_time && ` – ${format(parseISO(session.end_time), "HH:mm")}`}
                        {session.coach?.name && ` · ${session.coach.name}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 bg-blue-50 rounded-lg px-2 py-1 shrink-0">
                      <Users className="w-3.5 h-3.5 text-blue-500" />
                      <span className="text-xs font-bold text-blue-700">
                        {activeBookings.length}/{session.capacity}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-3 pb-3 space-y-2 border-t border-gray-50 pt-2">
                {/* Bookings list */}
                {allBookings.length === 0 ? (
                  <p className="text-xs text-gray-400 italic text-center py-1">Нет записей</p>
                ) : (
                  allBookings.map((booking: any) => {
                    const client = booking.user;
                    return (
                      <div
                        key={booking.id}
                        className={`flex items-center gap-2 p-2 rounded-xl border ${getStatusBg(booking.status)}`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate leading-tight">
                            {client ? `${client.first_name} ${client.last_name || ""}` : "—"}
                          </p>
                          <p className="text-[10px] text-gray-400 truncate">{client?.phone}</p>
                        </div>
                        <Select
                          value={booking.status}
                          disabled={pendingBookingIds.has(booking.id)}
                          onValueChange={(val) => {
                            updateStatusMutation.mutate({ bookingId: booking.id, status: val });
                          }}
                        >
                          <SelectTrigger className="w-[100px] h-7 text-[11px] shrink-0 font-medium">
                            {pendingBookingIds.has(booking.id) ? (
                              <Loader2 className="h-3 w-3 animate-spin mx-auto" />
                            ) : (
                              <SelectValue />
                            )}
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="booked">Записан</SelectItem>
                            <SelectItem value="completed">Пришел</SelectItem>
                            <SelectItem value="absent">Не пришел</SelectItem>
                            <SelectItem value="cancelled">Отмена</SelectItem>
                            <SelectItem value="late_cancel">Поздняя отм.</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0 text-gray-300 hover:text-red-500 hover:bg-red-50"
                          disabled={deleteBookingMutation.isPending}
                          onClick={() => {
                            if (confirm(`Удалить запись ${client?.first_name || ""}?`))
                              deleteBookingMutation.mutate(booking.id);
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    );
                  })
                )}

                {/* Add client button */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs rounded-xl border-dashed text-muted-foreground"
                  onClick={() => {
                    setWalkInSessionId(session.id);
                    setWalkInClientId(null);
                    setWalkInSearch("");
                  }}
                >
                  <UserPlus className="w-3.5 h-3.5 mr-1.5" /> Добавить клиента
                </Button>

                {/* Aggregator section */}
                <div className="border border-gray-100 rounded-xl p-2.5 space-y-1.5 bg-gray-50/50">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                    <Globe className="w-3 h-3" /> Агрегатор
                  </div>
                  {existingAggs.length > 0 && (
                    <div className="space-y-0.5">
                      {existingAggs.map((a: any) => (
                        <div key={a.id} className="text-xs flex justify-between text-gray-500">
                          <span>{a.aggregator_name}</span>
                          <span className="font-semibold text-blue-600">{a.visit_count} чел.</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-1.5">
                    <Input
                      className="h-7 text-xs flex-1 bg-white"
                      placeholder="Название (1Fit...)"
                      value={aggInp.name}
                      onChange={(e) =>
                        setAggInputs((prev) => ({
                          ...prev,
                          [session.id]: { ...aggInp, name: e.target.value },
                        }))
                      }
                    />
                    <Input
                      className="h-7 text-xs w-14 bg-white"
                      type="number"
                      min="0"
                      placeholder="0"
                      value={aggInp.count}
                      onChange={(e) =>
                        setAggInputs((prev) => ({
                          ...prev,
                          [session.id]: { ...aggInp, count: e.target.value },
                        }))
                      }
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs px-2.5 shrink-0 bg-white"
                      onClick={() => handleSaveAgg(session.id)}
                      disabled={savingAgg === session.id}
                    >
                      {savingAgg === session.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        "OK"
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}

      {/* ── Walk-in dialog ─────────────────────────────────────────── */}
      <Dialog
        open={!!walkInSessionId}
        onOpenChange={(open) => {
          if (!open) setWalkInSessionId(null);
        }}
      >
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>Добавить клиента</DialogTitle>
            {walkInSession && (
              <p className="text-sm text-muted-foreground">
                {walkInSession.class_type?.name} ·{" "}
                {format(parseISO(walkInSession.start_time), "HH:mm")}
              </p>
            )}
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              className="pl-9"
              placeholder="Поиск клиента..."
              value={walkInSearch}
              onChange={(e) => {
                setWalkInSearch(e.target.value);
                setWalkInClientId(null);
              }}
              autoFocus
            />
          </div>

          {loadingClients ? (
            <div className="flex justify-center py-4">
              <Loader2 className="animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {filteredWalkIn.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-4">
                  Клиентов с активным абонементом нет
                </p>
              ) : (
                filteredWalkIn.map((c: any) => (
                  <button
                    key={c.id}
                    onClick={() => setWalkInClientId(c.id)}
                    className={cn(
                      "w-full text-left p-3 rounded-xl border transition-all",
                      walkInClientId === c.id
                        ? "border-primary bg-primary/5"
                        : "border-gray-100 bg-white hover:border-gray-200"
                    )}
                  >
                    <div className="font-medium text-sm">
                      {c.first_name} {c.last_name}
                    </div>
                    <div className="text-xs text-gray-400 flex items-center gap-2 mt-0.5">
                      <Phone className="w-3 h-3" />
                      {c.phone}
                      <span className="text-green-600 font-medium">
                        · {c.subscription?.visits_remaining} зан.
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          <Button
            className="w-full rounded-xl"
            disabled={!walkInClientId || walkInMutation.isPending}
            onClick={() =>
              walkInClientId &&
              walkInSessionId &&
              walkInMutation.mutate({ clientId: walkInClientId, sessionId: walkInSessionId })
            }
          >
            {walkInMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Записать
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminCheckIn;
