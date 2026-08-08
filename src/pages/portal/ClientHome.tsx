import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Calendar, MessageCircle, ChevronRight, Megaphone, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { ClientSubscriptionCard } from "@/components/portal/ClientSubscriptionCard";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

const formatShortCoachName = (fullName?: string | null) => {
  const parts = fullName?.trim().split(/\s+/).filter(Boolean) || [];
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];

  // В базе ФИО тренеров может храниться как «Фамилия Имя Отчество».
  return `${parts[1]} ${parts[0][0]}.`;
};

const shortWeekdays = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];

const ClientHome = () => {
  const navigate = useNavigate();
  const [selectedNews, setSelectedNews] = useState<any>(null);

  const { data: clientData, isLoading } = useQuery({
    queryKey: ['portal_home_data'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Нет авторизации");

      // 1. Профиль
      const { data: profile, error: pError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (pError) throw pError;

      // 2. Абонементы
      // ИЗМЕНЕНИЕ: Упрощенный запрос без bookings, доверяем visits_remaining из БД
      const today = new Date().toISOString().split('T')[0];
      const { data: subs } = await supabase
        .from('user_subscriptions')
        .select('*, plan:subscription_plans(name)')
        .eq('user_id', profile.id) 
        .eq('is_active', true)
        .or('end_date.is.null,end_date.gte.' + today)
        .order('end_date', { ascending: true, nullsFirst: false }); // Сортируем: сначала те, что раньше кончатся

      // 3. Новости
      const { data: news } = await supabase
        .from('news')
        .select('*')
        .eq('is_published', true)
        .order('published_at', { ascending: false })
        .limit(10);

      // 4. Телефон студии для WhatsApp
      const { data: phoneRow } = await supabase
        .from('studio_info')
        .select('value')
        .eq('key', 'phone')
        .single();
      const adminPhone = phoneRow?.value || '';

      // 5. Ближайшая будущая запись клиента
      const { data: upcomingBookings, error: upcomingError } = await supabase
        .from('bookings')
        .select(`
          id,
          status,
          session:schedule_sessions!inner(
            id,
            start_time,
            end_time,
            room,
            class_type:class_types(name),
            coach:coaches(name)
          )
        `)
        .eq('user_id', profile.id)
        .eq('status', 'booked')
        .gte('session.start_time', new Date().toISOString())
        .order('start_time', { referencedTable: 'schedule_sessions', ascending: true })
        .limit(1);
      if (upcomingError) throw upcomingError;

      // Ищем активный абонемент:
      // Либо безлимит (visits_total === null)
      // Либо есть остаток (visits_remaining > 0)
      const activeSub = subs?.find((s: any) => s.visits_total === null || s.visits_remaining > 0);

      return { profile, subscriptions: subs || [], activeSub, news: news || [], adminPhone, upcomingBooking: upcomingBookings?.[0] || null };
    }
  });

  const openWhatsApp = () => {
    const phone = clientData?.adminPhone;
    if (!phone) return;
    window.open(`https://wa.me/${phone.replace(/\D/g, '')}`, '_blank');
  };

  if (isLoading) return <div className="mt-20 flex justify-center"><Loader2 className="animate-spin text-[var(--client-sage-deep)]" /></div>;

  const profile = clientData?.profile;
  const activeSub = clientData?.activeSub;
  const newsList = clientData?.news || [];
  const upcomingBooking = clientData?.upcomingBooking;
  const upcomingSession = Array.isArray(upcomingBooking?.session) ? upcomingBooking.session[0] : upcomingBooking?.session;
  const upcomingClassType = Array.isArray(upcomingSession?.class_type) ? upcomingSession.class_type[0] : upcomingSession?.class_type;
  const upcomingCoach = Array.isArray(upcomingSession?.coach) ? upcomingSession.coach[0] : upcomingSession?.coach;
  const upcomingStart = upcomingSession?.start_time ? parseISO(upcomingSession.start_time) : null;

  return (
    <div className="client-page space-y-6 animate-in fade-in">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <p className="client-muted text-sm font-medium">Личный кабинет</p>
          <h1 className="client-page-title mt-1">Привет, {profile?.first_name || ""}</h1>
          <p className="client-muted mt-1 text-sm">Всё для занятий — в одном месте</p>
        </div>
      </div>

      {/* АБОНЕМЕНТ */}
      <section>
        <div className="flex justify-between items-center mb-3">
            <h2 className="client-section-title">Мой абонемент</h2>
            <Button variant="ghost" size="sm" className="client-focus h-10 px-1 text-[var(--client-sage-deep)] hover:bg-transparent" onClick={() => navigate('/portal/pricing')}>
                Все тарифы <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
        </div>
        
        {activeSub ? (
            <ClientSubscriptionCard subscription={activeSub} />
        ) : (
            <Card className="client-surface border-dashed bg-transparent shadow-none">
                <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                    <p className="font-medium text-gray-900">Нет активного абонемента</p>
                    <p className="text-sm text-gray-500 mt-1 mb-4">Купите абонемент, чтобы записаться.</p>
                    <Button className="client-primary" size="sm" onClick={() => navigate('/portal/pricing')}>
                        Купить абонемент
                    </Button>
                </CardContent>
            </Card>
        )}
      </section>

      {/* МЕНЮ ДЕЙСТВИЙ */}
      <div className="grid grid-cols-2 gap-2.5">
        <Button variant="outline" className="client-surface client-focus h-14 justify-start gap-2.5 rounded-2xl px-3 text-[var(--client-graphite)] shadow-none hover:bg-[#f1f4f1]" onClick={() => navigate('/portal/schedule')}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#e4eae4]"><Calendar className="h-[18px] w-[18px] text-[var(--client-sage-deep)]" /></span>
            <span className="min-w-0 text-sm font-semibold">Расписание</span>
        </Button>
        <Button variant="outline" className="client-surface client-focus h-14 justify-start gap-2.5 rounded-2xl px-3 text-[var(--client-graphite)] shadow-none hover:bg-[#f1f4f1]" onClick={openWhatsApp}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#e4eae4]"><MessageCircle className="h-[18px] w-[18px] text-[var(--client-sage-deep)]" /></span>
            <span className="min-w-0 text-left text-sm font-semibold leading-tight">Связаться</span>
        </Button>
      </div>

      {upcomingSession?.start_time && (
        <section>
          <h2 className="client-section-title mb-3">Моя ближайшая запись</h2>
          <button
            type="button"
            className="client-surface client-focus flex w-full items-center gap-3 p-4 text-left transition-shadow hover:shadow-md"
            onClick={() => navigate('/portal/schedule')}
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#e4eae4]">
              <Clock className="h-5 w-5 text-[var(--client-sage-deep)]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="client-muted block text-xs font-semibold uppercase tracking-wide">
                {upcomingStart && `${shortWeekdays[upcomingStart.getDay()]} · ${format(upcomingStart, 'd MMMM · HH:mm', { locale: ru })}`}
              </span>
              <span className="mt-1 block truncate text-sm font-bold text-[var(--client-graphite)]">{upcomingClassType?.name || 'Занятие'}</span>
              <span className="client-muted mt-0.5 block truncate text-xs">
                {[formatShortCoachName(upcomingCoach?.name), upcomingSession.room].filter(Boolean).join(' · ')}
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-[var(--client-sage-deep)]" />
          </button>
        </section>
      )}

      {/* НОВОСТИ (Вертикальный скролл) */}
      {newsList.length > 0 && (
        <section className="pt-2">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-[#9a7448]" /> Новости
            </h2>
            {/* Ограничиваем высоту max-h-[300px] и включаем overflow-y-auto */}
            <div className="flex flex-col gap-3">
                {newsList.map((item: any) => (
                    <div 
                        key={item.id} 
                        className="client-surface client-focus w-full cursor-pointer p-4 text-left transition-shadow hover:shadow-md"
                        onClick={() => setSelectedNews(item)}
                    >
                        <div className="flex justify-between items-center mb-2">
                            <h4 className="font-bold text-sm leading-tight flex-1 mr-2">{item.title}</h4>
                            <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap bg-gray-50 px-2 py-1 rounded-md">
                                {format(parseISO(item.published_at), 'dd.MM')}
                            </span>
                        </div>
                        <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">
                            {item.content}
                        </p>
                    </div>
                ))}
            </div>
        </section>
      )}

      {/* МОДАЛЬНОЕ ОКНО НОВОСТИ */}
      <Dialog open={!!selectedNews} onOpenChange={(open) => !open && setSelectedNews(null)}>
        <DialogContent className="max-w-xs sm:max-w-md rounded-2xl">
            <DialogHeader>
                <DialogTitle className="text-lg font-bold pr-6 leading-tight">{selectedNews?.title}</DialogTitle>
                <DialogDescription>
                    {selectedNews?.published_at && format(parseISO(selectedNews.published_at), 'd MMMM yyyy', { locale: ru })}
                </DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh] pr-2">
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {selectedNews?.content}
                </p>
            </ScrollArea>
            <DialogFooter>
                <Button className="w-full rounded-xl" onClick={() => setSelectedNews(null)}>Закрыть</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ClientHome;
