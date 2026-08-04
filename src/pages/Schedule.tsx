import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  format,
  startOfWeek,
  endOfWeek,
  addDays,
  addWeeks,
  parseISO,
  isSameDay,
  addMinutes
} from "date-fns";
import { ru } from "date-fns/locale";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Copy,
  Edit,
  Trash2,
  User,
  Clock,
  Users
  ,LockKeyhole
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function Schedule() {
  const queryClient = useQueryClient();
  const [weekOffset, setWeekOffset] = useState(0);
  const [filterCoachId, setFilterCoachId] = useState("all");
  const [selectedDay, setSelectedDay] = useState(new Date());

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<any>(null);
  const [bookingAction, setBookingAction] = useState<"open" | "closed" | "cancelled">("open");
  const [bookingReason, setBookingReason] = useState("");
  const [formData, setFormData] = useState({
    classTypeId: "",
    coachId: "",
    date: format(new Date(), 'yyyy-MM-dd'),
    time: "10:00",
    capacity: "10"
  });

  const baseDate = addWeeks(new Date(), weekOffset);
  const weekStart = startOfWeek(baseDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(baseDate, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i));

  const { data: sessions = [], isLoading: isSessionsLoading } = useQuery({
    queryKey: ['sessions', weekStart.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedule_sessions')
        .select('*, class_type:class_types(*), coach:coaches(name), bookings(count)')
        .gte('start_time', weekStart.toISOString())
        .lte('start_time', weekEnd.toISOString())
        .order('start_time');
      if (error) throw error;
      return data;
    }
  });

  const { data: classTypes = [] } = useQuery({
    queryKey: ['class_types'],
    queryFn: async () => {
      const { data } = await supabase.from('class_types').select('*');
      return data || [];
    }
  });

  const { data: coaches = [] } = useQuery({
    queryKey: ['coaches'],
    queryFn: async () => {
      const { data } = await supabase.from('coaches').select('id, name').eq('is_active', true);
      return data || [];
    }
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!formData.classTypeId) throw new Error("Выберите тип занятия");
      const type = classTypes.find((t: any) => t.id === formData.classTypeId);
      const [year, month, day] = formData.date.split('-').map(Number);
      const [hours, minutes] = formData.time.split(':').map(Number);
      const startTime = new Date(year, month - 1, day, hours, minutes);
      const endTime = addMinutes(startTime, type.duration_min);
      const payload = {
        class_type_id: formData.classTypeId,
        coach_id: formData.coachId || null,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        capacity: parseInt(formData.capacity)
      };
      if (editingSession) {
        const { error } = await supabase.from('schedule_sessions').update(payload).eq('id', editingSession.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('schedule_sessions').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setIsModalOpen(false);
      toast.success(editingSession ? "Занятие обновлено" : "Занятие создано");
    },
    onError: (err: any) => toast.error(err.message)
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('schedule_sessions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast.success("Занятие удалено");
    },
    onError: (err: any) => toast.error(err.message)
  });

  const bookingStatusMutation = useMutation({
    mutationFn: async () => {
      if (!editingSession) return;
      if (bookingAction !== "open" && !bookingReason.trim()) throw new Error("Укажи причину");
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("schedule_sessions").update({
        booking_status: bookingAction,
        is_cancelled: bookingAction === "cancelled",
        booking_closed_reason: bookingAction === "open" ? null : bookingReason.trim(),
        booking_closed_at: bookingAction === "open" ? null : new Date().toISOString(),
        booking_closed_by: bookingAction === "open" ? null : user?.id,
      }).eq("id", editingSession.id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["sessions"] }); queryClient.invalidateQueries({ queryKey: ["dashboard_upcoming_classes"] }); setIsModalOpen(false); toast.success(bookingAction === "open" ? "Запись открыта" : bookingAction === "closed" ? "Запись закрыта" : "Занятие отменено"); },
    onError: (error: Error) => toast.error(error.message),
  });

  const duplicateWeekMutation = useMutation({
    mutationFn: async () => {
      if (!sessions || sessions.length === 0) throw new Error("На этой неделе нет занятий");
      const newSessions = sessions.map((session: any) => {
        const start = new Date(session.start_time);
        const end = new Date(session.end_time);
        start.setDate(start.getDate() + 7);
        end.setDate(end.getDate() + 7);
        return { class_type_id: session.class_type_id, coach_id: session.coach_id, start_time: start.toISOString(), end_time: end.toISOString(), capacity: session.capacity };
      });
      const { error } = await supabase.from('schedule_sessions').insert(newSessions);
      if (error) throw error;
    },
    onSuccess: () => { setWeekOffset(prev => prev + 1); toast.success("Неделя дублирована!"); },
    onError: (err: any) => toast.error(err.message)
  });

  const openCreateModal = (dateStr: string) => {
    setEditingSession(null);
    setFormData({ classTypeId: "", coachId: "", date: dateStr, time: "10:00", capacity: "10" });
    setIsModalOpen(true);
  };

  const openEditModal = (session: any) => {
    setEditingSession(session);
    setFormData({
      classTypeId: session.class_type_id,
      coachId: session.coach_id || "",
      date: format(parseISO(session.start_time), 'yyyy-MM-dd'),
      time: format(parseISO(session.start_time), 'HH:mm'),
      capacity: session.capacity?.toString() || "10"
    });
    setBookingAction(session.booking_status || (session.is_cancelled ? "cancelled" : "open"));
    setBookingReason(session.booking_closed_reason || "");
    setIsModalOpen(true);
  };

  const getFilteredSessions = (day: Date) => {
    const daySessions = sessions.filter((s: any) => isSameDay(parseISO(s.start_time), day));
    if (filterCoachId === "all") return daySessions;
    if (filterCoachId === "none") return daySessions.filter((s: any) => !s.coach_id);
    return daySessions.filter((s: any) => s.coach_id === filterCoachId);
  };

  const SessionCard = ({ session }: { session: any }) => {
    const bookedCount = session.bookings?.[0]?.count || 0;
    const isFull = bookedCount >= session.capacity;
    return (
      <div
        className={cn("group relative rounded-lg border shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden", session.booking_status === "cancelled" ? "border-slate-400 bg-slate-200 text-slate-600" : session.booking_status === "closed" ? "border-slate-300 bg-slate-100" : "border-gray-100 bg-white")}
        onClick={() => openEditModal(session)}
      >
        <div className="w-full h-1" style={{ backgroundColor: session.class_type?.color || '#3b82f6' }} />
        <div className="p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md whitespace-nowrap tabular-nums">
              {format(parseISO(session.start_time), 'HH:mm')}–{format(parseISO(session.end_time), 'HH:mm')}
            </span>
            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button className="p-1 text-gray-400 hover:text-blue-500 rounded" onClick={e => { e.stopPropagation(); openEditModal(session); }}>
                <Edit className="w-3 h-3" />
              </button>
              <button className="p-1 text-gray-400 hover:text-red-500 rounded" onClick={e => { e.stopPropagation(); if (confirm("Удалить?")) deleteMutation.mutate(session.id); }}>
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="font-semibold text-sm truncate mb-1.5">{session.class_type?.name}</div>
          {session.booking_status !== "open" && <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold text-slate-600"><LockKeyhole className="h-3 w-3" />{session.booking_status === "cancelled" ? "Отменено" : "Запись закрыта"}</div>}
          {session.booking_closed_reason && <div className="mb-1.5 truncate text-[10px] text-muted-foreground" title={session.booking_closed_reason}>{session.booking_closed_reason}</div>}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1 truncate">
              <User className="w-3 h-3 shrink-0" />
              <span className="truncate">{session.coach?.name || '—'}</span>
            </span>
            <span className={cn("shrink-0 ml-1 font-semibold px-1.5 py-0.5 rounded-md", isFull ? 'bg-red-100 text-red-700' : 'bg-blue-50 text-blue-700')}>
              {bookedCount}/{session.capacity}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4 animate-in fade-in">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b pb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Расписание</h1>
          <p className="text-muted-foreground text-sm capitalize">
            {format(weekStart, 'd MMM', { locale: ru })} — {format(weekEnd, 'd MMM yyyy', { locale: ru })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-card border rounded-md shadow-sm">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setWeekOffset(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" onClick={() => setWeekOffset(0)} className="px-3 h-8 text-sm font-medium">
              Сегодня
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setWeekOffset(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={() => { if (confirm("Скопировать неделю?")) duplicateWeekMutation.mutate(); }} disabled={duplicateWeekMutation.isPending || sessions.length === 0}>
            <Copy className="mr-1.5 h-3.5 w-3.5" /> Копия недели
          </Button>
          <Button size="sm" onClick={() => openCreateModal(format(new Date(), 'yyyy-MM-dd'))}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Занятие
          </Button>
        </div>
      </div>

      {/* ФИЛЬТР */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground shrink-0">Тренер:</span>
        <Select value={filterCoachId} onValueChange={setFilterCoachId}>
          <SelectTrigger className="w-[180px] h-8 text-sm">
            <SelectValue placeholder="Все" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все тренеры</SelectItem>
            <SelectItem value="none">Без тренера</SelectItem>
            {coaches.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* МОБИЛЬНЫЙ ВЫБОР ДНЯ */}
      <div className="lg:hidden grid grid-cols-7 gap-1">
        {weekDays.map(day => {
          const isSelected = isSameDay(day, selectedDay);
          const isToday = isSameDay(day, new Date());
          const count = getFilteredSessions(day).length;
          return (
            <button
              key={day.toISOString()}
              onClick={() => setSelectedDay(day)}
              className={cn(
                "flex flex-col items-center py-2 rounded-lg border transition-all relative",
                isSelected ? "bg-primary text-white border-primary shadow-md" : "bg-white border-gray-100 text-gray-500",
                isToday && !isSelected && "border-blue-300 bg-blue-50/50"
              )}
            >
              <span className="text-[9px] font-bold uppercase">{format(day, 'EEE', { locale: ru }).slice(0, 2)}</span>
              <span className="text-base font-bold leading-tight">{format(day, 'd')}</span>
              {count > 0 && (
                <span className={cn("text-[9px] font-bold leading-none", isSelected ? "text-white/80" : "text-primary")}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* МОБИЛЬНЫЙ СПИСОК */}
      <div className="lg:hidden">
        <div className="text-sm font-medium text-muted-foreground capitalize mb-3">
          {format(selectedDay, 'EEEE, d MMMM', { locale: ru })}
        </div>
        <div className="space-y-2">
          {isSessionsLoading ? (
            <div className="text-center text-sm text-muted-foreground py-8">Загрузка...</div>
          ) : getFilteredSessions(selectedDay).length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8 border border-dashed rounded-lg">Нет занятий</div>
          ) : (
            getFilteredSessions(selectedDay).map((session: any) => (
              <SessionCard key={session.id} session={session} />
            ))
          )}
        </div>
        <Button variant="outline" className="w-full mt-3 text-sm" onClick={() => openCreateModal(format(selectedDay, 'yyyy-MM-dd'))}>
          <Plus className="w-4 h-4 mr-1" /> Добавить занятие
        </Button>
      </div>

      {/* ДЕСКТОП СЕТКА */}
      <div className="hidden lg:grid grid-cols-7 gap-3">
        {weekDays.map(day => {
          const daySessions = getFilteredSessions(day);
          const isToday = isSameDay(day, new Date());
          return (
            <div key={day.toISOString()} className={cn("flex flex-col rounded-xl border bg-card overflow-hidden min-h-[320px]", isToday && "ring-2 ring-primary/40")}>
              <div className={cn("text-center py-2.5 border-b", isToday ? "bg-primary/10 text-primary" : "bg-muted/30")}>
                <div className="text-xs font-semibold uppercase tracking-wide opacity-70">
                  {format(day, 'EEE', { locale: ru })}
                </div>
                <div className={cn("text-xl font-bold leading-tight", isToday && "text-primary")}>
                  {format(day, 'd')}
                </div>
                {daySessions.length > 0 && (
                  <div className="text-[10px] text-muted-foreground">{daySessions.length} зан.</div>
                )}
              </div>
              <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                {isSessionsLoading ? (
                  <p className="text-center text-xs text-muted-foreground p-3">Загрузка...</p>
                ) : daySessions.length === 0 ? (
                  <p className="text-center text-xs text-muted-foreground opacity-40 p-3">Нет занятий</p>
                ) : (
                  daySessions.map((session: any) => <SessionCard key={session.id} session={session} />)
                )}
              </div>
              <div className="p-2 border-t bg-white">
                <Button variant="ghost" size="sm" className="w-full h-7 text-xs text-muted-foreground hover:text-primary" onClick={() => openCreateModal(format(day, 'yyyy-MM-dd'))}>
                  <Plus className="w-3 h-3 mr-1" /> Добавить
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* MODAL */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingSession ? "Редактировать занятие" : "Новое занятие"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Тип занятия</Label>
              <Select value={formData.classTypeId} onValueChange={val => setFormData({...formData, classTypeId: val})}>
                <SelectTrigger><SelectValue placeholder="Выберите тип" /></SelectTrigger>
                <SelectContent>
                  {classTypes.map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                        {t.name} ({t.duration_min} мин)
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {editingSession && <div className="grid gap-2 rounded-xl border bg-slate-50 p-3">
              <Label>Доступность записи</Label>
              <Select value={bookingAction} onValueChange={(value: "open" | "closed" | "cancelled") => setBookingAction(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">Запись открыта</SelectItem><SelectItem value="closed">Закрыть новые записи</SelectItem><SelectItem value="cancelled">Занятие отменено</SelectItem></SelectContent></Select>
              {bookingAction !== "open" && <><Label>Причина</Label><Input value={bookingReason} onChange={e => setBookingReason(e.target.value)} placeholder="Например: нет тренера" /></>}
              <Button type="button" variant="outline" onClick={() => bookingStatusMutation.mutate()} disabled={bookingStatusMutation.isPending}>{bookingAction === "open" ? "Открыть запись" : bookingAction === "closed" ? "Закрыть запись" : "Отменить занятие"}</Button>
            </div>}
            <div className="grid gap-2">
              <Label>Тренер</Label>
              <Select value={formData.coachId} onValueChange={val => setFormData({...formData, coachId: val})}>
                <SelectTrigger><SelectValue placeholder="Без тренера" /></SelectTrigger>
                <SelectContent>
                  {coaches.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Дата</Label>
                <Input type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} />
              </div>
              <div className="grid gap-2">
                <Label>Время начала</Label>
                <Input type="time" value={formData.time} onChange={e => setFormData({...formData, time: e.target.value})} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Мест в группе</Label>
              <Input type="number" min="1" value={formData.capacity} onChange={e => setFormData({...formData, capacity: e.target.value})} />
            </div>
          </div>
          <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Сохранение..." : "Сохранить"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
