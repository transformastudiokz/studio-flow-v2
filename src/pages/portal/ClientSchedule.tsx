import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { 
  format, 
  addDays, 
  isSameDay, 
  startOfDay, 
  endOfDay, 
  parseISO, 
  startOfWeek, 
  addWeeks
} from "date-fns";
import { ru } from "date-fns/locale";
import { Loader2, User, Check, Clock, ChevronLeft, ChevronRight, XCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { occupiesPlace } from "@/lib/schedule";
import { formatCoachShortName } from "@/lib/schedule";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { canClientCancel, parseCancellationMinutes } from "@/lib/cancellation";

const ClientSchedule = () => {
  const queryClient = useQueryClient();
  
  // Состояния
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedClassInfo, setSelectedClassInfo] = useState<any>(null); // Для модалки инфо
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);

  // Вычисляем дни для текущей недели
  const weekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i));

  const { data: cancellationMinutes } = useQuery({
    queryKey: ['studio_info', 'cancellation_minutes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('studio_info')
        .select('value')
        .eq('key', 'cancellation_minutes')
        .maybeSingle();
      if (error) throw error;
      return parseCancellationMinutes(data?.value);
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  // Навигация
  const handlePrevWeek = () => setWeekOffset((prev) => prev - 1);
  const handleNextWeek = () => setWeekOffset((prev) => prev + 1);
  const handleToday = () => {
    setWeekOffset(0);
    setSelectedDate(new Date());
  };

  // 1. Загрузка расписания
  const { data: classes = [], isLoading } = useQuery({
    queryKey: ['client_schedule', format(selectedDate, 'yyyy-MM-dd')],
    queryFn: async () => {
      const start = startOfDay(selectedDate).toISOString();
      const end = endOfDay(selectedDate).toISOString();
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data, error } = await supabase
        .from('schedule_sessions')
        .select(`
            id, start_time, end_time, capacity, booking_status, booking_closed_reason, is_client_visible,
            class_type:class_types(name, color, description),
            coach:coaches(name),
            my_booking:bookings(id, user_id, subscription_id, status),
            all_bookings:bookings(id, user_id, status)
        `)
        .gte('start_time', start)
        .lte('start_time', end)
        .eq('is_client_visible', true)
        .order('start_time');

      if (error) throw error;

      return data.map((item: any) => {
          const totalBooked = (item.all_bookings || []).filter((booking: any) => occupiesPlace(booking.status)).length;
          const myBooking = item.my_booking?.find((booking: any) =>
            booking.user_id === user?.id && occupiesPlace(booking.status),
          );

          return {
            ...item,
            bookings_count: totalBooked,
            is_booked_by_me: !!myBooking,
            my_booking_id: myBooking?.id,
            my_booking_status: myBooking?.status,
            my_subscription_id: myBooking?.subscription_id,
            seats_left: Math.max(0, item.capacity - totalBooked)
          };
      });
    }
  });

  // 2. Запись на занятие
  const bookMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ action: 'book-own-session', sessionId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не удалось записаться');
      return result;
    },
    onSuccess: () => {
      setPendingSessionId(null);
      toast.success("Вы успешно записаны!");
      queryClient.invalidateQueries({ queryKey: ['client_schedule'] });
      queryClient.invalidateQueries({ queryKey: ['portal_home_data'] });
    },
    onError: (error: any) => {
      setPendingSessionId(null);
      toast.error(error.message || "Ошибка записи");
    }
  });

  // 3. Отмена записи
  const cancelMutation = useMutation({
    mutationFn: async ({ bookingId }: { bookingId: string, subscriptionId: string, startTime: string }) => {
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch('/api/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
          body: JSON.stringify({ action: 'cancel-own-booking', bookingId }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Не удалось отменить запись');
        return result;
    },
    onSuccess: () => {
        toast.success("Запись отменена");
        queryClient.invalidateQueries({ queryKey: ['client_schedule'] });
        queryClient.invalidateQueries({ queryKey: ['portal_home_data'] });
    },
    onError: (error: any) => toast.error(error.message)
  });

  const handleBook = (sessionId: string) => {
    setPendingSessionId(sessionId);
    bookMutation.mutate(sessionId);
  };

  const handleCancel = (bookingId: string, subscriptionId: string, startTime: string) => {
    if (confirm(`Вы уверены, что хотите отменить запись?`)) {
        cancelMutation.mutate({ bookingId, subscriptionId, startTime });
    }
  };

  return (
      <div className="client-page space-y-4">
        {/* Заголовок и навигация */}
        <div className="flex items-center justify-between">
            <h1 className="client-page-title">Расписание</h1>
            <div className="flex gap-1">
                <Button aria-label="Предыдущая неделя" variant="outline" size="icon" className="client-focus h-11 w-11 rounded-xl bg-[#fffefb]" onClick={handlePrevWeek}>
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" className="client-focus h-11 rounded-xl bg-[#fffefb] text-xs px-3" onClick={handleToday}>
                    Сегодня
                </Button>
                <Button aria-label="Следующая неделя" variant="outline" size="icon" className="client-focus h-11 w-11 rounded-xl bg-[#fffefb]" onClick={handleNextWeek}>
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
        
        {/* Календарь */}
        <div className="grid grid-cols-7 gap-1">
          {days.map((date) => {
            const isSelected = isSameDay(date, selectedDate);
            const isTodayDate = isSameDay(date, new Date());
            
            return (
              <button 
                key={date.toString()} 
                onClick={() => setSelectedDate(date)} 
                className={cn(
                  "client-focus relative flex min-h-[54px] flex-col items-center justify-center overflow-hidden rounded-xl border py-1.5 transition-colors",
                  isSelected 
                    ? "bg-primary text-white border-primary shadow-md z-10" 
                    : "bg-[#fffefb] border-[#e4dfd5] text-[#6f706b] hover:bg-[#f1f4f1]",
                  isTodayDate && !isSelected && "border-[#8a9b8c] bg-[#f1f4f1]"
                )}
              >
                {isTodayDate && !isSelected && (
                    <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-[#566b5c] rounded-full" />
                )}
                <span className="text-[9px] font-bold uppercase opacity-80">
                    {format(date, 'EEE', { locale: ru }).slice(0, 2)}
                </span>
                <span className="text-base font-bold leading-none">
                    {format(date, 'd')}
                </span>
              </button>
            )
          })}
        </div>

        <div className="client-muted border-b border-[#e4dfd5] pb-2 text-sm font-medium capitalize">
            {format(selectedDate, 'eeee, d MMMM', { locale: ru })}
        </div>

        {/* СПИСОК ЗАНЯТИЙ */}
        <div className="space-y-3 pb-4">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary/50" /></div>
          ) : classes.length === 0 ? (
            <div className="client-surface text-center py-12 text-muted-foreground border-dashed shadow-none">
                <p>Нет занятий на этот день</p>
            </div>
          ) : (
            classes.map((session: any) => {
              const startDate = parseISO(session.start_time);
              const isFull = session.seats_left === 0;
              const cancellationAllowed = cancellationMinutes !== null
                && cancellationMinutes !== undefined
                && canClientCancel(startDate, cancellationMinutes);
              
              return (
                <Card 
                    key={session.id} 
                    className={cn("client-surface client-focus overflow-hidden transition-shadow hover:shadow-md", session.booking_status === 'cancelled' ? "bg-[#ece8df] text-slate-600" : session.booking_status === 'closed' ? "bg-[#f5f3ef]" : "")}
                    onClick={() => setSelectedClassInfo(session.class_type)} // ОТКРЫВАЕМ ИНФО
                >
                  <div className="flex h-full">
                      <div className="w-1.5 shrink-0" style={{ backgroundColor: session.class_type?.color || '#3b82f6' }} />
                      
                      <div className="min-w-0 flex-1 p-3 min-[400px]:grid min-[400px]:grid-cols-[minmax(0,1fr)_8.5rem] min-[400px]:items-center min-[400px]:gap-3">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <div className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-gray-100 text-primary font-bold text-xs whitespace-nowrap tabular-nums">
                                    <Clock className="w-3 h-3 mr-1" />
                                    {format(startDate, 'HH:mm')}
                                    {session.end_time && <span className="text-gray-400 font-normal mx-0.5">–</span>}
                                    {session.end_time && format(parseISO(session.end_time), 'HH:mm')}
                                </div>
                                <div className="flex items-center gap-1">
                                    {!isFull ? (
                                        <span className={cn(
                                            "text-[10px] font-semibold px-1.5 py-0.5 rounded-md",
                                            session.seats_left <= 3 ? "text-orange-600 bg-orange-50" : "text-green-600 bg-green-50"
                                        )}>
                                            {session.seats_left} свободно
                                        </span>
                                    ) : (
                                        <span className="text-[10px] font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded-md">Мест нет</span>
                                    )}
                                </div>
                            </div>

                            <button type="button" className="client-focus block max-w-full text-left" onClick={() => setSelectedClassInfo(session.class_type)}><h3 className="line-clamp-2 text-sm font-bold leading-tight">{session.class_type?.name}</h3></button>
                            {session.booking_status !== 'open' && <p className="mt-1 text-[10px] font-semibold text-slate-600">{session.booking_status === 'cancelled' ? "Занятие отменено" : "Запись закрыта"}{session.booking_closed_reason ? ` · ${session.booking_closed_reason}` : ""}</p>}
                            <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5 truncate">
                                <User className="w-3 h-3" /> {formatCoachShortName(session.coach?.name)}
                            </p>
                        </div>

                        <div className="mt-2 min-[400px]:mt-0" onClick={(e) => e.stopPropagation()}>
                           {/* e.stopPropagation() ВАЖНО: Чтобы клик по кнопке не открывал инфо */}
                           {session.is_booked_by_me ? (
                                session.my_booking_status === 'late_cancel' ? (
                                    <span className="h-8 text-xs px-3 flex items-center rounded-md bg-red-50 text-red-600 border border-red-200 font-medium">
                                        Поздняя отмена
                                    </span>
                                ) : (
                                <Button
                                    variant="outline"
                                    className={cn(
                                      "client-focus h-10 w-full rounded-xl px-4 text-xs",
                                      cancellationAllowed
                                        ? "border-[#b7c3b8] bg-[#eaf5ed] text-[#3f7a59]"
                                        : "border-[#e4dfd5] bg-[#ece8df] text-[#6f706b]",
                                    )}
                                    onClick={() => handleCancel(session.my_booking_id, session.my_subscription_id, session.start_time)}
                                    disabled={cancelMutation.isPending || !cancellationAllowed}
                                    title={!cancellationAllowed && cancellationMinutes !== null && cancellationMinutes !== undefined
                                      ? `Отмена закрывается за ${cancellationMinutes} мин. до занятия`
                                      : undefined}
                                >
                                    {cancelMutation.isPending ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                        <>
                                            {cancellationAllowed ? <XCircle className="w-3.5 h-3.5 mr-1.5" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
                                            <span>{cancellationAllowed ? "Отменить запись" : "Отмена закрыта"}</span>
                                        </>
                                    )}
                                </Button>
                                )
                            ) : session.booking_status !== 'open' ? (
                                <Button disabled variant="secondary" className="h-10 w-full rounded-xl bg-[#ece8df] px-3 text-xs text-[#6f706b]">{session.booking_status === 'cancelled' ? "Занятие отменено" : "Запись закрыта"}</Button>
                            ) : isFull ? (
                                <Button disabled variant="secondary" className="h-10 w-full rounded-xl bg-[#ece8df] px-3 text-xs text-[#6f706b]">
                                Заполнено
                                </Button>
                            ) : (
                                <Button
                                onClick={() => handleBook(session.id)}
                                disabled={pendingSessionId === session.id}
                                className="client-primary client-focus h-10 w-full rounded-xl px-4 text-xs shadow-none"
                                >
                                {pendingSessionId === session.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Записаться"}
                                </Button>
                            )}
                        </div>
                      </div>
                  </div>
                </Card>
              );
            })
          )}
        </div>

        {/* МОДАЛЬНОЕ ОКНО С ИНФОРМАЦИЕЙ О ЗАНЯТИИ */}
        <Dialog open={!!selectedClassInfo} onOpenChange={(open) => !open && setSelectedClassInfo(null)}>
            <DialogContent className="max-w-xs sm:max-w-md rounded-2xl">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: selectedClassInfo?.color || '#ccc' }} />
                        {selectedClassInfo?.name}
                    </DialogTitle>
                    {/* <DialogDescription>Информация о занятии</DialogDescription> */}
                </DialogHeader>
                
                <ScrollArea className="max-h-[50vh] pr-2">
                    <div className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                        {selectedClassInfo?.description || "Описание занятия отсутствует."}
                    </div>
                </ScrollArea>

                <DialogFooter>
                    <Button className="w-full rounded-xl" onClick={() => setSelectedClassInfo(null)}>
                        Понятно
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

      </div>
  );
};

export default ClientSchedule;
