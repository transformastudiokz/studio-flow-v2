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
  addWeeks,
  differenceInMinutes
} from "date-fns";
import { ru } from "date-fns/locale";
import { Loader2, User, Check, Clock, ChevronLeft, ChevronRight, XCircle, Info } from "lucide-react";
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
import {
  isFreeWorkshopMembership,
  isPaidWorkshopPass,
  isWorkshopSession,
  subscriptionIsValidOn,
  workshopAccessLabel,
  type WorkshopSubscription,
} from "@/lib/workshop-access";

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
            id, start_time, end_time, capacity, room, coach_id, booking_status, booking_closed_reason, public_description, is_client_visible, session_kind,
            class_type:class_types(id, name, color, description),
            coach:coaches(name),
            my_booking:bookings(id, user_id, subscription_id, status, access_type)
        `)
        .gte('start_time', start)
        .lte('start_time', end)
        .eq('is_client_visible', true)
        .order('start_time');

      if (error) throw error;

      const { data: subscriptions, error: subscriptionsError } = user?.id
        ? await supabase
          .from('user_subscriptions')
          .select('id,visits_remaining,is_active,start_date,end_date,created_at,plan:subscription_plans(plan_format,product_kind)')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .gt('visits_remaining', 0)
        : { data: [], error: null };
      if (subscriptionsError) throw subscriptionsError;
      const availableSubscriptions = (subscriptions || []).map((subscription: any) => ({
        ...subscription,
        plan: Array.isArray(subscription.plan) ? subscription.plan[0] : subscription.plan,
      })) as WorkshopSubscription[];

      const sessionIds = data.map((item: any) => item.id);
      const { data: oneFitCounts, error: oneFitError } = sessionIds.length
        ? await supabase.rpc('get_client_onefit_counts', { p_session_ids: sessionIds })
        : { data: [], error: null };

      if (oneFitError) throw oneFitError;

      const occupancyBySession = new Map(
        (oneFitCounts || []).map((row: any) => [row.session_id, {
          crm: Number(row.crm_bookings_count) || 0,
          onefit: Number(row.onefit_bookings_count) || 0,
          total: Number(row.occupied_count) || 0,
        }]),
      );

      return data.map((item: any) => {
          const occupancy = occupancyBySession.get(item.id) || { crm: 0, onefit: 0, total: 0 };
          const crmBooked = occupancy.crm;
          const oneFitBooked = occupancy.onefit;
          const totalBooked = occupancy.total;
          const myBooking = item.my_booking?.find((booking: any) =>
            booking.user_id === user?.id && occupiesPlace(booking.status),
          );
          const workshop = isWorkshopSession(item);
          const sessionDate = format(parseISO(item.start_time), 'yyyy-MM-dd');
          const validSubscriptions = availableSubscriptions.filter((subscription) => subscriptionIsValidOn(subscription, sessionDate));
          const workshopAccess = !workshop
            ? null
            : validSubscriptions.some(isFreeWorkshopMembership)
              ? 'free'
              : validSubscriptions.some(isPaidWorkshopPass)
                ? 'paid'
                : 'none';

          return {
            ...item,
            bookings_count: totalBooked,
            crm_bookings_count: crmBooked,
            onefit_bookings_count: oneFitBooked,
            is_booked_by_me: !!myBooking,
            my_booking_id: myBooking?.id,
            my_booking_status: myBooking?.status,
            my_subscription_id: myBooking?.subscription_id,
            my_access_type: myBooking?.access_type,
            workshop_access: workshopAccess,
            seats_left: Math.max(0, item.capacity - totalBooked)
          };
      });
    },
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  // 2. Запись на занятие
  const bookMutation = useMutation({
    mutationFn: async (target: { id: string; start_time: string; class_type?: { id?: string }; room?: string | null; coach_id?: string | null }) => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
      const { data: { session } } = await supabase.auth.getSession();
      try {
        const response = await fetch('/api/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
          body: JSON.stringify({
            action: 'book-own-session',
            sessionId: target.id,
            startTime: target.start_time,
            classTypeId: target.class_type?.id,
            room: target.room ?? null,
            coachId: target.coach_id ?? null,
          }),
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Не удалось записаться');
        return result;
      } catch (error) {
        if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
          throw new Error('Сервер долго не отвечает. Попробуй ещё раз.');
        }
        throw error;
      } finally {
        window.clearTimeout(timeoutId);
      }
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
      queryClient.invalidateQueries({ queryKey: ['client_schedule'] });
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

  const handleBook = (session: any) => {
    setPendingSessionId(session.id);
    bookMutation.mutate(session);
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
              const endDate = session.end_time ? parseISO(session.end_time) : null;
              const durationMinutes = endDate ? Math.max(0, differenceInMinutes(endDate, startDate)) : null;
              const isFull = session.seats_left === 0;
              const coachShortName = formatCoachShortName(session.coach?.name);
              const coachInitials = coachShortName
                .split(/\s+/)
                .map((part: string) => part.replace('.', '')[0])
                .filter(Boolean)
                .slice(0, 2)
                .join('') || 'Т';
              const cancellationAllowed = cancellationMinutes !== null
                && cancellationMinutes !== undefined
                && canClientCancel(startDate, cancellationMinutes);
              const workshop = isWorkshopSession(session);
              const workshopAccessText = session.is_booked_by_me
                ? workshopAccessLabel(session.my_access_type)
                : session.workshop_access === 'free'
                  ? 'Бесплатно по вашему абонементу'
                  : session.workshop_access === 'paid'
                    ? 'Пропуск оплачен · 6 000 ₸'
                    : 'Нужен пропуск · 6 000 ₸';
              
              return (
                <Card 
                    key={session.id} 
                    className={cn("client-surface client-focus overflow-hidden border-[#ded9cf] bg-[#fffefb] shadow-[0_5px_18px_rgba(48,58,51,0.07)] transition-shadow hover:shadow-[0_7px_22px_rgba(48,58,51,0.1)]", session.booking_status === 'cancelled' ? "bg-[#ece8df] text-slate-600" : session.booking_status === 'closed' ? "bg-[#f5f3ef]" : "")}
                    onClick={() => setSelectedClassInfo({ ...session.class_type, description: session.public_description || session.class_type?.description })} // ОТКРЫВАЕМ ИНФО
                >
                  <div className="grid min-w-0 grid-cols-[4.25rem_minmax(0,1fr)] gap-x-3 p-3.5 min-[420px]:grid-cols-[4.75rem_minmax(0,1fr)] min-[420px]:gap-x-4">
                      <div className="flex min-w-0 flex-col items-start">
                        <time className="whitespace-nowrap text-sm font-bold leading-5 tabular-nums text-[#2f3a33]">
                          {format(startDate, 'HH:mm')}
                        </time>
                        <span className="mt-1 whitespace-nowrap text-[11px] font-medium text-[#858880]">
                          {durationMinutes !== null ? `${durationMinutes} мин` : 'Время уточняется'}
                        </span>
                        <div aria-label={`Тренер ${coachShortName}`} className="mt-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#d7dfd7] bg-[#e8f0e9] text-sm font-semibold text-[#476e5a]">
                          {coachInitials}
                        </div>
                      </div>

                      <div className="min-w-0">
                        <button type="button" className="client-focus block w-full min-w-0 text-left" onClick={() => setSelectedClassInfo({ ...session.class_type, description: session.public_description || session.class_type?.description })}>
                          <h3 className="line-clamp-2 break-words text-sm font-bold leading-[1.22] text-[#202721]" title={session.class_type?.name || ""}>
                            {session.class_type?.name}
                          </h3>
                        </button>
                        <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-sm text-[#52695a]" title={session.coach?.name || "Тренер"}>
                          <User className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate font-medium">{coachShortName}</span>
                        </p>
                        {session.room ? <p className="mt-0.5 truncate text-xs text-[#858880]">{session.room}</p> : null}
                        {session.booking_status !== 'open' && <p className="mt-1 text-[11px] font-semibold text-[#6f706b]">{session.booking_status === 'cancelled' ? "Занятие отменено" : "Запись закрыта"}{session.booking_closed_reason ? ` · ${session.booking_closed_reason}` : ""}</p>}
                        {/мастер[\s-]*класс/i.test(session.class_type?.name || "") ? <button type="button" className="client-focus mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#f5efe2] px-2.5 py-1.5 text-[11px] font-semibold text-[#745f3c]" onClick={(event) => { event.stopPropagation(); setSelectedClassInfo({ ...session.class_type, description: session.public_description || session.class_type?.description }); }}><Info className="h-3.5 w-3.5" />Подробнее о мастер-классе</button> : null}
                        {workshop ? <div className={`mt-2 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${session.workshop_access === 'none' && !session.is_booked_by_me ? 'bg-[#f7ebe6] text-[#8e5846]' : 'bg-[#f5efe2] text-[#745f3c]'}`}>{workshopAccessText}</div> : null}

                        <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-[minmax(0,1fr)_auto]" onClick={(e) => e.stopPropagation()}>
                           {/* e.stopPropagation() ВАЖНО: Чтобы клик по кнопке не открывал инфо */}
                           {session.is_booked_by_me ? (
                                session.my_booking_status === 'late_cancel' ? (
                                    <span className="flex h-9 w-full items-center justify-center whitespace-nowrap rounded-xl border border-[#dfc7bd] bg-[#f7ebe6] px-3 text-xs font-medium text-[#8e5846]">
                                        Поздняя отмена
                                    </span>
                                ) : (
                                <Button
                                    variant="outline"
                                    className={cn(
                                      "client-focus h-9 w-full whitespace-nowrap rounded-xl px-3 text-xs",
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
                                <Button disabled variant="secondary" className="h-9 w-full whitespace-nowrap rounded-xl bg-[#ece8df] px-3 text-xs text-[#6f706b]">{session.booking_status === 'cancelled' ? "Занятие отменено" : "Запись закрыта"}</Button>
                            ) : workshop && session.workshop_access === 'none' ? (
                                <Button disabled variant="secondary" className="h-9 w-full whitespace-nowrap rounded-xl bg-[#f7ebe6] px-3 text-xs text-[#8e5846]">Оформить у администратора</Button>
                            ) : isFull ? (
                                <Button disabled variant="secondary" className="h-9 w-full whitespace-nowrap rounded-xl bg-[#ece8df] px-3 text-xs text-[#6f706b]">
                                Заполнено
                                </Button>
                            ) : (
                                <Button
                                onClick={() => handleBook(session)}
                                disabled={pendingSessionId === session.id}
                                className="client-primary client-focus h-9 w-full whitespace-nowrap rounded-xl px-4 text-xs shadow-none"
                                >
                                {pendingSessionId === session.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Записаться"}
                                </Button>
                            )}
                            <span className={cn(
                              "flex h-9 min-w-[5.25rem] items-center justify-center whitespace-nowrap rounded-xl border border-[#d8d9d4] bg-[#e8e9e5] px-3 text-xs font-semibold text-[#555d56]",
                            )}>
                              {isFull ? "Нет мест" : `${session.seats_left} свободно`}
                            </span>
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
