import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { format, isFuture, isPast, parseISO } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoreHorizontal, Search, UserPlus, FileSpreadsheet, MessageCircle, Pencil, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import * as XLSX from 'xlsx';
import { toast } from "sonner";

type SubStatus = 'active' | 'expired' | 'none';

export default function Clients() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Edit subscription dialog
  const [editSub, setEditSub] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>({});

  const { data: clients = [], isLoading, error: clientsError } = useQuery({
    queryKey: ['clients_with_subs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select(`
            *,
            last_sub:user_subscriptions!user_subscriptions_user_id_fkey(
                id,
                end_date,
                activation_date,
                is_active,
                visits_remaining,
                visits_total,
                plan:subscription_plans(name)
            )
        `)
        .eq('role', 'client')
        .order('created_at', { ascending: false });

      if (error) throw error;

      return data.map((client: any) => {
        const sortedSubs = client.last_sub?.sort((a: any, b: any) =>
          new Date(b.end_date || '9999').getTime() - new Date(a.end_date || '9999').getTime()
        );
        const lastSub = sortedSubs?.[0];
        return { ...client, lastSub };
      });
    }
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      const visits = parseInt(editForm.visits_remaining);
      if (isNaN(visits) || visits < 0) throw new Error("Остаток не может быть отрицательным");
      const { data, error } = await supabase.from('user_subscriptions').update({
        visits_remaining: visits,
        activation_date: editForm.activation_date || null,
        end_date: editForm.end_date || null,
        is_active: editForm.is_active,
      }).eq('id', editForm.id).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Нет прав на изменение. Проверьте RLS политику в Supabase.");
    },
    onSuccess: () => {
      toast.success("Абонемент обновлён");
      setEditSub(null);
      queryClient.invalidateQueries({ queryKey: ['clients_with_subs'] });
    },
    onError: (err: any) => toast.error("Ошибка: " + err.message),
  });

  const handleOpenEdit = (sub: any) => {
    setEditSub(sub);
    setEditForm({
      id: sub.id,
      visits_remaining: sub.visits_remaining ?? 0,
      activation_date: sub.activation_date ? format(parseISO(sub.activation_date), 'yyyy-MM-dd') : "",
      end_date: sub.end_date ? format(parseISO(sub.end_date), 'yyyy-MM-dd') : "",
      is_active: sub.is_active ?? true,
    });
  };

  const getClientStatus = (client: any): SubStatus => {
    const sub = client.lastSub;
    if (!sub) return 'none';
    const endDate = sub.end_date ? parseISO(sub.end_date) : null;
    if (!sub.is_active) return 'expired';
    if (endDate && isPast(endDate) && !isFuture(endDate)) return 'expired';
    if (sub.visits_remaining === 0) return 'expired';
    return 'active';
  };

  const filteredClients = clients.filter((client: any) => {
    const searchString = searchTerm.toLowerCase();
    const fullName = `${client.first_name || ''} ${client.last_name || ''}`.toLowerCase();
    const phone = client.phone || '';
    const matchesSearch = fullName.includes(searchString) || phone.includes(searchString);

    let matchesStatus = true;
    const currentStatus = getClientStatus(client);
    if (statusFilter !== 'all') {
      if (statusFilter === 'active' && currentStatus !== 'active') matchesStatus = false;
      if (statusFilter === 'expired' && currentStatus !== 'expired') matchesStatus = false;
      if (statusFilter === 'none' && currentStatus !== 'none') matchesStatus = false;
    }
    return matchesSearch && matchesStatus;
  });

  const sendPaymentReminder = (client: any) => {
    if (!client.phone) { toast.error("У клиента не указан телефон"); return; }
    const phone = client.phone.replace(/\D/g, '');
    const text = `Здравствуйте, ${client.first_name}! 👋\nНапоминаем, что срок действия вашего абонемента подходит к концу (или закончился).\nБудем рады видеть вас снова на тренировках! 🧘‍♀️💳`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
  };

  const exportToExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filteredClients.map((c: any) => {
      const status = getClientStatus(c);
      const statusText = status === 'active' ? 'Активен' : status === 'expired' ? 'Истек' : 'Нет абонемента';
      return {
        'Имя': c.first_name,
        'Фамилия': c.last_name,
        'Телефон': c.phone,
        'Email': c.email,
        'Статус абонемента': statusText,
        'Окончание': c.lastSub?.end_date ? format(parseISO(c.lastSub.end_date), 'dd.MM.yyyy') : '-',
        'Баланс': c.balance,
        'Дата регистрации': format(new Date(c.created_at), 'dd.MM.yyyy')
      };
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Клиенты");
    XLSX.writeFile(wb, `clients_export_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  return (
    <div className="space-y-4 animate-in fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Клиенты</h1>
          <p className="text-xs text-muted-foreground">Управление базой клиентов</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {/* Экспорт — только на десктопе */}
          <Button variant="outline" size="sm" className="hidden sm:flex" onClick={exportToExcel}>
            <FileSpreadsheet className="h-4 w-4 mr-2" /> Экспорт
          </Button>

          {/* Пробные — только на десктопе */}
          <Button variant="outline" size="sm" className="hidden sm:flex" onClick={() => navigate('/trials')}>
            Пробные
          </Button>

          {/* Новый клиент — на мобильном большая, на десктопе обычная */}
          <Button size="sm" className="sm:hidden h-10 px-4 text-sm font-semibold" onClick={() => navigate('/admin/new-client')}>
            <UserPlus className="h-4 w-4 mr-2" /> Новый клиент
          </Button>
          <Button size="sm" className="hidden sm:flex" onClick={() => navigate('/admin/new-client')}>
            <UserPlus className="h-4 w-4 mr-2" /> Новый клиент
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center bg-card p-3 rounded-lg border shadow-sm">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по имени или телефону..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px] h-9">
            <SelectValue placeholder="Статус абонемента" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="active">Активные</SelectItem>
            <SelectItem value="expired">Истекшие</SelectItem>
            <SelectItem value="none">Без абонемента</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* MOBILE CARDS */}
      <div className="md:hidden space-y-2">
        {clientsError ? (
          <div className="text-center py-8 text-destructive text-sm">
            Не удалось загрузить клиентов. Обновите страницу или повторите позже.
          </div>
        ) : isLoading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Загрузка...</div>
        ) : filteredClients.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Клиенты не найдены</div>
        ) : filteredClients.map((client: any) => {
          const status = getClientStatus(client);
          const sub = client.lastSub;
          return (
            <div
              key={client.id}
              className="bg-white border border-gray-100 rounded-xl shadow-sm"
            >
              {/* Clickable main area */}
              <div
                className="p-3 active:bg-gray-50 transition-colors cursor-pointer"
                onClick={() => navigate(`/clients/${client.id}`)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm leading-tight">{client.first_name} {client.last_name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{client.phone}</p>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                    status === 'active' ? 'bg-green-100 text-green-700' :
                    status === 'expired' ? 'bg-red-100 text-red-700' :
                    'bg-gray-100 text-gray-500'
                  }`}>
                    {status === 'active' ? 'Активен' : status === 'expired' ? 'Истёк' : 'Нет'}
                  </span>
                </div>
                {sub && (
                  <div className="mt-1.5 text-xs text-gray-400 flex items-center justify-between">
                    <span>{sub.plan?.name || '—'}</span>
                    <div className="flex items-center gap-2">
                      {sub.end_date && (
                        <span>до {format(parseISO(sub.end_date), 'dd.MM.yy')}</span>
                      )}
                      {sub.visits_total != null && (
                        <span className={`font-semibold ${status === 'active' ? 'text-green-600' : 'text-gray-400'}`}>
                          {sub.visits_remaining}/{sub.visits_total} зан.
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Action buttons row */}
              <div className="border-t border-gray-50 px-3 py-2 flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-green-600 flex-1 gap-1"
                  onClick={() => sendPaymentReminder(client)}
                >
                  <MessageCircle className="w-3.5 h-3.5" /> WA
                </Button>
                {sub && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-blue-600 flex-1 gap-1"
                    onClick={() => handleOpenEdit(sub)}
                  >
                    <Pencil className="w-3.5 h-3.5" /> Абонемент
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs flex-1"
                  onClick={() => navigate(`/clients/${client.id}`)}
                >
                  Профиль →
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* DESKTOP TABLE */}
      <div className="hidden md:block border rounded-lg bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Клиент</TableHead>
              <TableHead>Телефон</TableHead>
              <TableHead>Абонемент</TableHead>
              <TableHead>Истекает</TableHead>
              <TableHead>Баланс</TableHead>
              <TableHead className="text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clientsError ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-destructive">
                  Не удалось загрузить клиентов. Обновите страницу или повторите позже.
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">Загрузка...</TableCell>
              </TableRow>
            ) : filteredClients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">Клиенты не найдены</TableCell>
              </TableRow>
            ) : (
              filteredClients.map((client: any) => {
                const status = getClientStatus(client);
                return (
                  <TableRow
                    key={client.id}
                    className="hover:bg-muted/50 cursor-pointer"
                    onClick={() => navigate(`/clients/${client.id}`)}
                  >
                    <TableCell>
                      <div className="font-medium">{client.first_name} {client.last_name}</div>
                      <div className="text-sm text-muted-foreground">{client.email}</div>
                    </TableCell>
                    <TableCell>{client.phone}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        status === 'active' ? 'bg-green-100 text-green-700' :
                        status === 'expired' ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {status === 'active' ? 'Активен' : status === 'expired' ? 'Истек' : 'Нет'}
                      </span>
                    </TableCell>
                    <TableCell>
                      {client.lastSub ? (
                        <span className={status === 'expired' ? 'text-red-500 text-sm' : 'text-sm'}>
                          {client.lastSub.end_date
                            ? format(parseISO(client.lastSub.end_date), 'dd.MM.yyyy')
                            : <span className="text-blue-500 text-xs">не активирован</span>}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell>{client.balance != null ? `${client.balance} ₸` : '—'}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Действия</DropdownMenuLabel>
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); sendPaymentReminder(client); }}>
                            <MessageCircle className="mr-2 h-4 w-4 text-green-600" />
                            Напомнить об оплате
                          </DropdownMenuItem>
                          {client.lastSub && (
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleOpenEdit(client.lastSub); }}>
                              <Pencil className="mr-2 h-4 w-4 text-blue-500" />
                              Редактировать абонемент
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigate(`/clients/${client.id}`); }}>
                            Профиль клиента
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit subscription dialog */}
      <Dialog open={!!editSub} onOpenChange={(open) => { if (!open) setEditSub(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактировать абонемент</DialogTitle>
            {editSub?.plan?.name && (
              <p className="text-sm text-muted-foreground">{editSub.plan.name}</p>
            )}
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Остаток занятий</Label>
              <Input
                type="number"
                min="0"
                value={editForm.visits_remaining ?? ''}
                onChange={(e) => setEditForm({ ...editForm, visits_remaining: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Дата активации{" "}
                <span className="text-muted-foreground font-normal text-xs">(пусто = не активирован)</span>
              </Label>
              <Input
                type="date"
                value={editForm.activation_date}
                onChange={(e) => setEditForm({ ...editForm, activation_date: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Дата окончания{" "}
                <span className="text-muted-foreground font-normal text-xs">(пусто = не рассчитана)</span>
              </Label>
              <Input
                type="date"
                value={editForm.end_date}
                onChange={(e) => setEditForm({ ...editForm, end_date: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active_clients"
                checked={editForm.is_active ?? true}
                onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
                className="h-4 w-4"
              />
              <Label htmlFor="is_active_clients">Абонемент активен</Label>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => editMutation.mutate()} disabled={editMutation.isPending}>
              {editMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
