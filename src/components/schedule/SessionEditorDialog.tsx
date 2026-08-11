import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { AlertTriangle, Loader2, UserRoundPlus } from "lucide-react";
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
import { Link } from "react-router-dom";

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
  renterId: "",
  serviceId: "",
  agreedPrice: "",
  paidAmount: "0",
  paymentMethod: "kaspi",
  paymentDate: format(date, "yyyy-MM-dd"),
  rentalNotes: "",
});

export function SessionEditorDialog({ open, onOpenChange, session, initialDate, classTypes, coaches }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => emptyForm(initialDate));
  const paymentAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const selectedClassType = classTypes.find((item) => item.id === form.classTypeId);
  const isRental = session?.session_kind === "rental" || /аренд/i.test(selectedClassType?.name || "");
  const { data: services = [] } = useQuery({ queryKey: ["service_catalog", "active"], enabled: open && isRental, queryFn: async () => { const { data, error } = await supabase.from("service_catalog").select("id,name,room,duration_minutes,list_price").eq("category", "rental").eq("is_active", true).order("room"); if (error) throw error; return data || []; } });
  const { data: renters = [] } = useQuery({ queryKey: ["rental_renters"], enabled: open && isRental, queryFn: async () => { const { data, error } = await supabase.from("profiles").select("id,first_name,last_name,phone").eq("role", "client").eq("is_active", true).order("first_name"); if (error) throw error; return data || []; } });

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
      renterId: session.rental_booking?.renter_id || "",
      serviceId: session.rental_booking?.service_id || "",
      agreedPrice: session.rental_booking ? String(session.rental_booking.agreed_price) : "",
      paidAmount: "0",
      paymentMethod: "kaspi",
      paymentDate: format(new Date(), "yyyy-MM-dd"),
      rentalNotes: session.rental_booking?.notes || "",
    });
  }, [initialDate, open, session]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.classTypeId) throw new Error("Выбери направление");
      const start = new Date(`${form.date}T${form.startTime}:00`);
      const end = new Date(`${form.date}T${form.endTime}:00`);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error("Время окончания должно быть позже начала");
      const capacity = isRental ? 1 : Number.parseInt(form.capacity, 10);
      if (!Number.isFinite(capacity) || capacity < 1) throw new Error("Укажи вместимость");
      if (isRental && !form.renterId) throw new Error("Выбери арендатора");
      if (isRental && !form.serviceId) throw new Error("Выбери услугу аренды");
      if (isRental && (!Number.isFinite(Number(form.agreedPrice)) || Number(form.agreedPrice) < 0)) throw new Error("Укажи стоимость аренды");
      if (isRental && Number(form.paidAmount) > 0 && !form.paymentMethod) throw new Error("Выбери способ оплаты");
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
      const coachConflict = activeOverlaps.find((item) => !isRental && form.coachId !== "none" && item.coach_id === form.coachId);
      if (coachConflict) {
        throw new Error(`У тренера уже есть занятие: ${format(parseISO(coachConflict.start_time), "HH:mm")}–${format(parseISO(coachConflict.end_time), "HH:mm")}`);
      }

      const resolvedRoom = isRental
        ? (activeOverlaps.some((item) => normalizeRoom(item.room) === normalizeRoom(form.room)) ? null : normalizeRoom(form.room))
        : resolveAvailableRoom(form.room, activeOverlaps.map((item) => item.room));
      if (!resolvedRoom) throw new Error(form.room === "Большой зал" ? "Оба зала уже заняты в это время" : "Малый зал уже занят в это время");

      const { data: { user } } = await supabase.auth.getUser();
      const payload = {
        class_type_id: form.classTypeId,
        coach_id: isRental ? null : (form.coachId === "none" ? null : form.coachId),
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
        session_kind: isRental ? "rental" : "fitness",
      };

      if (isRental) {
        const paidAt = Number(form.paidAmount) > 0 ? new Date(`${form.paymentDate}T12:00:00`) : null;
        const paymentFingerprint = JSON.stringify({
          rentalId: session?.rental_booking?.id || "new",
          sessionId: session?.id || null,
          classTypeId: form.classTypeId,
          serviceId: form.serviceId,
          renterId: form.renterId,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          room: resolvedRoom,
          agreedPrice: Number(form.agreedPrice),
          clientVisible: form.clientVisible,
          notes: form.rentalNotes.trim() || null,
          paidAmount: Number(form.paidAmount),
          paymentMethod: Number(form.paidAmount) > 0 ? form.paymentMethod : null,
          paymentDate: Number(form.paidAmount) > 0 ? form.paymentDate : null,
          rentalStatus: form.bookingStatus === "cancelled" ? "cancelled" : "confirmed",
          statusReason: form.reason.trim() || null,
        });
        if (!paymentAttemptRef.current || paymentAttemptRef.current.fingerprint !== paymentFingerprint) {
          paymentAttemptRef.current = { fingerprint: paymentFingerprint, key: crypto.randomUUID() };
        }
        const { error: rentalError } = await supabase.rpc("upsert_rental_booking", {
          p_rental_id: session?.rental_booking?.id || null,
          p_session_id: session?.id || null,
          p_class_type_id: form.classTypeId,
          p_service_id: form.serviceId,
          p_renter_id: form.renterId,
          p_start_at: start.toISOString(),
          p_end_at: end.toISOString(),
          p_room: resolvedRoom,
          p_agreed_price: Number(form.agreedPrice),
          p_client_visible: form.clientVisible,
          p_notes: form.rentalNotes.trim() || null,
          p_initial_payment: Number(form.paidAmount),
          p_payment_method: Number(form.paidAmount) > 0 ? form.paymentMethod : null,
          p_paid_at: paidAt?.toISOString() || null,
          p_payment_note: form.rentalNotes.trim() || null,
          p_idempotency_key: paymentAttemptRef.current.key,
          p_rental_status: form.bookingStatus === "cancelled" ? "cancelled" : "confirmed",
          p_status_reason: form.reason.trim() || null,
        });
        if (rentalError) throw rentalError;
      } else {
        const result = session
          ? await supabase.from("schedule_sessions").update(payload).eq("id", session.id).select("id").single()
          : await supabase.from("schedule_sessions").insert(payload).select("id").single();
        if (result.error) throw result.error;
      }
      return { autoAssignedSmallRoom: !isRental && form.room === "Большой зал" && resolvedRoom === "Малый зал" };
    },
    onSuccess: async (result) => {
      paymentAttemptRef.current = null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["schedule_sessions"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard_upcoming_classes"] }),
        queryClient.invalidateQueries({ queryKey: ["attendance_report"] }),
        queryClient.invalidateQueries({ queryKey: ["cash_transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["client_rentals"] }),
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
    const rentalType = /аренд/i.test(type?.name || "");
    if (!type?.duration_min) return setForm((current) => ({ ...current, classTypeId, clientVisible: rentalType ? false : current.clientVisible, coachId: rentalType ? "none" : current.coachId }));
    const start = new Date(`${form.date}T${form.startTime}:00`);
    const end = new Date(start.getTime() + type.duration_min * 60_000);
    setForm((current) => ({ ...current, classTypeId, endTime: format(end, "HH:mm"), clientVisible: rentalType ? false : current.clientVisible, coachId: rentalType ? "none" : current.coachId }));
  };

  const selectService = (serviceId: string) => {
    const service = services.find((item: any) => item.id === serviceId);
    if (!service) return;
    const start = new Date(`${form.date}T${form.startTime}:00`);
    const end = new Date(start.getTime() + Number(service.duration_minutes) * 60_000);
    setForm(current => ({ ...current, serviceId, room: service.room, endTime: format(end, "HH:mm"), agreedPrice: String(service.list_price) }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>{session ? "Настройки занятия" : "Новое занятие"}</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2"><Label>Направление</Label><Select value={form.classTypeId} onValueChange={selectClassType}><SelectTrigger><SelectValue placeholder="Выбери направление" /></SelectTrigger><SelectContent>{classTypes.map((type) => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}</SelectContent></Select></div>
          {isRental ? <div className="grid gap-4 rounded-xl border bg-muted/20 p-4"><div className="flex items-center justify-between"><div><h3 className="font-semibold">Арендатор и услуга</h3><p className="text-xs text-muted-foreground">Арендатор хранится в общей карточке клиента</p></div><Button variant="outline" size="sm" asChild><Link to="/admin/new-client" target="_blank"><UserRoundPlus className="mr-2 h-4 w-4" />Создать нового</Link></Button></div><div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label>Арендатор *</Label><Select value={form.renterId} onValueChange={renterId => setForm(v => ({ ...v, renterId }))}><SelectTrigger><SelectValue placeholder="Выбери клиента" /></SelectTrigger><SelectContent>{renters.map((renter: any) => <SelectItem key={renter.id} value={renter.id}>{`${renter.first_name || ""} ${renter.last_name || ""}`.trim()} · {renter.phone}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label>Услуга *</Label><Select value={form.serviceId} onValueChange={selectService}><SelectTrigger><SelectValue placeholder="Выбери услугу" /></SelectTrigger><SelectContent>{services.map((service: any) => <SelectItem key={service.id} value={service.id}>{service.name} · {Number(service.list_price).toLocaleString("ru-RU")} ₸</SelectItem>)}</SelectContent></Select></div></div></div> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {!isRental ? <div className="grid gap-2"><Label>Тренер</Label><Select value={form.coachId} onValueChange={(coachId) => setForm((current) => ({ ...current, coachId }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Без тренера</SelectItem>{coaches.map((coach) => <SelectItem key={coach.id} value={coach.id}>{coach.name}</SelectItem>)}</SelectContent></Select></div> : null}
            <div className="grid gap-2"><Label>Зал</Label><Select value={form.room} onValueChange={(room) => setForm((current) => ({ ...current, room }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STUDIO_ROOMS.map((room) => <SelectItem key={room} value={room}>{room}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2"><Label>Дата</Label><Input type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} /></div>
            <div className="grid gap-2"><Label>Начало</Label><Input type="time" step="600" value={form.startTime} onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))} /></div>
            <div className="grid gap-2"><Label>Окончание</Label><Input type="time" step="600" value={form.endTime} onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value }))} /></div>
          </div>
          {!isRental ? <div className="grid gap-2"><Label>Количество мест</Label><Input type="number" min="1" max="100" value={form.capacity} onChange={(event) => setForm((current) => ({ ...current, capacity: event.target.value }))} /></div> : <div className="grid gap-4 rounded-xl border p-4"><h3 className="font-semibold">Оплата</h3><div className="grid gap-4 sm:grid-cols-3"><div className="grid gap-2"><Label>Стоимость, ₸</Label><Input type="number" min="0" value={form.agreedPrice} onChange={e => setForm(v => ({ ...v, agreedPrice: e.target.value }))} /></div><div className="grid gap-2"><Label>Внесено сейчас, ₸</Label><Input type="number" min="0" value={form.paidAmount} onChange={e => setForm(v => ({ ...v, paidAmount: e.target.value }))} /></div><div className="grid gap-2"><Label>Долг после оплаты</Label><Input readOnly value={`${Math.max(Number(form.agreedPrice || 0) - Number(form.paidAmount || 0), 0).toLocaleString("ru-RU")} ₸`} /></div></div>{Number(form.paidAmount) > 0 ? <div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label>Способ оплаты</Label><Select value={form.paymentMethod} onValueChange={paymentMethod => setForm(v => ({ ...v, paymentMethod }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="kaspi">Безналичный Kaspi</SelectItem><SelectItem value="halyk">Безналичный Halyk</SelectItem><SelectItem value="cash">Наличные</SelectItem><SelectItem value="bank_account">Расчётный счёт</SelectItem></SelectContent></Select></div><div className="grid gap-2"><Label>Дата оплаты</Label><Input type="date" value={form.paymentDate} onChange={e => setForm(v => ({ ...v, paymentDate: e.target.value }))} /></div></div> : null}<div className="grid gap-2"><Label>Комментарий</Label><Textarea value={form.rentalNotes} onChange={e => setForm(v => ({ ...v, rentalNotes: e.target.value }))} /></div></div>}
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
