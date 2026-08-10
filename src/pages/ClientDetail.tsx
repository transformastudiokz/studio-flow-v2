import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, User, Phone, Mail, Calendar, CreditCard, History, Edit, Trash2, CalendarSync, ChevronRight, Loader2, KeyRound, Copy, MessageCircle, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { addDays, format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { getSubscriptionState, subscriptionStateLabel } from "@/lib/subscription-state";

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSellModalOpen, setIsSellModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAccessModalOpen, setIsAccessModalOpen] = useState(false);
  const [accessData, setAccessData] = useState<null | { firstName: string; login: string; phone: string; temporaryPassword: string; portalUrl: string }>(null);
  const [accessCopied, setAccessCopied] = useState(false);
  const [selectedSubscription, setSelectedSubscription] = useState<any>(null);
  const [subscriptionForm, setSubscriptionForm] = useState({
    sale_date: "",
    activation_date: "",
    end_date: "",
    visits_total: "0",
    visits_remaining: "0",
    is_active: "false",
    reason: "",
  });
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [saleDate, setSaleDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
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
        .select('*, plan:subscription_plans(name,price,duration_days)')
        .eq('user_id', id)
        .order('end_date', { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  const { data: subscriptionSales = [] } = useQuery({
    queryKey: ['client_subscription_sales', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cash_transactions')
        .select('subscription_id,occurred_at,amount')
        .eq('client_id', id)
        .eq('operation_type', 'sale')
        .order('occurred_at', { ascending: true });
      if (error) throw error;
      return data || [];
    }
  });

  const { data: subscriptionAdjustments = [] } = useQuery({
    queryKey: ['subscription_adjustments', selectedSubscription?.id],
    enabled: Boolean(selectedSubscription?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscription_adjustment_log')
        .select('id,changed_at,reason,old_data,new_data')
        .eq('subscription_id', selectedSubscription.id)
        .order('changed_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
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

  const accessMessage = accessData
    ? [
        `Здравствуйте, ${accessData.firstName || client?.first_name || ""}!`,
        "",
        "Для вас открыт доступ в личный кабинет Balance Studio.",
        "",
        "Ссылка для входа:",
        accessData.portalUrl,
        "",
        "Логин:",
        accessData.login,
        "",
        "Временный пароль:",
        accessData.temporaryPassword,
      ].join("\n")
    : "";

  const resetAccessMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ action: "reset-client-access", clientId: id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось сформировать доступ");
      return result;
    },
    onSuccess: (result) => {
      setAccessData(result);
      setAccessCopied(false);
      toast({ title: "Доступ сформирован", description: "Теперь можно отправить сообщение в WhatsApp" });
    },
    onError: (error: any) => toast({ title: "Не удалось сформировать доступ", description: error.message, variant: "destructive" }),
  });

  const copyAccessMessage = async () => {
    await navigator.clipboard.writeText(accessMessage);
    setAccessCopied(true);
    window.setTimeout(() => setAccessCopied(false), 1800);
  };

  const openAccessWhatsApp = () => {
    if (!accessData) return;
    window.open(`https://wa.me/${accessData.phone}?text=${encodeURIComponent(accessMessage)}`, "_blank", "noopener,noreferrer");
  };

  const openSubscription = (subscription: any) => {
    const sale = subscriptionSales.find((item: any) => item.subscription_id === subscription.id);
    setSelectedSubscription(subscription);
    setSubscriptionForm({
      sale_date: subscription.start_date
        ? format(parseISO(subscription.start_date), "yyyy-MM-dd")
        : sale?.occurred_at
          ? format(parseISO(sale.occurred_at), "yyyy-MM-dd")
          : format(parseISO(subscription.created_at), "yyyy-MM-dd"),
      activation_date: subscription.activation_date ? format(parseISO(subscription.activation_date), "yyyy-MM-dd") : "",
      end_date: subscription.end_date ? format(parseISO(subscription.end_date), "yyyy-MM-dd") : "",
      visits_total: String(subscription.visits_total ?? 0),
      visits_remaining: String(subscription.visits_remaining ?? 0),
      is_active: subscription.is_active ? "true" : "false",
      reason: "",
    });
  };

  const handleActivationDateChange = (activationDate: string) => {
    const durationDays = Number(selectedSubscription?.plan?.duration_days || 0);
    setSubscriptionForm({
      ...subscriptionForm,
      activation_date: activationDate,
      end_date: activationDate && durationDays > 0
        ? format(addDays(parseISO(activationDate), durationDays - 1), "yyyy-MM-dd")
        : subscriptionForm.end_date,
    });
  };

  const updateSubscriptionMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({
          action: "update-subscription",
          subscriptionId: selectedSubscription?.id,
          saleDate: subscriptionForm.sale_date,
          activationDate: subscriptionForm.activation_date || null,
          endDate: subscriptionForm.end_date || null,
          visitsTotal: Number(subscriptionForm.visits_total),
          visitsRemaining: Number(subscriptionForm.visits_remaining),
          isActive: subscriptionForm.is_active === "true",
          reason: subscriptionForm.reason.trim(),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось обновить абонемент");
      return result;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["client_subscriptions", id] });
      await queryClient.invalidateQueries({ queryKey: ["clients_with_subs"] });
      await queryClient.invalidateQueries({ queryKey: ["user_subscriptions_full"] });
      await queryClient.invalidateQueries({ queryKey: ["subscription_adjustments"] });
      await queryClient.invalidateQueries({ queryKey: ["client_subscription_sales", id] });
      setSelectedSubscription(null);
      toast({ title: "Абонемент обновлён", description: "Количество, срок и статус синхронизированы" });
    },
    onError: (error: any) => toast({ title: "Не удалось сохранить", description: error.message, variant: "destructive" }),
  });

  // Продажа абонемента
  const sellMutation = useMutation({
    mutationFn: async () => {
      const plan = plans.find((p: any) => p.id === selectedPlanId);
      if (!plan) throw new Error("План не найден");

      const { error } = await supabase.from('user_subscriptions').insert({
        user_id: id,
        plan_id: plan.id,
        visits_remaining: plan.visits_count,
        visits_total: plan.visits_count,
        start_date: saleDate,
        activation_date: null,
        end_date: null,
        is_active: true
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client_subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['cash-transactions'] });
      setIsSellModalOpen(false);
      setSelectedPlanId("");
      setSaleDate(format(new Date(), "yyyy-MM-dd"));
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
              <Dialog open={isAccessModalOpen} onOpenChange={(open) => { setIsAccessModalOpen(open); if (!open) setAccessData(null); }}>
                <Button size="sm" variant="outline" onClick={() => setIsAccessModalOpen(true)} disabled={!client?.phone}>
                  <KeyRound className="mr-2 h-4 w-4" />
                  Доступ в ЛК
                </Button>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Доступ в личный кабинет</DialogTitle>
                    <DialogDescription>
                      {accessData
                        ? "Проверь сообщение и отправь его клиенту."
                        : "Будет создан новый временный пароль. Прежний пароль клиента перестанет работать."}
                    </DialogDescription>
                  </DialogHeader>
                  {accessData ? (
                    <div className="space-y-4">
                      <div className="whitespace-pre-wrap rounded-xl border bg-muted/35 p-4 text-sm leading-relaxed">{accessMessage}</div>
                      <DialogFooter className="gap-2 sm:justify-between">
                        <Button variant="outline" onClick={copyAccessMessage}>
                          {accessCopied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                          {accessCopied ? "Скопировано" : "Скопировать"}
                        </Button>
                        <Button onClick={openAccessWhatsApp}>
                          <MessageCircle className="mr-2 h-4 w-4" />
                          Открыть WhatsApp
                        </Button>
                      </DialogFooter>
                    </div>
                  ) : (
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsAccessModalOpen(false)} disabled={resetAccessMutation.isPending}>Отмена</Button>
                      <Button onClick={() => resetAccessMutation.mutate()} disabled={resetAccessMutation.isPending}>
                        {resetAccessMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                        {resetAccessMutation.isPending ? "Формируем…" : "Сформировать доступ"}
                      </Button>
                    </DialogFooter>
                  )}
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
                    <div className="space-y-2">
                      <Label htmlFor="client-subscription-sale-date">Дата продажи</Label>
                      <Input
                        id="client-subscription-sale-date"
                        type="date"
                        value={saleDate}
                        onChange={(event) => setSaleDate(event.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Абонемент и поступление в кассе будут отражены этой датой.
                      </p>
                    </div>
                    <Button 
                      className="w-full" 
                      onClick={() => sellMutation.mutate()}
                      disabled={!selectedPlanId || !saleDate || sellMutation.isPending}
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
                  <div className="divide-y">
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
                      <div key={booking.id} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                        <div>
                          <div className="text-sm font-medium">{booking.session?.class_type?.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {format(parseISO(booking.session?.start_time), 'dd MMM yyyy · HH:mm', { locale: ru })}
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
                  <div className="divide-y">
                    {subscriptions.map((sub: any) => {
                      const state = getSubscriptionState(sub);
                      const sale = subscriptionSales.find((item: any) => item.subscription_id === sub.id);
                      const price = sale?.amount ?? sub.plan?.price;
                      return (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => openSubscription(sub)}
                        className="flex w-full flex-wrap items-center justify-between gap-3 py-3 text-left transition-colors first:pt-0 last:pb-0 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <div>
                          <div className="font-medium">{sub.plan?.name}</div>
                          <div className="mt-0.5 text-sm text-muted-foreground">
                            Осталось {sub.visits_remaining} из {sub.visits_total} · {Number(price || 0).toLocaleString('ru-RU')} ₸
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            Куплен {sub.start_date ? format(parseISO(sub.start_date), 'dd.MM.yyyy') : sale?.occurred_at ? format(parseISO(sale.occurred_at), 'dd.MM.yyyy') : format(parseISO(sub.created_at), 'dd.MM.yyyy')}
                            {' · '}Активирован {sub.activation_date ? format(parseISO(sub.activation_date), 'dd.MM.yyyy') : 'не активирован'}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-right">
                          <div>
                          <div className={`text-sm font-medium ${state === 'active' ? 'text-green-600' : state === 'purchased' ? 'text-blue-600' : 'text-gray-500'}`}>
                            {subscriptionStateLabel[state]}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {sub.end_date ? `до ${format(parseISO(sub.end_date), 'dd.MM.yyyy')} включительно` : 'срок начнётся при активации'}
                          </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </button>
                    )})}
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

      <Dialog open={Boolean(selectedSubscription)} onOpenChange={(open) => !open && setSelectedSubscription(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedSubscription?.plan?.name || "Абонемент"}</DialogTitle>
            <DialogDescription>
              Скорректируй остаток, срок или статус. История посещений не удаляется, а изменение сохранится в журнале.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="subscription-visits-total">Всего занятий</Label>
                <Input
                  id="subscription-visits-total"
                  type="number"
                  min="0"
                  step="1"
                  value={subscriptionForm.visits_total}
                  onChange={(event) => setSubscriptionForm({ ...subscriptionForm, visits_total: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="subscription-visits-remaining">Осталось</Label>
                <Input
                  id="subscription-visits-remaining"
                  type="number"
                  min="0"
                  max={subscriptionForm.visits_total || undefined}
                  step="1"
                  value={subscriptionForm.visits_remaining}
                  onChange={(event) => setSubscriptionForm({ ...subscriptionForm, visits_remaining: event.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="subscription-active">Статус</Label>
              <Select value={subscriptionForm.is_active} onValueChange={(value) => setSubscriptionForm({ ...subscriptionForm, is_active: value })}>
                <SelectTrigger id="subscription-active"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Активен</SelectItem>
                  <SelectItem value="false">Неактивен</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Для активации должен быть положительный остаток и неистёкший срок.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="subscription-sale-date">Дата продажи</Label>
              <Input id="subscription-sale-date" type="date" value={subscriptionForm.sale_date} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, sale_date: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subscription-activation-date">Дата активации</Label>
              <Input id="subscription-activation-date" type="date" value={subscriptionForm.activation_date} onChange={(event) => handleActivationDateChange(event.target.value)} />
              <p className="text-xs text-muted-foreground">Можно оставить пустой, если клиент ещё не начал пользоваться абонементом.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="subscription-end-date">Действует включительно до</Label>
              <Input id="subscription-end-date" type="date" value={subscriptionForm.end_date} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, end_date: event.target.value })} />
              <p className="text-xs text-muted-foreground">Для уважительного переноса укажи новую крайнюю дату вручную.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="subscription-adjustment-reason">Причина корректировки</Label>
              <Textarea
                id="subscription-adjustment-reason"
                value={subscriptionForm.reason}
                onChange={(event) => setSubscriptionForm({ ...subscriptionForm, reason: event.target.value })}
                placeholder="Например: разрешён повторный перенос пробного занятия"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">Обязательное поле. Причина останется в журнале изменений.</p>
            </div>
            {subscriptionAdjustments.length > 0 && (
              <div className="rounded-lg border bg-muted/25 p-3">
                <div className="mb-2 text-sm font-medium">Последние корректировки</div>
                <div className="max-h-32 space-y-2 overflow-y-auto">
                  {subscriptionAdjustments.map((entry: any) => (
                    <div key={entry.id} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{format(parseISO(entry.changed_at), "dd.MM.yyyy HH:mm")}</span>
                      {" · "}{entry.reason}
                      {entry.old_data?.visits_remaining !== entry.new_data?.visits_remaining && (
                        <span>{` · остаток ${entry.old_data?.visits_remaining} → ${entry.new_data?.visits_remaining}`}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedSubscription(null)} disabled={updateSubscriptionMutation.isPending}>Отмена</Button>
            <Button
              onClick={() => updateSubscriptionMutation.mutate()}
              disabled={
                !subscriptionForm.sale_date ||
                subscriptionForm.reason.trim().length < 3 ||
                !Number.isInteger(Number(subscriptionForm.visits_total)) ||
                !Number.isInteger(Number(subscriptionForm.visits_remaining)) ||
                Number(subscriptionForm.visits_remaining) < 0 ||
                Number(subscriptionForm.visits_remaining) > Number(subscriptionForm.visits_total) ||
                updateSubscriptionMutation.isPending
              }
            >
              {updateSubscriptionMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
