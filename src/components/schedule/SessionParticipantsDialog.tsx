import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { AlertCircle, Loader2, MessageCircle, Plus, Search, Settings2, UserPlus } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { fetchClientStatuses, getClientStatusForBooking, type ClientStatus } from "@/lib/client-status";
import {
  normalizePhone,
  normalizeRoom,
  occupiesPlace,
  type ScheduleClient,
  type ScheduleSession,
} from "@/lib/schedule";
import { ClientStatusIndicators, ClientStatusLegend } from "@/components/clients/ClientStatusIndicators";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const attendanceStatus = {
  booked: { label: "Записан", className: "border-blue-200 bg-blue-50 text-blue-700" },
  completed: { label: "Пришёл", className: "border-green-200 bg-green-50 text-green-700" },
  absent: { label: "Не пришёл", className: "border-orange-200 bg-orange-50 text-orange-700" },
  cancelled: { label: "Отмена", className: "border-red-200 bg-red-50 text-red-700" },
  late_cancel: { label: "Поздняя отмена", className: "border-red-300 bg-red-100 text-red-800" },
} as const;

type ClientOption = ScheduleClient & { clientStatus?: ClientStatus };

type Props = {
  session: ScheduleSession | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (session: ScheduleSession) => void;
};

export function SessionParticipantsDialog({ session, open, onOpenChange, onEdit }: Props) {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [clientForm, setClientForm] = useState({ firstName: "", lastName: "", phone: "", email: "" });
  const clientFormDirty = showCreate && Object.values(clientForm).some((value) => value.trim().length > 0);

  useEffect(() => {
    if (!open) {
      setShowAdd(false);
      setShowCreate(false);
      setSearch("");
      setSelectedClientId(null);
      setClientForm({ firstName: "", lastName: "", phone: "", email: "" });
    }
  }, [open]);

  const { data: details, isLoading } = useQuery({
    queryKey: ["schedule_session_details", session?.id],
    enabled: open && Boolean(session?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_sessions")
        .select(`
          id, class_type_id, coach_id, start_time, end_time, capacity, room,
          booking_status, booking_closed_reason, is_cancelled,
          class_type:class_types(id,name,color,duration_min),
          coach:coaches(id,name),
          bookings:bookings(id,status,user_id,created_at,user:profiles(id,first_name,last_name,phone,email))
        `)
        .eq("id", session!.id)
        .single();
      if (error) throw error;
      const result = data as unknown as ScheduleSession;
      const ids = (result.bookings || []).map((booking) => booking.user_id).filter(Boolean);
      const statuses = await fetchClientStatuses(ids);
      return {
        ...result,
        bookings: (result.bookings || []).map((booking) => ({
          ...booking,
          clientStatus: getClientStatusForBooking(statuses.get(booking.user_id), booking.id),
        })),
      } as ScheduleSession & { bookings: Array<ScheduleSession["bookings"][number] & { clientStatus?: ClientStatus }> };
    },
  });

  const requestScheduleApi = async (payload: Record<string, unknown>) => {
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const response = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authSession?.access_token || ""}` },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Ошибка сервера");
    return result;
  };

  const { data: clientOptions = [], isLoading: clientsLoading } = useQuery<ClientOption[]>({
    queryKey: ["schedule_client_search", search.trim()],
    enabled: open && showAdd,
    queryFn: async () => {
      const result = await requestScheduleApi({ action: "search-clients", query: search.trim() });
      const clients = (result.clients || []) as ScheduleClient[];
      const statuses = await fetchClientStatuses(clients.map((client) => client.id));
      return clients.map((client) => ({ ...client, clientStatus: statuses.get(client.id) }));
    },
  });

  const visibleClients = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru-RU");
    if (!query) return clientOptions.slice(0, 12);
    const digits = normalizePhone(query);
    return clientOptions.filter((client) => {
      const name = `${client.first_name || ""} ${client.last_name || ""}`.toLocaleLowerCase("ru-RU");
      return name.includes(query) || (digits.length >= 3 && normalizePhone(client.phone || "").includes(digits));
    }).slice(0, 20);
  }, [clientOptions, search]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["schedule_session_details", session?.id] }),
      queryClient.invalidateQueries({ queryKey: ["schedule_sessions"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard_upcoming_classes"] }),
      queryClient.invalidateQueries({ queryKey: ["attendance_report"] }),
    ]);
  };

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("bookings").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => { await refresh(); toast.success("Статус посещения сохранён"); },
    onError: (error: Error) => toast.error(error.message),
  });

  const ensureCanBook = () => {
    if (!details) throw new Error("Занятие не загружено");
    if (details.booking_status !== "open") throw new Error(details.booking_status === "cancelled" ? "Занятие отменено" : "Сначала открой запись на занятие");
    const occupied = details.bookings.filter((booking) => occupiesPlace(booking.status)).length;
    if (occupied >= details.capacity) throw new Error("Свободных мест нет");
  };

  const bookExisting = useMutation({
    mutationFn: async (userId: string) => {
      ensureCanBook();
      const existing = details?.bookings.find((booking) => booking.user_id === userId);
      if (existing && occupiesPlace(existing.status)) throw new Error("Клиент уже записан на это занятие");
      if (existing) {
        const { error } = await supabase.from("bookings").update({ status: "booked" }).eq("id", existing.id);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from("bookings").insert({ session_id: details!.id, user_id: userId, status: "booked" });
      if (error) throw error;
    },
    onSuccess: async () => {
      await refresh();
      setSelectedClientId(null);
      setSearch("");
      setShowAdd(false);
      toast.success("Клиент записан");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const createAndBook = useMutation({
    mutationFn: async () => {
      ensureCanBook();
      const phone = normalizePhone(clientForm.phone);
      if (!clientForm.firstName.trim() || phone.length < 10) throw new Error("Укажи имя и корректный телефон");
      return requestScheduleApi({
        action: "create-client-and-book",
        sessionId: details!.id,
        firstName: clientForm.firstName.trim(),
        lastName: clientForm.lastName.trim(),
        phone,
        email: clientForm.email.trim(),
      });
    },
    onSuccess: async ({ login, temporaryPassword }) => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["schedule_client_search"] })]);
      setShowCreate(false);
      setShowAdd(false);
      setClientForm({ firstName: "", lastName: "", phone: "", email: "" });
      toast.success("Клиент создан и записан", { description: `Логин: ${login} · временный пароль: ${temporaryPassword}` });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!session) return null;
  const current = details || session;
  const occupied = (details?.bookings || session.bookings || []).filter((booking) => occupiesPlace(booking.status)).length;
  const selectedClient = clientOptions.find((client) => client.id === selectedClientId);

  const openWhatsApp = (client: ScheduleClient | null) => {
    if (!client?.phone) return toast.error("У клиента не указан телефон");
    const message = `Здравствуйте, ${client.first_name || ""}! Напоминаем о занятии «${current.class_type?.name || "занятие"}» ${format(parseISO(current.start_time), "dd.MM")} в ${format(parseISO(current.start_time), "HH:mm")}.`;
    window.open(`https://wa.me/${normalizePhone(client.phone)}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && clientFormDirty && !window.confirm("Закрыть окно без сохранения нового клиента? Введённые данные будут потеряны.")) return;
      onOpenChange(nextOpen);
    }}>
      <DialogContent className="flex max-h-[88vh] w-[calc(100vw-24px)] max-w-[780px] flex-col gap-0 overflow-hidden p-0 shadow-2xl">
        <DialogHeader className="border-b bg-white px-5 py-4 pr-12">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle className="text-lg">{current.class_type?.name || "Занятие"}</DialogTitle>
              <DialogDescription className="mt-1">
                {format(parseISO(current.start_time), "dd.MM.yyyy HH:mm")}–{format(parseISO(current.end_time), "HH:mm")}
                {` · ${normalizeRoom(current.room)}`}
                {current.coach?.name ? ` · ${current.coach.name}` : ""}
              </DialogDescription>
            </div>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-bold tabular-nums text-primary">{occupied}/{current.capacity}</span>
          </div>
          {current.booking_status !== "open" ? (
            <Alert className="mt-3 py-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{current.booking_status === "cancelled" ? "Занятие отменено" : "Запись закрыта"}{current.booking_closed_reason ? `: ${current.booking_closed_reason}` : ""}</AlertDescription>
            </Alert>
          ) : null}
          <details className="mt-3 text-xs text-muted-foreground">
            <summary className="w-fit cursor-pointer font-medium hover:text-foreground">Обозначения</summary>
            <ClientStatusLegend className="mt-2" />
          </details>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-5 py-3">
            <Button size="sm" onClick={() => { setShowAdd((value) => !value); setShowCreate(false); }} disabled={current.booking_status !== "open" || occupied >= current.capacity}>
              <Plus className="mr-1.5 h-4 w-4" /> Добавить клиента
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setShowCreate(true); setShowAdd(true); }} disabled={current.booking_status !== "open" || occupied >= current.capacity}>
              <UserPlus className="mr-1.5 h-4 w-4" /> Создать нового
            </Button>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { onOpenChange(false); onEdit(current); }}>
              <Settings2 className="mr-1.5 h-4 w-4" /> Настройки занятия
            </Button>
          </div>

          {showAdd ? (
            <div className="border-b bg-white px-5 py-4">
              {showCreate ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5"><Label>Имя *</Label><Input value={clientForm.firstName} onChange={(event) => setClientForm((form) => ({ ...form, firstName: event.target.value }))} /></div>
                  <div className="grid gap-1.5"><Label>Фамилия</Label><Input value={clientForm.lastName} onChange={(event) => setClientForm((form) => ({ ...form, lastName: event.target.value }))} /></div>
                  <div className="grid gap-1.5"><Label>Телефон *</Label><Input placeholder="+7 700 000-00-00" value={clientForm.phone} onChange={(event) => setClientForm((form) => ({ ...form, phone: event.target.value }))} /></div>
                  <div className="grid gap-1.5"><Label>Email (необязательно)</Label><Input type="email" value={clientForm.email} onChange={(event) => setClientForm((form) => ({ ...form, email: event.target.value }))} /></div>
                  <Alert className="sm:col-span-2"><AlertCircle className="h-4 w-4" /><AlertDescription>Клиент будет создан без абонемента и сразу записан. В списке появятся звезда и красная точка.</AlertDescription></Alert>
                  <div className="flex gap-2 sm:col-span-2"><Button onClick={() => createAndBook.mutate()} disabled={createAndBook.isPending}>{createAndBook.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Создать и записать</Button><Button variant="ghost" onClick={() => setShowCreate(false)}>Назад к поиску</Button></div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Имя или телефон" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
                  <div className="max-h-56 divide-y overflow-y-auto rounded-lg border">
                    {clientsLoading ? <div className="flex justify-center p-5"><Loader2 className="h-5 w-5 animate-spin" /></div> : visibleClients.length === 0 ? <div className="p-5 text-center text-sm text-muted-foreground">Клиент не найден — создай нового</div> : visibleClients.map((client) => (
                      <button key={client.id} type="button" onClick={() => setSelectedClientId(client.id)} className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 ${selectedClientId === client.id ? "bg-primary/5 ring-1 ring-inset ring-primary/30" : ""}`}>
                        <ClientStatusIndicators status={client.clientStatus} reserveSpace />
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{client.first_name} {client.last_name || ""}</span><span className="block text-xs text-muted-foreground">{client.phone || "Телефон не указан"}</span></span>
                        <span className="text-xs text-muted-foreground">{client.clientStatus?.membership === "inactive" ? "Без оплаты" : "Абонемент есть"}</span>
                      </button>
                    ))}
                  </div>
                  {selectedClient ? <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 p-3"><div className="text-sm"><span className="font-medium">{selectedClient.first_name} {selectedClient.last_name || ""}</span>{selectedClient.clientStatus?.membership === "inactive" ? <p className="text-xs text-red-600">Нет действующего абонемента. Запись будет отмечена красным.</p> : null}</div><Button onClick={() => bookExisting.mutate(selectedClient.id)} disabled={bookExisting.isPending}>{selectedClient.clientStatus?.membership === "inactive" ? "Записать без оплаты" : "Записать"}</Button></div> : null}
                </div>
              )}
            </div>
          ) : null}

          <ScrollArea className="min-h-0 flex-1">
            {isLoading ? (
              <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : !details?.bookings.length ? (
              <div className="p-12 text-center text-sm text-muted-foreground">На занятие пока никто не записан</div>
            ) : (
              <div className="divide-y">
                {details.bookings.map((booking) => {
                  const client = booking.user;
                  const status = attendanceStatus[booking.status as keyof typeof attendanceStatus] || attendanceStatus.booked;
                  return (
                    <div key={booking.id} className="flex min-h-16 flex-wrap items-center gap-3 px-5 py-2.5 sm:flex-nowrap">
                      <ClientStatusIndicators status={booking.clientStatus} reserveSpace />
                      <div className="min-w-0 flex-1">
                        {client ? <Link to={`/clients/${client.id}`} className="truncate text-sm font-semibold hover:text-primary hover:underline">{client.first_name} {client.last_name || ""}</Link> : <span className="text-sm font-semibold">Неизвестный клиент</span>}
                        <p className="truncate text-xs text-muted-foreground">{client?.phone || "Телефон не указан"}</p>
                      </div>
                      <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0 text-green-600" aria-label="Написать в WhatsApp" title="Написать в WhatsApp" onClick={() => openWhatsApp(client)} disabled={!client?.phone}><MessageCircle className="h-4 w-4" /></Button>
                      <Select value={booking.status} disabled={updateStatus.isPending} onValueChange={(value) => updateStatus.mutate({ id: booking.id, status: value })}>
                        <SelectTrigger className={`h-9 w-[150px] shrink-0 text-xs font-semibold ${status.className}`}><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="booked">Записан</SelectItem><SelectItem value="completed">Пришёл</SelectItem><SelectItem value="absent">Не пришёл</SelectItem><SelectItem value="cancelled">Отмена</SelectItem><SelectItem value="late_cancel">Поздняя отмена</SelectItem></SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
