import { useState } from "react";
import { ClientLayout } from "@/components/layout/ClientLayout";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

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
            id, start_time, end_time, capacity, booking_status, booking_closed_reason,
            class_type:class_types(name, color, description),
            coach:coaches(name),
            my_booking:bookings(id, user_id, subscription_id, status),
            all_bookings:bookings(id, user_id, status)
        `)
        .gte('start_time', start)
        .lte('start_time', end)
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Нет авторизации");

      const { data: sessionData, error: sErr } = await supabase
        .from('schedule_sessions')
        .select('capacity, booking_status, booking_closed_reason, bookings(id,status)')
        .eq('id', sessionId)
        .single();
      
      if(sErr) throw sErr;
      if (sessionData.booking_status !== 'open') throw new Error(sessionData.booking_status === 'cancelled' ? "Занятие отменено" : "Запись на занятие закрыта");
      const currentCount = (sessionData.bookings || []).filter((booking: any) => occupiesPlace(booking.status)).length;
      if (currentCount >= sessionData.capacity) throw new Error("К сожалению, места только что закончились");

      const todayStr = new Date().toISOString().split('T')[0];
      const { data: subs } = await supabase
        .from('user_subscriptions')
        .select('id, visits_remaining')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .gte('visits_remaining', 1)
        .or('end_date.is.null,end_date.gte.' + todayStr)
        .order('end_date', { ascending: true, nullsFirst: false })
        .limit(1);

      if (!subs || subs.length === 0) throw new Error("Нет активного абонемента или закончились занятия");
      const activeSub = subs[0];

      const { error: bookError } = await supabase.from('bookings').insert({
          session_id: sessionId,
          user_id: user.id,
          subscription_id: activeSub.id,
          status: 'booked'
      });
      if (bookError) throw bookError;
      // visits_remaining пересчитывается триггером on_booking_change_recalc на бэкенде
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
    <ClientLayout>
      <div className="space-y-4">
        {/* Заголовок и навигация */}
        <div className="flex items-center justify-between px-4 pt-4">
            <h1 className="text-xl font-bold">Расписание</h1>
            <div className="flex gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handlePrevWeek}>
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" className="h-8 text-xs px-2" onClick={handleToday}>
                    Сегодня
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleNextWeek}>
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
        
        {/* Календарь */}
        <div className="grid grid-cols-7 gap-1 px-2">
          {days.map((date) => {
            const isSelected = isSameDay(date, selectedDate);
            const isTodayDate = isSameDay(date, new Date());
            
            return (
              <button 
                key={date.toString()} 
                onClick={() => setSelectedDate(date)} 
                className={cn(
                  "flex flex-col items-center justify-center py-1.5 rounded-lg border transition-all shadow-sm relative overflow-hidden min-h-[50px]",
                  isSelected 
                    ? "bg-primary text-white border-primary shadow-md z-10" 
                    : "bg-white border-gray-100 text-gray-500 hover:bg-gray-50",
                  isTodayDate && !isSelected && "border-blue-300 bg-blue-50/50"
                )}
              >
                {isTodayDate && !isSelected && (
                    <div className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-blue-500 rounded-full" />
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

        <div className="px-4 text-sm text-gray-500 font-medium capitalize border-b pb-2">
            {format(selectedDate, 'eeee, d MMMM', { locale: ru })}
        </div>

        {/* СПИСОК ЗАНЯТИЙ */}
        <div className="space-y-3 px-4 pb-24">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary/50" /></div>
          ) : classes.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground bg-white rounded-2xl border border-dashed border-gray-200">
                <p>Нет занятий на этот день</p>
            </div>
          ) : (
            classes.map((session: any) => {
              const startDate = parseISO(session.start_time);
              const isFull = session.seats_left === 0;
              
              return (
                <Card 
                    key={session.id} 
                    className={cn("overflow-hidden border-0 shadow-sm ring-1 rounded-xl hover:shadow-md transition-shadow cursor-pointer active:scale-[0.99]", session.booking_status === 'cancelled' ? "bg-slate-200 ring-slate-300 text-slate-600" : session.booking_status === 'closed' ? "bg-slate-50 ring-slate-200" : "ring-gray-100")}
                    onClick={() => setSelectedClassInfo(session.class_type)} // ОТКРЫВАЕМ ИНФО
                >
                  <div className="flex h-full">
                      <div className="w-1.5 shrink-0" style={{ backgroundColor: session.class_type?.color || '#3b82f6' }} />
                      
                      <div className="p-3 flex-1 flex flex-row items-center justify-between gap-3">
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
                                            {session.seats_left} мест
                                        </span>
                                    ) : (
                                        <span className="text-[10px] font-medium text-red-500 bg-red-50 px-1.5 py-0.5 rounded-md">Full</span>
                                    )}
                                </div>
                            </div>

                            <h3 className="font-bold text-sm leading-tight truncate">{session.class_type?.name}</h3>
                            {session.booking_status !== 'open' && <p className="mt-1 text-[10px] font-semibold text-slate-600">{session.booking_status === 'cancelled' ? "Занятие отменено" : "Запись закрыта"}{session.booking_closed_reason ? ` · ${session.booking_closed_reason}` : ""}</p>}
                            <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5 truncate">
                                <User className="w-3 h-3" /> {session.coach?.name || "Тренер"}
                            </p>
                        </div>

                        <div className="shrink-0" onClick={(e) => e.stopPropagation()}> 
                           {/* e.stopPropagation() ВАЖНО: Чтобы клик по кнопке не открывал инфо */}
                           {session.is_booked_by_me ? (
                                session.my_booking_status === 'late_cancel' ? (
                                    <span className="h-8 text-xs px-3 flex items-center rounded-md bg-red-50 text-red-600 border border-red-200 font-medium">
                                        Поздняя отмена
                                    </span>
                                ) : (
                                <Button
                                    variant="outline"
                                    className="h-8 text-xs border-green-200 bg-green-50 text-green-700 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors px-3 group"
                                    onClick={() => handleCancel(session.my_booking_id, session.my_subscription_id, session.start_time)}
                                    disabled={cancelMutation.isPending}
                                >
                                    {cancelMutation.isPending ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                        <>
                                            <Check className="w-3 h-3 mr-1 group-hover:hidden" />
                                            <span className="group-hover:hidden">Записан</span>
                                            <XCircle className="w-3 h-3 mr-1 hidden group-hover:block" />
                                            <span className="hidden group-hover:inline">Отмена?</span>
                                        </>
                                    )}
                                </Button>
                                )
                            ) : session.booking_status !== 'open' ? (
                                <Button disabled variant="secondary" className="h-8 text-xs bg-slate-200 text-slate-600 px-3">{session.booking_status === 'cancelled' ? "Отменено" : "Запись закрыта"}</Button>
                            ) : isFull ? (
                                <Button disabled variant="secondary" className="h-8 text-xs bg-gray-100 text-gray-400 px-3">
                                Заполнено
                                </Button>
                            ) : (
                                <Button
                                onClick={() => handleBook(session.id)}
                                disabled={pendingSessionId === session.id}
                                className="h-8 text-xs shadow-sm rounded-lg px-4"
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
    </ClientLayout>
  );
};

export default ClientSchedule;
