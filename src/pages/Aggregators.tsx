import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Loader2, Trash2, Users, TrendingUp } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, parseISO, subDays } from "date-fns";
import { ru } from "date-fns/locale";
import { DataTable } from "@/components/ui/data-table";
import { Textarea } from "@/components/ui/textarea";
import { User, FileText, ExternalLink } from "lucide-react";

const Aggregators = () => {
  const queryClient = useQueryClient();

  // Tab 1 state
  const [isSessionDialogOpen, setIsSessionDialogOpen] = useState(false);
  const [sessionForm, setSessionForm] = useState({
    session_id: "",
    aggregator_name: "1Fit",
    visit_count: "1",
    price_per_visit: "0",
    notes: ""
  });

  // Tab 2 state
  const [isClientDialogOpen, setIsClientDialogOpen] = useState(false);
  const [clientForm, setClientForm] = useState({
    aggregator_name: "1Fit",
    client_name: "",
    price: "1200",
    notes: "",
    website_url: ""
  });

  // Loads sessions from last 30 days + today
  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions_for_aggregator'],
    queryFn: async () => {
      const from = subDays(new Date(), 30).toISOString();
      const to = new Date().toISOString();
      const { data } = await supabase
        .from('schedule_sessions')
        .select('id, start_time, end_time, class_type:class_types(name, color), coach:coaches(name)')
        .gte('start_time', from)
        .lte('start_time', to)
        .order('start_time', { ascending: false });
      return data || [];
    }
  });

  const { data: sessionVisits = [], isLoading: loadingVisits } = useQuery({
    queryKey: ['aggregator_session_visits'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('aggregator_session_visits')
        .select('*, session:schedule_sessions(start_time, class_type:class_types(name, color), coach:coaches(name))')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    }
  });

  const { data: individualVisits = [], isLoading: loadingIndividual } = useQuery({
    queryKey: ['aggregators'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('aggregators')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    }
  });

  const addSessionVisitMutation = useMutation({
    mutationFn: async () => {
      if (!sessionForm.session_id) throw new Error("Выберите урок");
      const { error } = await supabase.from('aggregator_session_visits').insert([{
        session_id: sessionForm.session_id,
        aggregator_name: sessionForm.aggregator_name,
        visit_count: parseInt(sessionForm.visit_count) || 1,
        price_per_visit: parseInt(sessionForm.price_per_visit) || 0,
        notes: sessionForm.notes
      }]);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Посещения записаны");
      setIsSessionDialogOpen(false);
      setSessionForm({ session_id: "", aggregator_name: "1Fit", visit_count: "1", price_per_visit: "0", notes: "" });
      queryClient.invalidateQueries({ queryKey: ['aggregator_session_visits'] });
    },
    onError: (err: any) => toast.error(err.message)
  });

  const addClientMutation = useMutation({
    mutationFn: async () => {
      if (!clientForm.aggregator_name || !clientForm.client_name) throw new Error("Заполните обязательные поля");
      const { error } = await supabase.from('aggregators').insert([{
        aggregator_name: clientForm.aggregator_name,
        client_name: clientForm.client_name,
        price: parseInt(clientForm.price) || 0,
        notes: clientForm.notes,
        website_url: clientForm.website_url
      }]);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Клиент добавлен");
      setIsClientDialogOpen(false);
      setClientForm({ aggregator_name: "1Fit", client_name: "", price: "1200", notes: "", website_url: "" });
      queryClient.invalidateQueries({ queryKey: ['aggregators'] });
    },
    onError: (err: any) => toast.error(err.message)
  });

  const deleteSessionVisitMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('aggregator_session_visits').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Удалено"); queryClient.invalidateQueries({ queryKey: ['aggregator_session_visits'] }); }
  });

  const deleteClientMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('aggregators').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Удалено"); queryClient.invalidateQueries({ queryKey: ['aggregators'] }); }
  });

  // Summary stats
  const totalVisitsThisMonth = (sessionVisits as any[])
    .filter((v: any) => new Date(v.created_at).getMonth() === new Date().getMonth())
    .reduce((sum: number, v: any) => sum + v.visit_count, 0);
  const totalRevenueThisMonth = (sessionVisits as any[])
    .filter((v: any) => new Date(v.created_at).getMonth() === new Date().getMonth())
    .reduce((sum: number, v: any) => sum + (v.visit_count * v.price_per_visit), 0);

  const clientColumns = [
    { accessorKey: "aggregator_name", header: "Агрегатор", cell: ({ row }: any) => <span className="font-bold bg-gray-100 px-2 py-1 rounded text-sm">{row.original.aggregator_name}</span> },
    { accessorKey: "client_name", header: "Клиент", cell: ({ row }: any) => <span className="flex items-center gap-2"><User className="w-4 h-4 text-gray-400" />{row.original.client_name}</span> },
    { accessorKey: "price", header: "Сумма", cell: ({ row }: any) => <span className="font-bold text-green-700">{row.original.price} ₸</span> },
    { accessorKey: "notes", header: "Заметки", cell: ({ row }: any) => <span className="text-gray-500 text-sm">{row.original.notes || "—"}</span> },
    { id: "actions", cell: ({ row }: any) => (
      <div className="flex justify-end gap-2">
        {row.original.website_url && <a href={row.original.website_url} target="_blank" rel="noreferrer"><Button variant="ghost" size="icon"><ExternalLink className="w-4 h-4 text-gray-500" /></Button></a>}
        <Button variant="ghost" size="icon" className="text-red-500" onClick={() => deleteClientMutation.mutate(row.original.id)}><Trash2 className="w-4 h-4" /></Button>
      </div>
    )}
  ];

  return (
    <div className="space-y-6 animate-in fade-in">
      <div>
        <h1 className="text-3xl font-bold">Агрегаторы</h1>
        <p className="text-muted-foreground">Учёт посещений от партнёров (1Fit и др.)</p>
      </div>

      <Tabs defaultValue="sessions">
        <TabsList className="grid grid-cols-2 w-full max-w-sm">
          <TabsTrigger value="sessions">По урокам</TabsTrigger>
          <TabsTrigger value="individual">Индивидуальные</TabsTrigger>
        </TabsList>

        {/* TAB 1: BY SESSION */}
        <TabsContent value="sessions" className="space-y-4 mt-4">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
              <div className="flex items-center gap-2 text-blue-600 mb-1"><Users className="w-4 h-4" /><span className="text-sm font-medium">Этот месяц</span></div>
              <div className="text-2xl font-bold text-blue-700">{totalVisitsThisMonth} чел.</div>
            </div>
            <div className="bg-green-50 border border-green-100 rounded-xl p-4">
              <div className="flex items-center gap-2 text-green-600 mb-1"><TrendingUp className="w-4 h-4" /><span className="text-sm font-medium">Выручка</span></div>
              <div className="text-2xl font-bold text-green-700">{totalRevenueThisMonth.toLocaleString()} ₸</div>
            </div>
          </div>

          <Button onClick={() => setIsSessionDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Записать посещения
          </Button>

          {loadingVisits ? <Loader2 className="animate-spin" /> : (
            <div className="space-y-3">
              {(sessionVisits as any[]).length === 0 ? (
                <div className="text-center py-12 text-muted-foreground border border-dashed rounded-xl">Нет записей. Нажмите "Записать посещения"</div>
              ) : (sessionVisits as any[]).map((v: any) => (
                <div key={v.id} className="bg-white border rounded-xl p-4 shadow-sm flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold bg-gray-100 px-2 py-0.5 rounded text-sm">{v.aggregator_name}</span>
                      {v.session?.start_time && (
                        <span className="text-sm text-muted-foreground capitalize">
                          {format(parseISO(v.session.start_time), 'd MMM, HH:mm', { locale: ru })}
                        </span>
                      )}
                    </div>
                    <div className="font-semibold">{v.session?.class_type?.name || '—'}</div>
                    {v.session?.coach?.name && <div className="text-sm text-muted-foreground">{v.session.coach.name}</div>}
                    <div className="flex items-center gap-4 mt-2 text-sm">
                      <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /><strong>{v.visit_count}</strong> чел.</span>
                      {v.price_per_visit > 0 && <span className="text-green-700 font-semibold">{(v.visit_count * v.price_per_visit).toLocaleString()} ₸</span>}
                    </div>
                    {v.notes && <p className="text-xs text-muted-foreground mt-1">{v.notes}</p>}
                  </div>
                  <Button variant="ghost" size="icon" className="text-red-400 shrink-0" onClick={() => deleteSessionVisitMutation.mutate(v.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* TAB 2: INDIVIDUAL CLIENTS */}
        <TabsContent value="individual" className="space-y-4 mt-4">
          <Button onClick={() => setIsClientDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Добавить клиента
          </Button>
          {loadingIndividual ? <Loader2 className="animate-spin" /> : (
            <DataTable columns={clientColumns} data={individualVisits} emptyMessage="Нет индивидуальных записей" />
          )}
        </TabsContent>
      </Tabs>

      {/* Dialog: Add session visits */}
      <Dialog open={isSessionDialogOpen} onOpenChange={setIsSessionDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Записать посещения от агрегатора</DialogTitle>
            <DialogDescription>Выберите урок и укажите количество клиентов из агрегатора</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Урок из расписания *</Label>
              <Select value={sessionForm.session_id} onValueChange={val => setSessionForm({...sessionForm, session_id: val})}>
                <SelectTrigger><SelectValue placeholder="Выберите урок..." /></SelectTrigger>
                <SelectContent className="max-h-60">
                  {(sessions as any[]).map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="flex flex-col">
                        <span className="font-medium">{s.class_type?.name}</span>
                        <span className="text-xs text-muted-foreground capitalize">
                          {format(parseISO(s.start_time), 'd MMM, HH:mm', { locale: ru })}
                          {s.coach?.name ? ` · ${s.coach.name}` : ''}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Агрегатор</Label>
                <Input value={sessionForm.aggregator_name} onChange={e => setSessionForm({...sessionForm, aggregator_name: e.target.value})} placeholder="1Fit" />
              </div>
              <div className="space-y-2">
                <Label>Количество человек *</Label>
                <Input type="number" min="1" value={sessionForm.visit_count} onChange={e => setSessionForm({...sessionForm, visit_count: e.target.value})} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Цена за человека (₸)</Label>
              <Input type="number" min="0" value={sessionForm.price_per_visit} onChange={e => setSessionForm({...sessionForm, price_per_visit: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>Заметки</Label>
              <Input value={sessionForm.notes} onChange={e => setSessionForm({...sessionForm, notes: e.target.value})} placeholder="Необязательно" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => addSessionVisitMutation.mutate()} disabled={addSessionVisitMutation.isPending}>
              {addSessionVisitMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Add individual client */}
      <Dialog open={isClientDialogOpen} onOpenChange={setIsClientDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый клиент от агрегатора</DialogTitle>
            <DialogDescription>Индивидуальная запись посещения</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Агрегатор *</Label>
                <Input value={clientForm.aggregator_name} onChange={e => setClientForm({...clientForm, aggregator_name: e.target.value})} placeholder="1Fit" />
              </div>
              <div className="space-y-2">
                <Label>Имя клиента *</Label>
                <Input value={clientForm.client_name} onChange={e => setClientForm({...clientForm, client_name: e.target.value})} placeholder="Айгерим" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Сумма (₸)</Label>
              <Input type="number" value={clientForm.price} onChange={e => setClientForm({...clientForm, price: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>Комментарий</Label>
              <Textarea value={clientForm.notes} onChange={e => setClientForm({...clientForm, notes: e.target.value})} placeholder="Детали..." />
            </div>
            <div className="space-y-2">
              <Label>Ссылка</Label>
              <Input value={clientForm.website_url} onChange={e => setClientForm({...clientForm, website_url: e.target.value})} placeholder="https://" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => addClientMutation.mutate()} disabled={addClientMutation.isPending}>
              {addClientMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Aggregators;
