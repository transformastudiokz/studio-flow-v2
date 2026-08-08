import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { updateBookingStatus } from "@/lib/booking-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Download, X, Plus, Search, Check, MessageCircle, Megaphone, Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { format, startOfMonth, endOfMonth, parseISO, differenceInMinutes } from "date-fns";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "react-router-dom";
import { fetchClientStatuses, getClientStatusForBooking } from "@/lib/client-status";
import { ClientStatusIndicators, ClientStatusLegend } from "@/components/clients/ClientStatusIndicators";

const getCoachName = (coach: any) => {
  if (!coach) return 'Без тренера';
  if (coach.name) return coach.name;
  if (coach.first_name) return `${coach.first_name} ${coach.last_name || ''}`;
  return 'Тренер';
};

const Attendance = () => {
  const queryClient = useQueryClient();

  const [dateFrom, setDateFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  
  const [filterInstructor, setFilterInstructor] = useState("all");
  const [filterClassType, setFilterClassType] = useState("all");

  const [pendingBookingId, setPendingBookingId] = useState<string | null>(null);
  const [isBookDialogOpen, setIsBookDialogOpen] = useState(false);
  const [bookDate, setBookDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [bookForm, setBookForm] = useState({ session_id: "", client_id: "" });
  const [clientSearch, setClientSearch] = useState("");

  // --- НОВЫЕ СОСТОЯНИЯ ДЛЯ ГРУППОВОГО ОПОВЕЩЕНИЯ ---
  const [isNotifyDialogOpen, setIsNotifyDialogOpen] = useState(false);
  const [notifySession, setNotifySession] = useState<any>(null);
  const [notifyType, setNotifyType] = useState<'cancel' | 'reschedule' | 'custom'>('cancel');
  const [notifyNote, setNotifyNote] = useState("");

  // --- ЗАГРУЗКА ДАННЫХ ---
  const { data: cancellationMinutes = 0 } = useQuery({
    queryKey: ['studio_info', 'cancellation_minutes'],
    queryFn: async () => {
      const { data } = await supabase.from('studio_info').select('value').eq('key', 'cancellation_minutes').single();
      return data?.value ? parseInt(data.value) : 0;
    }
  });

  const { data: coaches = [] } = useQuery({
    queryKey: ['coaches_list'],
    queryFn: async () => {
      const { data } = await supabase.from('coaches').select('id, name');
      return data || [];
    }
  });

  const { data: classTypes = [] } = useQuery({
    queryKey: ['class_types_list'],
    queryFn: async () => {
      const { data } = await supabase.from('class_types').select('*');
      return data || [];
    }
  });

  const { data: reportData = [], isLoading } = useQuery({
    queryKey: ['attendance_report', dateFrom, dateTo, filterInstructor, filterClassType],
    queryFn: async () => {
      let query = supabase
        .from('schedule_sessions')
        .select(`
            id, start_time, end_time, room,
            class_type:class_types(id, name),
            coach:coaches(id, name),
            bookings:bookings(
                id, status, user_id,
                user:profiles(id, first_name, last_name, phone)
            )
        `)
        .gte('start_time', `${dateFrom}T00:00:00`)
        .lte('start_time', `${dateTo}T23:59:59`)
        .order('start_time', { ascending: true });

      const { data, error } = await query;
      if (error) throw error;

      let filteredData = data;
      if (filterInstructor !== 'all') {
        filteredData = filteredData.filter((s: any) => s.coach?.id === filterInstructor);
      }
      if (filterClassType !== 'all') {
        filteredData = filteredData.filter((s: any) => s.class_type?.id === filterClassType);
      }

      const userIds = filteredData.flatMap((session: any) =>
        (session.bookings || []).map((booking: any) => booking.user?.id).filter(Boolean),
      );
      const clientStatuses = await fetchClientStatuses(userIds);

      return filteredData.map((session: any) => ({
        ...session,
        bookings: (session.bookings || []).map((booking: any) => ({
          ...booking,
          clientStatus: getClientStatusForBooking(
            clientStatuses.get(booking.user?.id),
            booking.id,
          ),
        })),
      }));
    }
  });

  const { data: sessionsForBooking = [] } = useQuery({
    queryKey: ['sessions_for_manual_booking', bookDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedule_sessions')
        .select(`id, start_time, class_type:class_types(name), coach:coaches(name)`)
        .gte('start_time', `${bookDate}T00:00:00`)
        .lte('start_time', `${bookDate}T23:59:59`)
        .order('start_time');
      if (error) throw error;
      return data;
    },
    enabled: isBookDialogOpen
  });

  const { data: activeClients = [] } = useQuery({
    queryKey: ['active_clients_for_booking'],
    queryFn: async () => {
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select(`id, first_name, last_name, phone`)
        .eq('role', 'client')
        .order('first_name');
      
      if (error) throw error;

      const todayStr = new Date().toISOString().split('T')[0];
      const { data: subs } = await supabase
        .from('user_subscriptions')
        .select(`id, user_id, visits_remaining, end_date, plan:subscription_plans(name), is_active`)
        .eq('is_active', true)
        .gt('visits_remaining', 0)
        .or('end_date.is.null,end_date.gte.' + todayStr);

      return profiles.map((p: any) => ({
        ...p,
        subscriptions: subs?.filter((s: any) => s.user_id === p.id) || []
      })).filter((p: any) => p.subscriptions.length > 0);
    },
    enabled: isBookDialogOpen
  });

  // --- МУТАЦИИ ---
  const manualBookMutation = useMutation({
    mutationFn: async () => {
      if (!bookForm.session_id || !bookForm.client_id) throw new Error("Выберите занятие и клиента");
      const client = activeClients.find((c: any) => c.id === bookForm.client_id);
      if (!client || !client.subscriptions.length) throw new Error("У клиента нет активного абонемента");
      const targetSub = client.subscriptions.sort((a: any, b: any) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime())[0];
      const { data: existing } = await supabase.from('bookings')
        .select('id').eq('session_id', bookForm.session_id).eq('user_id', bookForm.client_id).maybeSingle();
      if (existing) throw new Error("Клиент уже записан на это занятие");
      const { error: bookError } = await supabase.from('bookings').insert({
        session_id: bookForm.session_id,
        user_id: bookForm.client_id,
        subscription_id: targetSub.id, 
        status: 'booked'
      });
      if (bookError) throw bookError;
    },
    onSuccess: () => {
      toast.success("Клиент записан");
      setIsBookDialogOpen(false);
      setBookForm({ session_id: "", client_id: "" });
      setClientSearch("");
      queryClient.invalidateQueries({ queryKey: ['attendance_report'] });
    },
    onError: (err: any) => toast.error(err.message)
  });

  const deleteBookingMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      await updateBookingStatus(bookingId, 'cancelled');
    },
    onSuccess: () => {
      toast.success("Запись удалена");
      queryClient.invalidateQueries({ queryKey: ['attendance_report'] });
    },
    onError: (err: any) => toast.error("Ошибка: " + err.message),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status, sessionTime }: { id: string, status: string, sessionDate: string, sessionTime: string }) => {
        if (status === 'cancelled') {
            const limitMinutes = cancellationMinutes;
            const sessionDateTime = parseISO(sessionTime); 
            const now = new Date();
            const diff = differenceInMinutes(sessionDateTime, now);
            if (diff < limitMinutes && diff > 0) { 
                const confirmCancel = window.confirm(
                    `ВНИМАНИЕ! До урока осталось ${diff} мин (меньше нормы ${limitMinutes} мин).\n\n` +
                    `Все равно отменить и ВЕРНУТЬ занятие в абонемент?`
                );
                if (!confirmCancel) throw new Error("Отмена прервана администратором");
            }
        }
        await updateBookingStatus(id, status);
    },
    onSuccess: () => {
        toast.success("Статус изменен");
        setPendingBookingId(null);
        queryClient.invalidateQueries({ queryKey: ['attendance_report'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard_upcoming_classes'] });
    },
    onError: (err: any) => {
        setPendingBookingId(null);
        if (err.message !== "Отмена прервана администратором") {
            toast.error("Ошибка: " + err.message);
        }
    }
  });

  // --- ЛОГИКА WHATSAPP (ОБНОВЛЕННЫЕ ИКОНКИ) ---
  
  const handleGroupNotify = (session: any) => {
      setNotifySession(session);
      setNotifyType('cancel');
      setNotifyNote("");
      setIsNotifyDialogOpen(true);
  };

  const sendWhatsApp = (client: any, type: 'cancel' | 'remind' | 'reschedule' | 'custom', session: any, customNote?: string) => {
    if (!client?.phone) {
        toast.error("У клиента нет телефона");
        return;
    }
    
    const phone = client.phone.replace(/\D/g, '');
    const dateStr = format(parseISO(session.start_time), 'dd.MM');
    const timeStr = format(parseISO(session.start_time), 'HH:mm');
    const className = session.class_type?.name || 'Занятие';

    let text = "";
    
    // ИСПОЛЬЗУЕМ СТАНДАРТНЫЕ СИМВОЛЫ ВМЕСТО СЛОЖНЫХ ЭМОДЗИ
    if (type === 'cancel') {
        text = `Здравствуйте, ${client.first_name}! ❌\nЗанятие "${className}" ${dateStr} в ${timeStr} ОТМЕНЕНО.\nПриносим извинения!`;
    } 
    else if (type === 'reschedule') {
        text = `Здравствуйте, ${client.first_name}! 🗓️\nВнимание: Время занятия "${className}" (${dateStr}) ИЗМЕНЕНО.\nНовое время/инфо: ${customNote || "Просим уточнить у администратора"}.\nПожалуйста, подтвердите получение.`;
    }
    else if (type === 'remind') {
        text = `Здравствуйте, ${client.first_name}! 🔔\nНапоминаем, что у вас запись на "${className}" ${dateStr} в ${timeStr}.\nЖдем вас!`;
    }
    else if (type === 'custom') {
        text = `Здравствуйте, ${client.first_name}! 📝\nКасательно занятия "${className}":\n${customNote}`;
    }

    const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const exportToExcel = () => {
    const headers = ["Дата", "Время", "Занятие", "Инструктор", "Клиент", "Телефон", "Статус"];
    const rows: string[][] = [];
    reportData.forEach((session: any) => {
        const date = format(parseISO(session.start_time), 'dd.MM.yyyy');
        const time = `${format(parseISO(session.start_time), 'HH:mm')} - ${format(parseISO(session.end_time), 'HH:mm')}`;
        const className = session.class_type?.name || "Без названия";
        const coachName = getCoachName(session.coach);
        if (session.bookings && session.bookings.length > 0) {
            session.bookings.forEach((booking: any) => {
                const client = booking.user;
                rows.push([
                    date, time, className, coachName,
                    client ? `${client.first_name} ${client.last_name || ''}` : "Удален",
                    client?.phone || "-",
                    booking.status === 'completed' ? 'Пришел' :
                                    booking.status === 'absent' ? 'Не пришел' :
                                    booking.status === 'cancelled' ? 'Отмена' :
                                    booking.status === 'late_cancel' ? 'Поздняя отмена' : 'Записан'
                ]);
            });
        } else {
            rows.push([date, time, className, coachName, "Нет записей", "-", "-"]);
        }
    });
    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `attendance_${dateFrom}_${dateTo}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredActiveClients = activeClients.filter((c: any) => {
      const searchLower = clientSearch.toLowerCase();
      const fullName = `${c.first_name} ${c.last_name} ${c.phone}`.toLowerCase();
      return fullName.includes(searchLower);
  });

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex flex-wrap justify-between items-start gap-3">
        <h1 className="text-2xl md:text-3xl font-bold">Посещаемость</h1>
        <div className="flex flex-wrap gap-2">
            {/* --- ДИАЛОГ РУЧНОЙ ЗАПИСИ --- */}
            <Dialog open={isBookDialogOpen} onOpenChange={setIsBookDialogOpen}>
                <DialogTrigger asChild>
                    <Button className="bg-blue-600 hover:bg-blue-700 text-sm"><Plus className="mr-2 h-4 w-4" /> Записать</Button>
                </DialogTrigger>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Ручная запись</DialogTitle>
                        <DialogDescription>Списывает 1 занятие с абонемента.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="space-y-2">
                            <Label>1. Дата</Label>
                            <Input type="date" value={bookDate} onChange={(e) => { setBookDate(e.target.value); setBookForm({ ...bookForm, session_id: "" }); }} />
                        </div>
                        <div className="space-y-2">
                            <Label>2. Урок</Label>
                            <Select value={bookForm.session_id} onValueChange={(val) => setBookForm({...bookForm, session_id: val})} disabled={sessionsForBooking.length === 0}>
                                <SelectTrigger><SelectValue placeholder={sessionsForBooking.length === 0 ? "Нет уроков" : "Выберите урок..."} /></SelectTrigger>
                                <SelectContent>
                                    {sessionsForBooking.map((s: any) => (
                                        <SelectItem key={s.id} value={s.id}>
                                            {format(parseISO(s.start_time), 'HH:mm')} — {s.class_type?.name} ({getCoachName(s.coach)})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>3. Клиент (Поиск)</Label>
                            <div className="border rounded-md p-2 space-y-2">
                                <div className="flex items-center gap-2 border-b pb-2">
                                    <Search className="w-4 h-4 text-gray-400" />
                                    <input className="w-full outline-none text-sm" placeholder="Введите имя или телефон..." value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} />
                                </div>
                                <div className="max-h-[150px] overflow-y-auto space-y-1">
                                    {filteredActiveClients.length === 0 ? (
                                        <div className="text-xs text-gray-400 p-2 text-center">Клиенты не найдены</div>
                                    ) : (
                                        filteredActiveClients.map((c: any) => {
                                            const sub = c.subscriptions[0]; 
                                            const isSelected = bookForm.client_id === c.id;
                                            return (
                                                <div key={c.id} onClick={() => setBookForm({...bookForm, client_id: c.id})} className={`text-sm p-2 rounded cursor-pointer flex justify-between items-center ${isSelected ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'}`}>
                                                    <div>
                                                        <div className="font-medium">{c.first_name} {c.last_name}</div>
                                                        <div className="text-xs text-gray-500">{c.phone}</div>
                                                    </div>
                                                    <div className="text-right">
                                                        <Badge variant="secondary" className="text-[10px] h-5">{sub?.plan?.name}</Badge>
                                                        <div className="text-xs text-green-600 font-bold mt-1">Ост: {sub?.visits_remaining}</div>
                                                    </div>
                                                    {isSelected && <Check className="w-4 h-4 text-blue-600 ml-2" />}
                                                </div>
                                            )
                                        })
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button onClick={() => manualBookMutation.mutate()} disabled={manualBookMutation.isPending || !bookForm.session_id || !bookForm.client_id}>
                            {manualBookMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Записать
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Button variant="outline" onClick={exportToExcel} disabled={reportData.length === 0} className="text-sm">
                <Download className="mr-2 h-4 w-4" /> Excel
            </Button>
        </div>
      </div>

      {/* --- ФИЛЬТРЫ --- */}
      <div className="bg-white p-4 rounded-lg border shadow-sm grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
        <div className="space-y-2"><Label>С даты</Label><Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
        <div className="space-y-2"><Label>По дату</Label><Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
        <div className="space-y-2">
            <Label>Инструктор</Label>
            <Select value={filterInstructor} onValueChange={setFilterInstructor}>
                <SelectTrigger><SelectValue placeholder="Все" /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">Все инструкторы</SelectItem>
                    {coaches.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
            </Select>
        </div>
        <div className="space-y-2">
            <Label>Вид занятия</Label>
            <Select value={filterClassType} onValueChange={setFilterClassType}>
                <SelectTrigger><SelectValue placeholder="Все" /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">Все занятия</SelectItem>
                    {classTypes.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
            </Select>
        </div>
        <Button variant="ghost" onClick={() => { setFilterInstructor("all"); setFilterClassType("all"); setDateFrom(format(new Date(), 'yyyy-MM-dd')); setDateTo(format(new Date(), 'yyyy-MM-dd')); }}>
            <X className="w-4 h-4 mr-2" /> Сбросить (Сегодня)
        </Button>
      </div>

      <ClientStatusLegend className="rounded-lg border bg-white px-4 py-3 shadow-sm" />

      {/* --- ОТОБРАЖЕНИЕ ДАННЫХ (АДАПТИВНОЕ) --- */}
      {isLoading ? <Loader2 className="animate-spin w-8 h-8 mx-auto mt-10" /> : (
        <>
        {/* ================================================================================== */}
        {/* 1. ВЕРСИЯ ДЛЯ КОМПЬЮТЕРА (hidden md:block) */}
        {/* ================================================================================== */}
        <div className="hidden md:block border rounded-lg overflow-hidden bg-white shadow-sm">
            <table className="w-full text-sm text-left">
                <thead className="bg-gray-100 text-gray-700 font-bold border-b">
                    <tr>
                        <th className="p-3">Дата / Время</th>
                        <th className="p-3">Занятие</th>
                        <th className="p-3">Инструктор</th>
                        <th className="p-3 w-[40%]">Клиенты (Управление статусом)</th>
                    </tr>
                </thead>
                <tbody className="divide-y">
                    {reportData.length === 0 ? (
                        <tr><td colSpan={4} className="p-6 text-center text-gray-500">Занятий за этот период не найдено</td></tr>
                    ) : (
                        reportData.map((session: any) => (
                            <tr key={session.id} className="hover:bg-gray-50">
                                <td className="p-3 align-top">
                                    <div className="font-medium">{format(parseISO(session.start_time), 'dd.MM.yyyy')}</div>
                                    <div className="text-gray-500">{format(parseISO(session.start_time), 'HH:mm')} - {format(parseISO(session.end_time), 'HH:mm')}</div>
                                </td>
                                <td className="p-3 align-top">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-blue-800">{session.class_type?.name}</span>
                                        {/* КНОПКА ГРУППОВОГО ОПОВЕЩЕНИЯ */}
                                        <Button 
                                            size="icon" 
                                            variant="ghost" 
                                            className="h-6 w-6 text-orange-500 hover:text-orange-600 hover:bg-orange-50"
                                            title="Оповестить группу (отмена/перенос)"
                                            onClick={() => handleGroupNotify(session)}
                                        >
                                            <Megaphone className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </td>
                                <td className="p-3 align-top">{getCoachName(session.coach)}</td>
                                <td className="p-3 align-top">
                                    <div className="space-y-2">
                                        {session.bookings && session.bookings.length > 0 ? (
                                            session.bookings.map((booking: any) => {
                                                const client = booking.user;
                                                let bgClass = "bg-blue-50 text-blue-700 border-blue-200";
                                                if (booking.status === 'completed') bgClass = "bg-green-50 text-green-700 border-green-200";
                                                if (booking.status === 'absent') bgClass = "bg-orange-50 text-orange-700 border-orange-200";
                                                if (booking.status === 'cancelled') bgClass = "bg-red-50 text-red-700 border-red-200";
                                                if (booking.status === 'late_cancel') bgClass = "bg-red-100 text-red-800 border-red-300";

                                                return (
                                                    <div key={booking.id} className="flex justify-between items-center border-b pb-1 last:border-0 last:pb-0 border-gray-100">
                                                        <div className="flex items-center gap-2">
                                                            {/* Кнопка WhatsApp (Индивидуальная) */}
                                                            {client?.phone && (
                                                                <Button 
                                                                    size="icon" 
                                                                    variant="ghost" 
                                                                    className="h-6 w-6 text-green-600 hover:text-green-700 hover:bg-green-50"
                                                                    title="Написать в WhatsApp"
                                                                    onClick={() => sendWhatsApp(client, (booking.status === 'cancelled' || booking.status === 'late_cancel') ? 'cancel' : 'remind', session)}
                                                                >
                                                                    <MessageCircle className="w-4 h-4" />
                                                                </Button>
                                                            )}

                                                            <ClientStatusIndicators status={booking.clientStatus} reserveSpace />
                                                            <div>
                                                                <div className="flex items-center">
                                                                    {client ? (
                                                                        <Link className="font-medium hover:text-primary hover:underline" to={`/clients/${client.id}`}>
                                                                            {client.first_name} {client.last_name || ''}
                                                                        </Link>
                                                                    ) : (
                                                                        <span className="font-medium">Неизвестный</span>
                                                                    )}
                                                                </div>
                                                                <div className="text-xs text-gray-400">{client?.phone}</div>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                        <Select
                                                            defaultValue={booking.status}
                                                            disabled={pendingBookingId === booking.id}
                                                            onValueChange={(val) => {
                                                                setPendingBookingId(booking.id);
                                                                updateStatusMutation.mutate({
                                                                    id: booking.id,
                                                                    status: val,
                                                                    sessionDate: format(parseISO(session.start_time), 'yyyy-MM-dd'),
                                                                    sessionTime: session.start_time
                                                                });
                                                            }}
                                                        >
                                                            <SelectTrigger className={`w-[110px] h-7 text-xs font-bold border ${bgClass}`}>
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="booked">Записан</SelectItem>
                                                                <SelectItem value="completed">Пришел</SelectItem>
                                                                <SelectItem value="absent">Не пришел</SelectItem>
                                                                <SelectItem value="cancelled">Отмена (возврат)</SelectItem>
                                                                <SelectItem value="late_cancel">Поздняя отмена</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-7 w-7 text-gray-300 hover:text-red-500 hover:bg-red-50 shrink-0"
                                                            title="Удалить запись"
                                                            disabled={deleteBookingMutation.isPending}
                                                            onClick={() => {
                                                                if (confirm(`Удалить запись ${client?.first_name || ''}? Занятие вернётся на абонемент.`))
                                                                    deleteBookingMutation.mutate(booking.id);
                                                            }}
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </Button>
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <span className="text-gray-400 italic text-xs">Нет записей</span>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>

        {/* ================================================================================== */}
        {/* 2. ВЕРСИЯ ДЛЯ ТЕЛЕФОНА (md:hidden) */}
        {/* ================================================================================== */}
        <div className="md:hidden space-y-4 pb-20">
          {reportData.length === 0 ? (
              <div className="p-6 text-center text-gray-500 bg-white rounded-lg border">Занятий за этот период не найдено</div>
          ) : (
              reportData.map((session: any) => (
                  <div key={session.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                      
                      {/* Шапка карточки */}
                      <div className="flex justify-between items-start mb-3 border-b border-gray-100 pb-2">
                          <div>
                              <div className="text-xl font-bold text-gray-900">
                                  {format(parseISO(session.start_time), 'HH:mm')}
                              </div>
                              <div className="text-xs text-gray-500">
                                  {format(parseISO(session.start_time), 'dd.MM.yyyy')}
                              </div>
                          </div>
                          <div className="text-right">
                              <Badge variant="outline" className="mb-1 border-blue-200 text-blue-700 bg-blue-50">
                                  {session.class_type?.name}
                              </Badge>
                              <div className="text-xs text-gray-400">{getCoachName(session.coach)}</div>
                          </div>
                      </div>

                      {/* Список людей внутри урока */}
                      <div className="space-y-3">
                          {session.bookings && session.bookings.length > 0 ? (
                              session.bookings.map((booking: any) => {
                                  const client = booking.user;
                                  
                                  // Определяем цвет для карточки клиента
                                  let bgClass = "bg-slate-50 border-gray-100";
                                  if (booking.status === 'completed') bgClass = "bg-green-50 border-green-100";
                                  if (booking.status === 'absent') bgClass = "bg-orange-50 border-orange-100";
                                  if (booking.status === 'cancelled') bgClass = "bg-red-50 border-red-100";
                                  if (booking.status === 'late_cancel') bgClass = "bg-red-100 border-red-200";

                                  return (
                                      <div key={booking.id} className={`p-3 rounded-lg border ${bgClass} flex flex-col gap-2`}>
                                          <div className="flex justify-between items-center">
                                              <div className="flex min-w-0 items-center gap-2">
                                                <ClientStatusIndicators status={booking.clientStatus} reserveSpace />
                                                {client ? (
                                                  <Link className="truncate text-sm font-semibold hover:text-primary hover:underline" to={`/clients/${client.id}`}>
                                                    {client.first_name} {client.last_name || ''}
                                                  </Link>
                                                ) : (
                                                  <div className="truncate text-sm font-semibold">Неизвестный</div>
                                                )}
                                              </div>
                                              {/* Кнопка WhatsApp (КРУПНАЯ для пальца) */}
                                              {client?.phone && (
                                                  <Button 
                                                      size="sm" 
                                                      variant="outline" 
                                                      className="h-8 w-8 p-0 rounded-full border-green-200 text-green-600 bg-white"
                                                      onClick={() => sendWhatsApp(client, (booking.status === 'cancelled' || booking.status === 'late_cancel') ? 'cancel' : 'remind', session)}
                                                  >
                                                      <MessageCircle className="w-4 h-4" />
                                                  </Button>
                                              )}
                                          </div>

                                          {/* Управление статусом + удаление */}
                                          <div className="flex gap-2 items-center">
                                          <Select
                                              defaultValue={booking.status}
                                              disabled={pendingBookingId === booking.id}
                                              onValueChange={(val) => {
                                                  setPendingBookingId(booking.id);
                                                  updateStatusMutation.mutate({
                                                      id: booking.id,
                                                      status: val,
                                                      sessionDate: format(parseISO(session.start_time), 'yyyy-MM-dd'),
                                                      sessionTime: session.start_time
                                                  });
                                              }}
                                          >
                                              <SelectTrigger className="flex-1 h-8 text-xs font-medium bg-white shadow-sm border-gray-200">
                                                  <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent>
                                                  <SelectItem value="booked">📅 Записан</SelectItem>
                                                  <SelectItem value="completed">✅ Пришел</SelectItem>
                                                  <SelectItem value="absent">⛔ Не пришел</SelectItem>
                                                  <SelectItem value="cancelled">↩️ Отмена (возврат)</SelectItem>
                                                  <SelectItem value="late_cancel">🚫 Поздняя отмена</SelectItem>
                                              </SelectContent>
                                          </Select>
                                          <Button
                                              size="icon"
                                              variant="ghost"
                                              className="h-8 w-8 shrink-0 text-gray-300 hover:text-red-500 hover:bg-red-50"
                                              disabled={deleteBookingMutation.isPending}
                                              onClick={() => {
                                                  if (confirm(`Удалить запись ${client?.first_name || ''}? Занятие вернётся на абонемент.`))
                                                      deleteBookingMutation.mutate(booking.id);
                                              }}
                                          >
                                              <Trash2 className="w-4 h-4" />
                                          </Button>
                                          </div>
                                      </div>
                                  );
                              })
                          ) : (
                              <div className="text-center text-gray-400 text-xs italic py-2">Нет записей</div>
                          )}
                      </div>

                      {/* Кнопки действий с уроком */}
                      <div className="mt-4 pt-3 border-t border-gray-100">
                           <Button 
                              variant="ghost" 
                              className="w-full text-orange-600 bg-orange-50 hover:bg-orange-100 h-9 text-xs"
                              onClick={() => handleGroupNotify(session)}
                          >
                              <Megaphone className="w-4 h-4 mr-2" /> Оповестить всех
                          </Button>
                      </div>
                  </div>
              ))
          )}
        </div>
        </>
      )}

      {/* --- ДИАЛОГ ГРУППОВОГО ОПОВЕЩЕНИЯ --- */}
      <Dialog open={isNotifyDialogOpen} onOpenChange={setIsNotifyDialogOpen}>
        <DialogContent className="max-w-md">
            <DialogHeader>
                <DialogTitle>Оповещение группы</DialogTitle>
                <DialogDescription>
                    Отправьте сообщение всем записанным клиентам <b>перед</b> тем, как удалять или менять урок.
                </DialogDescription>
            </DialogHeader>
            
            {notifySession && (
                <div className="space-y-4 py-2">
                    <div className="p-3 bg-gray-50 rounded text-sm">
                        <div className="font-bold">{notifySession.class_type?.name}</div>
                        <div>{format(parseISO(notifySession.start_time), 'dd.MM.yyyy')} в {format(parseISO(notifySession.start_time), 'HH:mm')}</div>
                        <div className="text-gray-500">Записано: {notifySession.bookings?.length || 0} чел.</div>
                    </div>

                    <div className="space-y-2">
                        <Label>Тип сообщения</Label>
                        <Select value={notifyType} onValueChange={(v: any) => setNotifyType(v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="cancel">⛔ Отмена урока</SelectItem>
                                <SelectItem value="reschedule">🕒 Перенос времени</SelectItem>
                                <SelectItem value="custom">💬 Свое сообщение</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {notifyType === 'reschedule' && (
                        <div className="space-y-2 animate-in fade-in">
                            <Label>Новое время / Детали</Label>
                            <Input 
                                placeholder="Например: Перенесено на 18:00 (Среда)" 
                                value={notifyNote}
                                onChange={(e) => setNotifyNote(e.target.value)}
                            />
                        </div>
                    )}

                    {notifyType === 'custom' && (
                        <div className="space-y-2 animate-in fade-in">
                            <Label>Текст сообщения</Label>
                            <Textarea 
                                placeholder="Введите текст..." 
                                value={notifyNote}
                                onChange={(e) => setNotifyNote(e.target.value)}
                            />
                        </div>
                    )}

                    <div className="border-t pt-4 mt-2">
                        <Label className="mb-2 block">Список для отправки:</Label>
                        <div className="max-h-[200px] overflow-y-auto space-y-2">
                            {notifySession.bookings?.map((b: any) => (
                                <div key={b.id} className="flex justify-between items-center text-sm p-2 bg-slate-50 rounded hover:bg-slate-100">
                                    <span className="font-medium">
                                        {b.user?.first_name} {b.user?.last_name}
                                    </span>
                                    <Button 
                                        size="sm" 
                                        className="h-7 bg-green-600 hover:bg-green-700 text-white gap-2"
                                        onClick={() => sendWhatsApp(b.user, notifyType, notifySession, notifyNote)}
                                    >
                                        <MessageCircle className="w-3 h-3" /> Отправить
                                    </Button>
                                </div>
                            ))}
                            {(!notifySession.bookings || notifySession.bookings.length === 0) && (
                                <p className="text-gray-400 text-sm text-center italic">Нет записанных клиентов</p>
                            )}
                        </div>
                    </div>
                </div>
            )}
            
            <DialogFooter>
                <Button variant="outline" onClick={() => setIsNotifyDialogOpen(false)}>Закрыть</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
};

export default Attendance;
