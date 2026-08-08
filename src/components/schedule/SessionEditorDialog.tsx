import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { normalizeRoom, resolveAvailableRoom, STUDIO_ROOMS, type ScheduleSession, type SessionBookingStatus } from "@/lib/schedule";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: ScheduleSession | null;
  initialDate: Date;
  classTypes: Array<{ id: string; name: string; color: string | null; duration_min?: number | null }>;
  coaches: Array<{ id: string; name: string }>;
};

type OverlapSession = {
  id: string;
  start_time: string;
  end_time: string;
  room: string | null;
  coach_id: string | null;
  booking_status: string;
  class_type: { name: string } | null;
};

const emptyForm = (date: Date) => ({
  classTypeId: "",
  coachId: "none",
  date: format(date, "yyyy-MM-dd"),
  startTime: "10:00",
  endTime: "11:00",
  room: "Большой зал",
  capacity: "12",
  bookingStatus: "open" as SessionBookingStatus,
  clientVisible: true,
  reason: "",
});

export function SessionEditorDialog({ open, onOpenChange, session, initialDate, classTypes, coaches }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => emptyForm(initialDate));

  useEffect(() => {
    if (!open) return;
    if (!session) {
      setForm(emptyForm(initialDate));
      return;
    }
    setForm({
      classTypeId: session.class_type_id,
      coachId: session.coach_id || "none",
      date: format(parseISO(session.start_time), "yyyy-MM-dd"),
      startTime: format(parseISO(session.start_time), "HH:mm"),
      endTime: format(parseISO(session.end_time), "HH:mm"),
      room: normalizeRoom(session.room),
      capacity: String(session.capacity || 12),
      bookingStatus: session.booking_status || "open",
      clientVisible: session.is_client_visible !== false,
      reason: session.booking_closed_reason || "",
    });
  }, [initialDate, open, session]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.classTypeId) throw new Error("Выбери направление");
      const start = new Date(`${form.date}T${form.startTime}:00`);
      const end = new Date(`${form.date}T${form.endTime}:00`);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error("Время окончания должно быть позже начала");
      const capacity = Number.parseInt(form.capacity, 10);
      if (!Number.isFinite(capacity) || capacity < 1) throw new Error("Укажи вместимость");
      if (session) {
        const occupied = session.bookings.filter((booking) => !["cancelled", "late_cancel", "absent"].includes(booking.status)).length;
        if (capacity < occupied) throw new Error(`Уже записано ${occupied} человек — нельзя уменьшить вместимость ниже этого числа`);
        const scheduleChanged =
          form.classTypeId !== session.class_type_id ||
          (form.coachId === "none" ? null : form.coachId) !== session.coach_id ||
          form.room !== normalizeRoom(session.room) ||
          form.date !== format(parseISO(session.start_time), "yyyy-MM-dd") ||
          form.startTime !== format(parseISO(session.start_time), "HH:mm") ||
          form.endTime !== format(parseISO(session.end_time), "HH:mm") ||
          capacity !== session.capacity ||
          form.bookingStatus !== session.booking_status;
          // Видимость для клиентов — самостоятельная настройка и тоже считается изменением расписания.
        const visibilityChanged = form.clientVisible !== (session.is_client_visible !== false);
        if (occupied > 0 && (scheduleChanged || visibilityChanged)) {
          const destructive = form.bookingStatus === "cancelled";
          const question = destructive
            ? `Отменить занятие, на которое записано ${occupied} чел.? Записи останутся в истории, а новая запись будет закрыта.`
            : `На занятие записано ${occupied} чел. Изменится расписание, тренер, зал, направление или вместимость. Записи клиентов сохранятся. Продолжить?`;
          if (!window.confirm(question)) throw new Error("__cancelled__");
        }
      }
      if (form.bookingStatus !== "open" && !form.reason.trim()) throw new Error("Укажи причину закрытия или отмены");

      let conflictQuery = supabase
        .from("schedule_sessions")
        .select("id,start_time,end_time,room,coach_id,booking_status,class_type:class_types(name)")
        .lt("start_time", end.toISOString())
        .gt("end_time", start.toISOString());
      if (session?.id) conflictQuery = conflictQuery.neq("id", session.id);
      const { data: overlaps, error: conflictError } = await conflictQuery;
      if (conflictError) throw conflictError;
      const activeOverlaps = ((overlaps || []) as unknown as OverlapSession[]).filter((item) => item.booking_status !== "cancelled");
      const coachConflict = activeOverlaps.find((item) => form.coachId !== "none" && item.coach_id === form.coachId);
      if (coachConflict) {
        throw new Error(`У тренера уже есть занятие: ${format(parseISO(coachConflict.start_time), "HH:mm")}–${format(parseISO(coachConflict.end_time), "HH:mm")}`);
      }

      const resolvedRoom = resolveAvailableRoom(form.room, activeOverlaps.map((item) => item.room));
      if (!resolvedRoom) throw new Error(form.room === "Большой зал" ? "Оба зала уже заняты в это время" : "Малый зал уже занят в это время");

      const { data: { user } } = await supabase.auth.getUser();
      const payload = {
        class_type_id: form.classTypeId,
        coach_id: form.coachId === "none" ? null : form.coachId,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        capacity,
        room: resolvedRoom,
        booking_status: form.bookingStatus,
        is_cancelled: form.bookingStatus === "cancelled",
        booking_closed_reason: form.bookingStatus === "open" ? null : form.reason.trim(),
        booking_closed_at: form.bookingStatus === "open" ? null : new Date().toISOString(),
        booking_closed_by: form.bookingStatus === "open" ? null : user?.id || null,
        is_client_visible: form.clientVisible,
      };

      const result = session
        ? await supabase.from("schedule_sessions").update(payload).eq("id", session.id)
        : await supabase.from("schedule_sessions").insert(payload);
      if (result.error) throw result.error;
      return { autoAssignedSmallRoom: form.room === "Большой зал" && resolvedRoom === "Малый зал" };
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["schedule_sessions"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard_upcoming_classes"] }),
        queryClient.invalidateQueries({ queryKey: ["attendance_report"] }),
      ]);
      onOpenChange(false);
      toast.success(session ? "Занятие обновлено" : "Занятие создано", {
        description: result.autoAssignedSmallRoom ? "Большой зал занят — занятие автоматически размещено в Малом зале" : undefined,
      });
    },
    onError: (error: Error) => { if (error.message !== "__cancelled__") toast.error(error.message); },
  });

  const selectClassType = (classTypeId: string) => {
    const type = classTypes.find((item) => item.id === classTypeId);
    if (!type?.duration_min) return setForm((current) => ({ ...current, classTypeId }));
    const start = new Date(`${form.date}T${form.startTime}:00`);
    const end = new Date(start.getTime() + type.duration_min * 60_000);
    setForm((current) => ({ ...current, classTypeId, endTime: format(end, "HH:mm") }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>{session ? "Настройки занятия" : "Новое занятие"}</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2"><Label>Направление</Label><Select value={form.classTypeId} onValueChange={selectClassType}><SelectTrigger><SelectValue placeholder="Выбери направление" /></SelectTrigger><SelectContent>{classTypes.map((type) => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2"><Label>Тренер</Label><Select value={form.coachId} onValueChange={(coachId) => setForm((current) => ({ ...current, coachId }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Без тренера</SelectItem>{coaches.map((coach) => <SelectItem key={coach.id} value={coach.id}>{coach.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-2"><Label>Зал</Label><Select value={form.room} onValueChange={(room) => setForm((current) => ({ ...current, room }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STUDIO_ROOMS.map((room) => <SelectItem key={room} value={room}>{room}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2"><Label>Дата</Label><Input type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} /></div>
            <div className="grid gap-2"><Label>Начало</Label><Input type="time" step="600" value={form.startTime} onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))} /></div>
            <div className="grid gap-2"><Label>Окончание</Label><Input type="time" step="600" value={form.endTime} onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value }))} /></div>
          </div>
          <div className="grid gap-2"><Label>Количество мест</Label><Input type="number" min="1" max="100" value={form.capacity} onChange={(event) => setForm((current) => ({ ...current, capacity: event.target.value }))} /></div>
          <div className="grid gap-2 rounded-xl border bg-muted/20 p-3">
            <Label>Состояние занятия</Label>
            <Select value={form.bookingStatus} onValueChange={(bookingStatus: SessionBookingStatus) => setForm((current) => ({ ...current, bookingStatus }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">Запись открыта</SelectItem><SelectItem value="closed">Закрыть новые записи</SelectItem><SelectItem value="cancelled">Занятие отменено</SelectItem></SelectContent></Select>
            {form.bookingStatus !== "open" ? <><Label>Причина *</Label><Textarea value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Например: замена тренера не найдена" /></> : null}
            <label className="mt-1 flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-3">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={!form.clientVisible} onChange={(event) => setForm((current) => ({ ...current, clientVisible: !event.target.checked }))} />
              <span><span className="block text-sm font-medium">Не отображать клиентам</span><span className="mt-0.5 block text-xs text-muted-foreground">Занятие останется в админском расписании, но полностью исчезнет из клиентского кабинета.</span></span>
            </label>
          </div>
          {form.bookingStatus === "cancelled" ? <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>Занятие останется в расписании, но новые записи будут запрещены. Клиентские записи не удаляются.</AlertDescription></Alert> : null}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button><Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Сохранить</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
