import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/ui/data-table";
import { Plus, Loader2, Search, Trash2, Phone, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const Trials = () => {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<any>(null); 
  const [search, setSearch] = useState("");
  
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    notes: "",
    lead_status: "booked"
  });

  // 1. Получаем список из PROFILES
  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['trial_clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select(`*, subscriptions:user_subscriptions(id)`)
        .eq('role', 'client')
        .order('created_at', { ascending: false });
      
      if (error) throw error;

      // Показываем только тех, у кого НЕТ абонементов — это и есть пробные/лиды
      return data.filter((c: any) => !c.subscriptions || c.subscriptions.length === 0);
    }
  });

  // 2. Создание (Используем временный клиент)
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!formData.first_name || !formData.phone) throw new Error("Имя и телефон обязательны");
      
      const cleanPhone = formData.phone.replace(/\D/g, '');
      const fakeEmail = `${cleanPhone}@balance.local`;
      const password = `yoga${cleanPhone.slice(-4)}`;

      const tempSupabase = createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
          }
        }
      );

      const { data, error } = await tempSupabase.auth.signUp({
          email: fakeEmail, 
          password,
          options: {
              data: {
                  first_name: formData.first_name,
                  last_name: formData.last_name,
                  phone: formData.phone
              }
          }
      });

      if (error) throw error;
      
      if (data.user) {
          // ИСПРАВЛЕНИЕ: Увеличил задержку до 1000мс, чтобы база точно успела создать профиль
          await new Promise(resolve => setTimeout(resolve, 1000));

          await supabase.from('profiles').update({
              phone: formData.phone,
              first_name: formData.first_name,
              last_name: formData.last_name,
              notes: formData.notes,
              lead_status: formData.lead_status
          }).eq('id', data.user.id);
      }
    },
    onSuccess: () => {
      toast.success("Клиент создан без абонемента");
      closeDialog();
      queryClient.invalidateQueries({ queryKey: ['trial_clients'] });
    },
    onError: (err: any) => toast.error(err.message)
  });

  // 3. Обновление
  const updateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('profiles')
        .update({
            first_name: formData.first_name,
            last_name: formData.last_name,
            phone: formData.phone,
            notes: formData.notes,
            lead_status: formData.lead_status
        })
        .eq('id', editingClient.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Данные обновлены");
      closeDialog();
      queryClient.invalidateQueries({ queryKey: ['trial_clients'] });
    },
    onError: (err) => toast.error(err.message)
  });

  // 4. Быстрое обновление статуса
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string, status: string }) => {
        const { error } = await supabase.from('profiles').update({ lead_status: status }).eq('id', id);
        if (error) throw error;
    },
    onSuccess: () => {
        toast.success("Статус обновлен");
        queryClient.invalidateQueries({ queryKey: ['trial_clients'] });
    },
    onError: (err: any) => {
        toast.error("Ошибка: " + err.message);
    }
  });

  // 5. Удаление
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('profiles').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
        toast.success("Удалено");
        queryClient.invalidateQueries({ queryKey: ['trial_clients'] });
    }
  });

  const openCreateDialog = () => {
      setEditingClient(null);
      setFormData({ first_name: "", last_name: "", phone: "", notes: "", lead_status: "booked" });
      setIsDialogOpen(true);
  };

  const openEditDialog = (client: any) => {
      setEditingClient(client);
      setFormData({
          first_name: client.first_name,
          last_name: client.last_name || "",
          phone: client.phone,
          notes: client.notes || "",
          lead_status: client.lead_status || "booked"
      });
      setIsDialogOpen(true);
  };

  const closeDialog = () => {
      setIsDialogOpen(false);
      setEditingClient(null);
  };

  const filteredClients = clients.filter((c: any) => {
    const fullName = `${c.first_name} ${c.last_name} ${c.phone}`.toLowerCase();
    return fullName.includes(search.toLowerCase());
  });

  const columns = [
    {
      accessorKey: "full_name",
      header: "Имя Фамилия",
      cell: ({ row }: any) => (
        <div className="font-bold cursor-pointer hover:text-blue-600" onClick={() => openEditDialog(row.original)}>
            {row.original.first_name} {row.original.last_name}
        </div>
      )
    },
    {
      accessorKey: "phone",
      header: "Телефон",
      cell: ({ row }: any) => (
        <div className="flex items-center gap-2 text-gray-600">
            <Phone className="w-3 h-3" />
            {row.original.phone}
        </div>
      )
    },
    {
        accessorKey: "lead_status",
        header: "Статус",
        cell: ({ row }: any) => {
            const currentStatus = row.original.lead_status || 'booked';
            
            let bgClass = "bg-blue-50 text-blue-700 border-blue-200"; // booked
            
            if (currentStatus === 'attended') bgClass = "bg-purple-50 text-purple-700 border-purple-200"; // Пришел
            if (currentStatus === 'paid') bgClass = "bg-green-50 text-green-700 border-green-200"; // Оплатил
            if (currentStatus === 'active') bgClass = "bg-emerald-50 text-emerald-700 border-emerald-200"; // Активен
            if (currentStatus === 'inactive') bgClass = "bg-gray-100 text-gray-700 border-gray-300"; // Неактивен
            if (currentStatus === 'churned') bgClass = "bg-red-50 text-red-700 border-red-200"; // Отток

            return (
                <Select 
                    defaultValue={currentStatus} 
                    onValueChange={(val) => updateStatusMutation.mutate({ id: row.original.id, status: val })}
                >
                    <SelectTrigger className={`w-[140px] h-8 text-xs font-bold border ${bgClass}`}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="booked">Записан</SelectItem>
                        <SelectItem value="attended">Пришел</SelectItem>
                        <SelectItem value="paid">Оплатил</SelectItem>
                        <SelectItem value="active">Активен</SelectItem>
                        <SelectItem value="inactive">Неактивен</SelectItem>
                        <SelectItem value="churned">Отток</SelectItem>
                    </SelectContent>
                </Select>
            );
        }
    },
    {
      accessorKey: "notes",
      header: "Заметка",
      cell: ({ row }: any) => <div className="text-sm text-gray-500 truncate max-w-[150px]">{row.original.notes || "-"}</div>
    },
    {
      id: "actions",
      cell: ({ row }: any) => (
        <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" onClick={() => openEditDialog(row.original)} title="Редактировать">
                <Pencil className="w-4 h-4 text-gray-600" />
            </Button>
            <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-600" onClick={() => deleteMutation.mutate(row.original.id)} title="Удалить">
                <Trash2 className="w-4 h-4" />
            </Button>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-bold">Пробные / Лиды</h1>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <Button onClick={openCreateDialog}><Plus className="mr-2 h-4 w-4" /> Добавить</Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingClient ? "Редактирование" : "Новый лид"}</DialogTitle>
              <DialogDescription>
                {editingClient ? "Измените данные клиента." : "Клиент без абонемента."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Имя *</Label><Input value={formData.first_name} onChange={e => setFormData({...formData, first_name: e.target.value})} /></div>
                <div className="space-y-2"><Label>Фамилия</Label><Input value={formData.last_name} onChange={e => setFormData({...formData, last_name: e.target.value})} /></div>
              </div>
              <div className="space-y-2"><Label>Телефон *</Label><Input value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} placeholder="+7..." /></div>
              <div className="space-y-2">
                <Label>Статус</Label>
                <Select value={formData.lead_status} onValueChange={(val) => setFormData({...formData, lead_status: val})}>
                  <SelectTrigger><SelectValue placeholder="Выберите статус" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="booked">Записан</SelectItem>
                    <SelectItem value="attended">Пришел</SelectItem>
                    <SelectItem value="paid">Оплатил</SelectItem>
                    <SelectItem value="active">Активен</SelectItem>
                    <SelectItem value="inactive">Неактивен</SelectItem>
                    <SelectItem value="churned">Отток</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Заметки</Label><Input value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} /></div>
            </div>
            <DialogFooter>
              <Button onClick={() => editingClient ? updateMutation.mutate() : createMutation.mutate()} disabled={createMutation.isPending || updateMutation.isPending}>
                {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} 
                {editingClient ? "Сохранить" : "Создать без абонемента"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-2 bg-white p-2 rounded-md border w-full max-w-sm">
        <Search className="w-4 h-4 text-gray-400" />
        <Input className="border-none shadow-none focus-visible:ring-0" placeholder="Поиск..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? <Loader2 className="animate-spin" /> : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {filteredClients.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">Лидов нет</p>
            ) : filteredClients.map((c: any) => {
              const status = c.lead_status || 'booked';
              let badgeClass = "bg-blue-50 text-blue-700 border-blue-200";
              if (status === 'attended') badgeClass = "bg-purple-50 text-purple-700 border-purple-200";
              if (status === 'paid') badgeClass = "bg-green-50 text-green-700 border-green-200";
              if (status === 'active') badgeClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
              if (status === 'inactive') badgeClass = "bg-gray-100 text-gray-700 border-gray-300";
              if (status === 'churned') badgeClass = "bg-red-50 text-red-700 border-red-200";
              return (
                <div key={c.id} className="bg-white border rounded-xl p-4 shadow-sm space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-sm cursor-pointer hover:text-blue-600" onClick={() => openEditDialog(c)}>
                      {c.first_name} {c.last_name}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditDialog(c)}>
                        <Pencil className="w-3.5 h-3.5 text-gray-500" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400" onClick={() => deleteMutation.mutate(c.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Phone className="w-3 h-3" />{c.phone}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Select defaultValue={status} onValueChange={(val) => updateStatusMutation.mutate({ id: c.id, status: val })}>
                      <SelectTrigger className={`h-7 text-xs font-bold border w-[140px] ${badgeClass}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="booked">Записан</SelectItem>
                        <SelectItem value="attended">Пришел</SelectItem>
                        <SelectItem value="paid">Оплатил</SelectItem>
                        <SelectItem value="active">Активен</SelectItem>
                        <SelectItem value="inactive">Неактивен</SelectItem>
                        <SelectItem value="churned">Отток</SelectItem>
                      </SelectContent>
                    </Select>
                    {c.notes && <span className="text-xs text-gray-400 truncate">{c.notes}</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block">
            <DataTable columns={columns} data={filteredClients} emptyMessage="Лидов нет" />
          </div>
        </>
      )}
    </div>
  );
};

export default Trials;
