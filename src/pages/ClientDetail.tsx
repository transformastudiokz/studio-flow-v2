import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, User, Phone, Mail, Calendar, CreditCard, History, Edit, Trash2, CalendarSync } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSellModalOpen, setIsSellModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [editForm, setEditForm] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
  });

  // Загрузка данных клиента
  const { data: client, isLoading: isClientLoading } = useQuery({
    queryKey: ['client', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    }
  });

  // Загрузка абонементов
  const { data: subscriptions = [] } = useQuery({
    queryKey: ['client_subscriptions', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('*, plan:subscription_plans(name)')
        .eq('user_id', id)
        .order('end_date', { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  // Загрузка истории посещений
  const { data: bookings = [] } = useQuery({
    queryKey: ['client_bookings', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          *,
          session:schedule_sessions(
            id,
            start_time,
            class_type:class_types(name)
          )
        `)
        .eq('user_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  const { data: transferEvents = [] } = useQuery({
    queryKey: ['client_booking_transfers', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booking_change_log')
        .select('id,changed_at,old_data,new_data')
        .eq('user_id', id)
        .eq('action', 'updated')
        .order('changed_at', { ascending: false });
      if (error) throw error;
      const transfers = (data || []).filter((event: any) =>
        event.new_data?.event_type === 'rescheduled'
        || (event.old_data?.session_id && event.new_data?.session_id && event.old_data.session_id !== event.new_data.session_id),
      );
      const sessionIds = [...new Set(transfers.flatMap((event: any) => {
        const payload = event.new_data?.event_type === 'rescheduled' ? event.new_data : {
          from_session_id: event.old_data?.session_id,
          to_session_id: event.new_data?.session_id,
        };
        return [payload.from_session_id, payload.to_session_id].filter(Boolean);
      }))];
      const { data: sessions, error: sessionsError } = sessionIds.length
        ? await supabase.from('schedule_sessions').select('id,start_time,class_type:class_types(name)').in('id', sessionIds)
        : { data: [], error: null };
      if (sessionsError) throw sessionsError;
      const sessionById = new Map((sessions || []).map((session: any) => [session.id, session]));
      return transfers.map((event: any) => {
        const payload = event.new_data?.event_type === 'rescheduled' ? event.new_data : {
          event_type: 'rescheduled',
          from_booking_id: event.old_data?.id,
          to_booking_id: event.new_data?.id,
          from_session_id: event.old_data?.session_id,
          to_session_id: event.new_data?.session_id,
        };
        return {
          ...event,
          new_data: payload,
          from_session: sessionById.get(payload.from_session_id),
          to_session: sessionById.get(payload.to_session_id),
        };
      });
    }
  });

  const transferNotes = useMemo(() => {
    const bookingById = new Map(bookings.map((booking: any) => [booking.id, booking]));
    const notes = new Map<string, { direction: 'from' | 'to'; other?: any }>();
    transferEvents.forEach((event: any) => {
      const payload = event.new_data || {};
      notes.set(payload.from_booking_id, { direction: 'from', other: bookingById.get(payload.to_booking_id) });
      notes.set(payload.to_booking_id, { direction: 'to', other: bookingById.get(payload.from_booking_id) });
    });
    return notes;
  }, [bookings, transferEvents]);

  // Загрузка доступных планов
  const { data: plans = [] } = useQuery({
    queryKey: ['active_plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('is_active', true);
      if (error) throw error;
      return data;
    }
  });

  const openEditModal = () => {
    setEditForm({
      first_name: client?.first_name || "",
      last_name: client?.last_name || "",
      phone: client?.phone || "",
      email: client?.email || "",
    });
    setIsEditModalOpen(true);
  };

  const updateClientMutation = useMutation({
    mutationFn: async () => {
      const firstName = editForm.first_name.trim();
      const cleanPhone = editForm.phone.replace(/\D/g, "");

      if (!firstName) throw new Error("Введите имя клиента");
      if (cleanPhone.length < 10) {
        throw new Error("Введите корректный телефон — минимум 10 цифр");
      }

      const { data: duplicatePhone, error: duplicateError } = await supabase
        .from("profiles")
        .select("id")
        .eq("phone", cleanPhone)
        .neq("id", id)
        .limit(1);

      if (duplicateError) throw duplicateError;
      if (duplicatePhone?.length) {
        throw new Error("Клиент с таким телефоном уже существует");
      }

      const { error } = await supabase
        .from("profiles")
        .update({
          first_name: firstName,
          last_name: editForm.last_name.trim() || null,
          phone: cleanPhone,
          email: editForm.email.trim().toLocaleLowerCase() || null,
        })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client", id] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["attendance_report"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard_upcoming_classes"] });
      setIsEditModalOpen(false);
      toast({ title: "Сохранено", description: "Данные клиента обновлены" });
    },
    onError: (error: any) => {
      toast({ title: "Не удалось сохранить", description: error.message, variant: "destructive" });
    },
  });

  // Продажа абонемента
  const sellMutation = useMutation({
    mutationFn: async () => {
      const plan = plans.find((p: any) => p.id === selectedPlanId);
      if (!plan) throw new Error("План не найден");

      const startDate = new Date();

      const { error } = await supabase.from('user_subscriptions').insert({
        user_id: id,
        plan_id: plan.id,
        visits_remaining: plan.visits_count,
        visits_total: plan.visits_count,
        start_date: format(startDate, 'yyyy-MM-dd'),
        activation_date: null,
        end_date: null,
        is_active: true
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client_subscriptions'] });
      setIsSellModalOpen(false);
      toast({ title: "Успешно", description: "Абонемент добавлен клиенту" });
    },
    onError: (error: any) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    }
  });

// ... (остальной код в начале файла без изменений)

  if (isClientLoading) return <div>Загрузка...</div>;

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* ИСПРАВЛЕНИЕ: Кнопка назад ведет на /clients, а не /admin/clients */}
      <Button variant="ghost" onClick={() => navigate('/clients')} className="mb-2 -ml-2">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Назад
      </Button>

      <div className="grid gap-4 md:gap-6 md:grid-cols-[1fr_300px]">
        <div className="space-y-4 md:space-y-6">
          {/* Шапка профиля */}
          <Card>
            <CardContent className="p-4 md:p-6">
              <div className="flex flex-wrap items-start gap-4 justify-between">
                <div className="flex gap-3 min-w-0">
                  <div className="h-14 w-14 md:h-20 md:w-20 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-xl md:text-2xl font-bold text-primary">
                    {client?.first_name?.[0]}{client?.last_name?.[0]}
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-lg md:text-2xl font-bold leading-tight">{client?.first_name} {client?.last_name}</h1>
                    <div className="flex flex-col gap-1 text-muted-foreground mt-1 text-sm">
                      <div className="flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5 shrink-0" /> {client?.phone}
                      </div>
                      {client?.email && (
                        <div className="flex items-center gap-1.5">
                          <Mail className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate text-xs">{client?.email}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              <div className="flex shrink-0 flex-wrap gap-2">
              <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
                <Button size="sm" variant="outline" onClick={openEditModal}>
                  <Edit className="mr-2 h-4 w-4" />
                  Редактировать
                </Button>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Редактирование клиента</DialogTitle>
                  </DialogHeader>
                  <div className="grid gap-4 py-2">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="client-first-name">Имя *</Label>
                        <Input
                          id="client-first-name"
                          value={editForm.first_name}
                          onChange={(event) =>
                            setEditForm({ ...editForm, first_name: event.target.value })
                          }
                          autoFocus
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="client-last-name">Фамилия</Label>
                        <Input
                          id="client-last-name"
                          value={editForm.last_name}
                          onChange={(event) =>
                            setEditForm({ ...editForm, last_name: event.target.value })
                          }
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="client-phone">Телефон *</Label>
                      <Input
                        id="client-phone"
                        type="tel"
                        value={editForm.phone}
                        onChange={(event) =>
                          setEditForm({ ...editForm, phone: event.target.value })
                        }
                        placeholder="7 700 000 00 00"
                      />
                      <p className="text-xs text-muted-foreground">
                        Новый номер используется в карточке и WhatsApp. Логин клиента пока остаётся прежним.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="client-email">Email</Label>
                      <Input
                        id="client-email"
                        type="email"
                        value={editForm.email}
                        onChange={(event) =>
                          setEditForm({ ...editForm, email: event.target.value })
                        }
                        placeholder="client@example.com"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsEditModalOpen(false)}
                        disabled={updateClientMutation.isPending}
                      >
                        Отмена
                      </Button>
                      <Button
                        type="button"
                        onClick={() => updateClientMutation.mutate()}
                        disabled={updateClientMutation.isPending}
                      >
                        {updateClientMutation.isPending ? "Сохранение..." : "Сохранить"}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
              <Dialog open={isSellModalOpen} onOpenChange={setIsSellModalOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="shrink-0">
                    <CreditCard className="mr-2 h-4 w-4" />
                    Продать
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Продажа абонемента</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Выберите тариф</Label>
                      <Select onValueChange={setSelectedPlanId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Тарифный план" />
                        </SelectTrigger>
                        <SelectContent>
                          {plans.map((plan: any) => (
                            <SelectItem key={plan.id} value={plan.id}>
                              {plan.name} - {plan.price} ₸ ({plan.visits_count} занятий)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button 
                      className="w-full" 
                      onClick={() => sellMutation.mutate()}
                      disabled={!selectedPlanId || sellMutation.isPending}
                    >
                      {sellMutation.isPending ? "Обработка..." : "Оформить"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
              </div>
              </div>
            </CardContent>
          </Card>

          {/* Табы с информацией */}
          <Tabs defaultValue="history">
            <TabsList>
              <TabsTrigger value="history">История посещений</TabsTrigger>
              <TabsTrigger value="subscriptions">Абонементы</TabsTrigger>
              <TabsTrigger value="notes">Заметки</TabsTrigger>
            </TabsList>
            
            <TabsContent value="history" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>История посещений</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {transferEvents.length > 0 ? (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><CalendarSync className="h-4 w-4" /> История перезаписей</div>
                        <div className="space-y-2">
                          {transferEvents.map((event: any) => (
                            <div key={event.id} className="text-xs text-slate-600">
                              <span className="font-medium">{format(parseISO(event.changed_at), 'dd.MM.yyyy HH:mm')}</span>{' · '}
                              {event.from_session ? `${format(parseISO(event.from_session.start_time), 'dd.MM HH:mm')} ${event.from_session.class_type?.name || ''}` : 'Исходное занятие'}
                              {' → '}
                              {event.to_session ? `${format(parseISO(event.to_session.start_time), 'dd.MM HH:mm')} ${event.to_session.class_type?.name || ''}` : 'Новое занятие'}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {bookings.map((booking: any) => {
                      const transfer = transferNotes.get(booking.id);
                      return (
                      <div key={booking.id} className="flex justify-between items-start gap-4 border-b pb-4 last:border-0 last:pb-0">
                        <div>
                          <div className="font-medium">{booking.session?.class_type?.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {format(parseISO(booking.session?.start_time), 'dd MMMM yyyy HH:mm', { locale: ru })}
                          </div>
                          {transfer ? (
                            <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                              <CalendarSync className="h-3.5 w-3.5" />
                              {transfer.direction === 'from' ? 'Перезаписан на' : 'Перезапись с'}{' '}
                              {transfer.other?.session ? `${format(parseISO(transfer.other.session.start_time), 'dd.MM.yyyy HH:mm')} · ${transfer.other.session.class_type?.name || 'занятие'}` : 'другого занятия'}
                            </div>
                          ) : null}
                        </div>
                        <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                          booking.status === 'completed' ? 'bg-green-100 text-green-700' :
                          booking.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                          booking.status === 'absent' ? 'bg-orange-100 text-orange-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {booking.status === 'completed' ? 'Посетил' :
                           transfer?.direction === 'from' ? 'Перенесён' :
                           booking.status === 'cancelled' ? 'Отмена' :
                           booking.status === 'absent' ? 'Не пришёл' : 'Записан'}
                        </div>
                      </div>
                    )})}
                    {bookings.length === 0 && <div className="text-center text-muted-foreground">Нет истории посещений</div>}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="subscriptions" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>История абонементов</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {subscriptions.map((sub: any) => (
                      <div key={sub.id} className="flex justify-between items-center border-b pb-4 last:border-0 last:pb-0">
                        <div>
                          <div className="font-medium">{sub.plan?.name}</div>
                          <div className="text-sm text-muted-foreground">
                            Осталось: {sub.visits_remaining} из {sub.visits_total}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-sm ${sub.is_active ? 'text-green-600' : 'text-gray-500'}`}>
                            {sub.is_active ? 'Активен' : 'Завершен'}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {sub.end_date ? `до ${format(parseISO(sub.end_date), 'dd.MM.yyyy')}` : 'не активирован'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Сайдбар со статистикой */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Статистика</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Баланс</span>
                <span className="font-bold text-lg">{client?.balance || 0} ₸</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Посещений</span>
                <span className="font-bold">{bookings.filter((b:any) => b.status === 'completed').length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Отмен</span>
                <span className="font-bold text-red-500">{bookings.filter((b:any) => b.status === 'cancelled').length}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
