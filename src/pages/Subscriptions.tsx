import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Plus, Loader2, Pencil, Trash2, X, Check, ChevronsUpDown, Calendar as CalendarIcon, Search, FileSpreadsheet } from "lucide-react";
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/ui/data-table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, parseISO, addDays, differenceInDays, isPast, isToday, isFuture, isValid } from "date-fns";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const Subscriptions = () => {
  const queryClient = useQueryClient();
  const [isSellDialogOpen, setIsSellDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [openClientSelect, setOpenClientSelect] = useState(false);

  // --- ФИЛЬТРЫ ---
  const [filterClient, setFilterClient] = useState("");
  const [filterPlan, setFilterPlan] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  // --- СОСТОЯНИЯ ФОРМ ---
  const [sellForm, setSellForm] = useState({ 
    user_id: "", 
    plan_id: "", 
    sale_date: format(new Date(), 'yyyy-MM-dd'),
    agreed_price: "",
    initial_payment: "",
    payment_method: "kaspi",
  });
  
  const [editForm, setEditForm] = useState<any>({});

  // 1. Получаем список абонементов
  const { data: subscriptions = [], isLoading } = useQuery({
    queryKey: ['user_subscriptions_full'],
    queryFn: async () => {
      // ИЗМЕНЕНИЕ: Убрали bookings(status), так как считаем остаток на бэкенде
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select(`
            *, 
            user:profiles(first_name, last_name, phone), 
            plan:subscription_plans(name, duration_days)
        `)
        .order('created_at', { ascending: false });
      
      if (error) throw error;

      // ИЗМЕНЕНИЕ: Просто возвращаем данные, visits_remaining теперь актуален в базе
      return data;
    }
  });

  // 2. Справочники
  const { data: clients = [] } = useQuery({
    queryKey: ['clients_lite'],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, phone')
        .eq('role', 'client')
        .order('first_name');
      return data || [];
    }
  });

  const { data: plans = [] } = useQuery({
    queryKey: ['plans_lite'],
    queryFn: async () => {
      const { data } = await supabase.from('subscription_plans').select('*').order('price');
      return data || [];
    }
  });

  // --- МУТАЦИИ ---
  
  // ПРОДАЖА АБОНЕМЕНТА
  const sellMutation = useMutation({
    mutationFn: async () => {
      if (!sellForm.user_id || !sellForm.plan_id) throw new Error("Выберите клиента и тариф");
      
      const selectedPlan = plans.find((p: any) => p.id === sellForm.plan_id);
      if (!selectedPlan) throw new Error("Тариф не найден");

      // start_date = выбранная дата продажи; эта же дата попадёт в кассу
      // activation_date = NULL (проставится автоматически при первом посещении)
      // end_date = NULL (рассчитается триггером при активации)
      const agreedPrice = Number(sellForm.agreed_price);
      const initialPayment = Number(sellForm.initial_payment);
      if (!Number.isFinite(agreedPrice) || agreedPrice < 0) throw new Error("Укажи стоимость");
      if (!Number.isFinite(initialPayment) || initialPayment < 0 || initialPayment > agreedPrice) throw new Error("Первый взнос должен быть от 0 до стоимости");
      const { error } = await supabase.rpc('sell_subscription_with_payment', {
        p_client_id: sellForm.user_id,
        p_plan_id: selectedPlan.id,
        p_sale_date: sellForm.sale_date,
        p_agreed_price: agreedPrice,
        p_initial_payment: initialPayment,
        p_payment_method: sellForm.payment_method,
        p_idempotency_key: crypto.randomUUID(),
      });
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Абонемент выдан");
      setIsSellDialogOpen(false);
      setSellForm({ user_id: "", plan_id: "", sale_date: format(new Date(), 'yyyy-MM-dd'), agreed_price: "", initial_payment: "", payment_method: "kaspi" });
      queryClient.invalidateQueries({ queryKey: ['user_subscriptions_full'] });
      queryClient.invalidateQueries({ queryKey: ['cash-transactions'] });
    },
    onError: (err: any) => toast.error("Ошибка: " + err.message)
  });

  // РЕДАКТИРОВАНИЕ
  const editMutation = useMutation({
    mutationFn: async () => {
      const visits = parseInt(editForm.visits_remaining);
      if (isNaN(visits) || visits < 0) throw new Error("Остаток занятий не может быть отрицательным");
      const { data, error } = await supabase.from('user_subscriptions').update({
            visits_remaining: visits,
            activation_date: editForm.activation_date || null,
            end_date: editForm.end_date || null,
            is_active: editForm.is_active
        }).eq('id', editForm.id).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Нет прав на изменение. Проверьте RLS политику в Supabase.");
    },
    onSuccess: () => {
      toast.success("Обновлено");
      setIsEditDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ['user_subscriptions_full'] });
    },
    onError: (err: any) => toast.error("Ошибка: " + err.message)
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('user_subscriptions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
        toast.success("Удалено");
        queryClient.invalidateQueries({ queryKey: ['user_subscriptions_full'] });
    }
  });

  // --- ЛОГИКА СТАТУСОВ ---
  const getSubscriptionStatus = (sub: any) => {
    if (!sub.is_active) return { label: "Архив", color: "bg-gray-200 text-gray-600", code: "finished" };

    if (sub.visits_total !== null && sub.visits_remaining <= 0) {
        return { label: "Закончился", color: "bg-gray-200 text-gray-600", code: "finished" };
    }

    // Не активирован — куплен, но ни разу не посещал
    if (!sub.activation_date) {
        return { label: "Куплен", color: "bg-blue-100 text-blue-800", code: "pending" };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (!sub.end_date) return { label: "Действует", color: "bg-green-100 text-green-800", code: "active" };

    const endDate = parseISO(sub.end_date);
    if (isPast(endDate) && !isToday(endDate)) return { label: "Истек", color: "bg-red-100 text-red-800", code: "expired" };

    const daysLeft = differenceInDays(endDate, today);
    if (daysLeft <= 3) return { label: "Истекает", color: "bg-red-100 text-red-800", code: "critical" };
    if (daysLeft <= 7) return { label: "Скоро истекает", color: "bg-orange-100 text-orange-800", code: "warning" };

    return { label: "Действует", color: "bg-green-100 text-green-800", code: "active" };
  };

  // --- ФИЛЬТРАЦИЯ ---
  const filteredSubs = subscriptions.filter((sub: any) => {
    const clientName = `${sub.user?.first_name} ${sub.user?.last_name}`.toLowerCase();
    if (!clientName.includes(filterClient.toLowerCase())) return false;
    if (filterPlan !== "all" && sub.plan_id !== filterPlan) return false;
    
    if (filterStatus !== "all") {
        const status = getSubscriptionStatus(sub);
        if (filterStatus === "active" && status.code !== "active") return false;
        if (filterStatus === "pending" && status.code !== "pending") return false;
        if (filterStatus === "warning" && (status.code !== "warning" && status.code !== "critical")) return false;
        if (filterStatus === "expired" && (status.code !== "expired" && status.code !== "finished")) return false;
    }
    return true;
  });

  const handleEdit = (sub: any) => {
    setEditForm({
        id: sub.id,
        visits_remaining: sub.visits_remaining,
        start_date: sub.start_date ? format(parseISO(sub.start_date), 'yyyy-MM-dd') : "",
        activation_date: sub.activation_date ? format(parseISO(sub.activation_date), 'yyyy-MM-dd') : "",
        end_date: sub.end_date ? format(parseISO(sub.end_date), 'yyyy-MM-dd') : "",
        is_active: sub.is_active
    });
    setIsEditDialogOpen(true);
  };

  const columns = [
    {
      accessorKey: "user",
      header: "Клиент",
      cell: ({ row }: any) => (
        <div>
            <div className="font-bold">{row.original.user?.first_name} {row.original.user?.last_name}</div>
            <div className="text-xs text-gray-500">{row.original.user?.phone}</div>
        </div>
      )
    },
    {
      accessorKey: "plan",
      header: "Тариф",
      cell: ({ row }: any) => <span className="font-medium">{row.original.plan?.name}</span>
    },
    {
      header: "Статус",
      accessorKey: "status_computed",
      cell: ({ row }: any) => {
        const status = getSubscriptionStatus(row.original);
        return <Badge className={`${status.color} border-0`}>{status.label}</Badge>;
      }
    },
    {
        header: "Куплен",
        cell: ({ row }: any) => (
            <div className="text-sm text-gray-500">
                {row.original.start_date ? format(parseISO(row.original.start_date), 'dd.MM.yy') : "-"}
            </div>
        )
    },
    {
        header: "Активирован",
        cell: ({ row }: any) => (
            <div className="text-sm">
                {row.original.activation_date
                    ? format(parseISO(row.original.activation_date), 'dd.MM.yy')
                    : <span className="text-blue-500 text-xs">не активирован</span>}
            </div>
        )
    },
    {
        header: "Окончание",
        cell: ({ row }: any) => {
            if (!row.original.end_date) return <span className="text-gray-400 text-xs">—</span>;
            const status = getSubscriptionStatus(row.original);
            let dateColor = "text-gray-900";
            if (status.code === "critical") dateColor = "text-red-600 font-bold";
            if (status.code === "expired") dateColor = "text-gray-400 line-through";
            return <div className={`text-sm ${dateColor}`}>{format(parseISO(row.original.end_date), 'dd.MM.yy')}</div>;
        }
    },
    {
      accessorKey: "visits",
      header: "Остаток",
      cell: ({ row }: any) => (
        <span className={row.original.visits_remaining === 0 ? "text-gray-400 font-bold" : "text-green-700 font-bold"}>
            {row.original.visits_remaining ?? "∞"} / {row.original.visits_total ?? "∞"}
        </span>
      )
    },
    {
      id: "actions",
      cell: ({ row }: any) => (
        <div className="flex items-center gap-2 justify-end">
            <Button size="icon" variant="ghost" className="h-8 w-8 text-blue-500" onClick={() => handleEdit(row.original)}>
                <Pencil className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-red-400" disabled={deleteMutation.isPending} onClick={() => { if (confirm("Удалить абонемент?")) deleteMutation.mutate(row.original.id); }}>
                <Trash2 className="w-4 h-4" />
            </Button>
        </div>
      )
    }
  ];

  const exportToExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filteredSubs.map((sub: any) => {
      const status = getSubscriptionStatus(sub);
      return {
        'Клиент': `${sub.user?.first_name || ''} ${sub.user?.last_name || ''}`.trim(),
        'Телефон': sub.user?.phone || '',
        'Тариф': sub.plan?.name || '',
        'Статус': status.label,
        'Куплен': sub.start_date ? format(parseISO(sub.start_date), 'dd.MM.yyyy') : '',
        'Активирован': sub.activation_date ? format(parseISO(sub.activation_date), 'dd.MM.yyyy') : 'не активирован',
        'Окончание': sub.end_date ? format(parseISO(sub.end_date), 'dd.MM.yyyy') : '—',
        'Остаток занятий': sub.visits_remaining ?? '∞',
        'Всего занятий': sub.visits_total ?? '∞',
      };
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Абонементы");
    XLSX.writeFile(wb, `subscriptions_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Журнал абонементов</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportToExcel}>
            <FileSpreadsheet className="mr-2 h-4 w-4" /> Экспорт
          </Button>
          <Dialog open={isSellDialogOpen} onOpenChange={setIsSellDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Выдать абонемент</Button>
          </DialogTrigger>
          <DialogContent className="overflow-visible"> 
            <DialogHeader>
                <DialogTitle>Новая продажа</DialogTitle>
                <DialogDescription>Выберите клиента, тариф и дату продажи.</DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
                
                {/* ПОИСК КЛИЕНТА */}
                <div className="space-y-2 flex flex-col">
                    <Label>Клиент</Label>
                    <Popover open={openClientSelect} onOpenChange={setOpenClientSelect}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={openClientSelect}
                          className="w-full justify-between"
                        >
                          {sellForm.user_id
                            ? (() => {
                                const c = clients.find((client: any) => client.id === sellForm.user_id);
                                return c ? `${c.first_name} ${c.last_name} (${c.phone})` : "Клиент не найден";
                              })()
                            : "Выберите клиента (поиск)..."}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                        <Command>
                          <CommandInput placeholder="Поиск по имени или телефону..." />
                          <CommandList>
                            <CommandEmpty>Клиент не найден.</CommandEmpty>
                            <CommandGroup>
                              {clients.map((client: any) => (
                                <CommandItem
                                  key={client.id}
                                  value={`${client.first_name} ${client.last_name} ${client.phone}`}
                                  onSelect={() => {
                                    setSellForm({ ...sellForm, user_id: client.id });
                                    setOpenClientSelect(false);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      sellForm.user_id === client.id ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  {client.first_name} {client.last_name} ({client.phone})
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                </div>

                {/* ВЫБОР ТАРИФА */}
                <div className="space-y-2">
                    <Label>Тариф</Label>
                    <Select onValueChange={(val) => { const plan = plans.find((item: any) => item.id === val); const price = String(Number(plan?.price || 0)); setSellForm({...sellForm, plan_id: val, agreed_price: price, initial_payment: price}); }}>
                        <SelectTrigger><SelectValue placeholder="Выберите тариф..." /></SelectTrigger>
                        <SelectContent>
                            {plans.map((p: any) => (
                                <SelectItem key={p.id} value={p.id}>{p.name} — {p.price} ₸ ({p.duration_days} дн.)</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label>Стоимость абонемента</Label><Input type="number" min="0" value={sellForm.agreed_price} onChange={e => setSellForm({...sellForm, agreed_price: e.target.value})} /></div>
                  <div className="space-y-2"><Label>Внесено сейчас</Label><Input type="number" min="0" max={sellForm.agreed_price || undefined} value={sellForm.initial_payment} onChange={e => setSellForm({...sellForm, initial_payment: e.target.value})} /></div>
                </div>
                <div className="space-y-2"><Label>Способ оплаты</Label><Select value={sellForm.payment_method} onValueChange={value => setSellForm({...sellForm, payment_method: value})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="kaspi">Kaspi</SelectItem><SelectItem value="halyk">Halyk</SelectItem><SelectItem value="cash">Наличные</SelectItem><SelectItem value="bank_account">Расчётный счёт</SelectItem></SelectContent></Select>{Number(sellForm.agreed_price || 0) > Number(sellForm.initial_payment || 0) ? <p className="text-sm font-medium text-amber-700">Долг: {(Number(sellForm.agreed_price || 0)-Number(sellForm.initial_payment || 0)).toLocaleString('ru-RU')} ₸</p> : null}</div>

                <div className="space-y-2">
                    <Label htmlFor="subscription-sale-date">Дата продажи</Label>
                    <Input
                      id="subscription-sale-date"
                      type="date"
                      value={sellForm.sale_date}
                      onChange={e => setSellForm({...sellForm, sale_date: e.target.value})}
                    />
                    <p className="text-xs text-muted-foreground">
                      Абонемент и поступление в кассе будут отражены этой датой. Срок начнётся при первом посещении.
                    </p>
                </div>
            </div>
            <DialogFooter>
                <Button onClick={() => sellMutation.mutate()} disabled={!sellForm.sale_date || !sellForm.plan_id || sellForm.agreed_price === "" || sellForm.initial_payment === "" || sellMutation.isPending}>
                    {sellMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Выдать
                </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* ФИЛЬТРЫ */}
      <div className="border rounded-lg p-4 bg-muted/20 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Фильтры</span>
          {(filterClient || filterPlan !== "all" || filterStatus !== "all") && (
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => {
              setFilterClient(""); setFilterPlan("all"); setFilterStatus("all");
            }}>
              Сбросить
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по клиенту"
              value={filterClient}
              onChange={e => setFilterClient(e.target.value)}
              className="h-8 text-sm pl-9"
            />
          </div>
          <select
            value={filterPlan}
            onChange={e => setFilterPlan(e.target.value)}
            className="h-8 text-sm border rounded-md px-2 bg-background"
          >
            <option value="all">Все тарифы</option>
            {plans.map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="h-8 text-sm border rounded-md px-2 bg-background"
          >
            <option value="all">Все статусы</option>
            <option value="active">Действует</option>
            <option value="pending">Ждет активации</option>
            <option value="warning">Скоро истекает</option>
            <option value="expired">Истек / Закончился</option>
          </select>
        </div>
        {(filterClient || filterPlan !== "all" || filterStatus !== "all") && (
          <p className="text-xs text-muted-foreground">Найдено: {filteredSubs.length} из {subscriptions.length}</p>
        )}
      </div>

      {/* MOBILE CARDS */}
      <div className="md:hidden space-y-3">
        {filteredSubs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Абонементов не найдено</div>
        ) : filteredSubs.map((sub: any) => {
          const status = getSubscriptionStatus(sub);
          return (
            <div key={sub.id} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-bold">{sub.user?.first_name} {sub.user?.last_name}</p>
                  <p className="text-xs text-gray-400">{sub.user?.phone}</p>
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full border-0 ${status.color}`}>{status.label}</span>
              </div>
              <div className="text-sm font-medium text-gray-700 mb-2">{sub.plan?.name}</div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>До: {sub.end_date ? format(parseISO(sub.end_date), 'dd.MM.yyyy') : '—'}</span>
                <span className={sub.visits_remaining === 0 ? "text-gray-400" : "text-green-700 font-semibold"}>
                  {sub.visits_remaining ?? "∞"} / {sub.visits_total ?? "∞"} занятий
                </span>
              </div>
              <div className="flex gap-2 mt-3">
                <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={() => handleEdit(sub)}>Изменить</Button>
                <Button size="sm" variant="ghost" className="h-8 text-xs text-red-400" disabled={deleteMutation.isPending} onClick={() => { if (confirm("Удалить абонемент?")) deleteMutation.mutate(sub.id); }}>Удалить</Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="hidden md:block overflow-x-auto bg-white rounded-lg border shadow-sm">
        <DataTable columns={columns} data={filteredSubs} emptyMessage="Абонементов не найдено" />
      </div>

      {/* РЕДАКТИРОВАНИЕ */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Редактирование абонемента</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
                <div className="space-y-2">
                    <Label>Остаток посещений</Label>
                    <Input type="number" min="0" value={editForm.visits_remaining} onChange={e => setEditForm({...editForm, visits_remaining: e.target.value})} />
                </div>
                <div className="space-y-2">
                    <Label className="text-muted-foreground text-xs">Дата покупки (не редактируется)</Label>
                    <Input type="date" value={editForm.start_date} disabled className="bg-gray-50 text-gray-500" />
                </div>
                <div className="space-y-2">
                    <Label>Дата активации <span className="text-muted-foreground font-normal">(пусто = не активирован)</span></Label>
                    <Input
                        type="date"
                        value={editForm.activation_date}
                        onChange={e => setEditForm({...editForm, activation_date: e.target.value})}
                    />
                </div>
                <div className="space-y-2">
                    <Label>Дата окончания <span className="text-muted-foreground font-normal">(пусто = не рассчитана)</span></Label>
                    <Input type="date" value={editForm.end_date} onChange={e => setEditForm({...editForm, end_date: e.target.value})} />
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        id="is_active_edit"
                        checked={editForm.is_active}
                        onChange={e => setEditForm({...editForm, is_active: e.target.checked})}
                        className="h-4 w-4"
                    />
                    <Label htmlFor="is_active_edit">Абонемент активен</Label>
                </div>
            </div>
            <DialogFooter>
                <Button onClick={() => editMutation.mutate()} disabled={editMutation.isPending}>
                    Сохранить изменения
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Subscriptions;
