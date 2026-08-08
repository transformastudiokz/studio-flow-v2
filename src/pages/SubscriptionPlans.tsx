import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// ИСПРАВЛЕНИЕ 1: Добавили Textarea
import { Textarea } from "@/components/ui/textarea"; 
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plus, Trash2, Edit, Loader2, Eye, EyeOff } from "lucide-react";
import { Switch } from "@/components/ui/switch";

const SubscriptionPlans = () => {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<any>(null);

  // Фильтры
  const [filterName, setFilterName] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("all");
  const [filterMinPrice, setFilterMinPrice] = useState("");
  const [filterMaxPrice, setFilterMaxPrice] = useState("");
  const [filterMinVisits, setFilterMinVisits] = useState("");
  const [filterMaxVisits, setFilterMaxVisits] = useState("");
  const [filterMinDays, setFilterMinDays] = useState("");
  const [filterMaxDays, setFilterMaxDays] = useState("");

  // Форма
  const [formData, setFormData] = useState({
    name: "",
    price: "",
    visits_count: "",
    duration_days: "30",
    description: "",
    is_active: true,
    is_visible_in_client_portal: true
  });

  // 1. Загрузка тарифов
  const { data: plans = [], isLoading } = useQuery({
    queryKey: ["subscription-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("*")
        .order("price", { ascending: true });
      
      if (error) throw error;
      return data;
    },
  });

  // Мутация: Создание / Редактирование
  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: formData.name,
        price: Number(formData.price),
        visits_count: formData.visits_count && formData.visits_count !== "0" ? Number(formData.visits_count) : null,
        duration_days: Number(formData.duration_days),
        description: formData.description,
        is_active: formData.is_active,
        is_visible_in_client_portal: formData.is_visible_in_client_portal
      };

      if (editingPlan) {
        const { error } = await supabase.from('subscription_plans').update(payload).eq('id', editingPlan.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('subscription_plans').insert([payload]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingPlan ? "Тариф обновлен" : "Тариф создан");
      setIsOpen(false);
      setEditingPlan(null);
      setFormData({ name: "", price: "", visits_count: "", duration_days: "30", description: "", is_active: true, is_visible_in_client_portal: true });
      queryClient.invalidateQueries({ queryKey: ["subscription-plans"] });
    },
    onError: (err: any) => toast.error("Ошибка: " + err.message)
  });

  // Удаление
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('subscription_plans').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Тариф удален");
      queryClient.invalidateQueries({ queryKey: ["subscription-plans"] });
    },
    onError: (err: any) => toast.error("Не удалось удалить: " + err.message)
  });

  const openEdit = (plan: any) => {
    setEditingPlan(plan);
    setFormData({
      name: plan.name,
      price: plan.price.toString(),
      visits_count: plan.visits_count ? plan.visits_count.toString() : "",
      duration_days: plan.duration_days ? plan.duration_days.toString() : "30",
      description: plan.description || "",
      is_active: plan.is_active,
      is_visible_in_client_portal: plan.is_visible_in_client_portal ?? true
    });
    setIsOpen(true);
  };

  const openCreate = () => {
    setEditingPlan(null);
    setFormData({ name: "", price: "", visits_count: "", duration_days: "30", description: "", is_active: true, is_visible_in_client_portal: true });
    setIsOpen(true);
  };

  const filteredPlans = plans.filter((plan: any) => {
    if (filterName && !plan.name.toLowerCase().includes(filterName.toLowerCase())) return false;
    if (filterStatus === "active" && !plan.is_active) return false;
    if (filterStatus === "inactive" && plan.is_active) return false;
    if (filterMinPrice && plan.price < Number(filterMinPrice)) return false;
    if (filterMaxPrice && plan.price > Number(filterMaxPrice)) return false;
    if (filterMinVisits && plan.visits_count !== null && plan.visits_count < Number(filterMinVisits)) return false;
    if (filterMaxVisits && plan.visits_count !== null && plan.visits_count > Number(filterMaxVisits)) return false;
    if (filterMinDays && plan.duration_days < Number(filterMinDays)) return false;
    if (filterMaxDays && plan.duration_days > Number(filterMaxDays)) return false;
    return true;
  });

  const hasActiveFilters = filterName || filterStatus !== "all" || filterMinPrice || filterMaxPrice || filterMinVisits || filterMaxVisits || filterMinDays || filterMaxDays;

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Виды абонементов</h1>
          <p className="text-muted-foreground">Настройте тарифы, которые будут доступны клиентам</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> Создать тариф
        </Button>
      </div>

      {/* ФИЛЬТРЫ */}
      <div className="border rounded-lg p-4 bg-muted/20 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Фильтры</span>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => {
              setFilterName(""); setFilterStatus("all");
              setFilterMinPrice(""); setFilterMaxPrice("");
              setFilterMinVisits(""); setFilterMaxVisits("");
              setFilterMinDays(""); setFilterMaxDays("");
            }}>
              Сбросить
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <Input
            placeholder="Поиск по названию"
            value={filterName}
            onChange={e => setFilterName(e.target.value)}
            className="h-8 text-sm"
          />
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as any)}
            className="h-8 text-sm border rounded-md px-2 bg-background"
          >
            <option value="all">Все статусы</option>
            <option value="active">Активные</option>
            <option value="inactive">Архив</option>
          </select>
          <div className="flex gap-2">
            <Input placeholder="Цена от" type="number" value={filterMinPrice} onChange={e => setFilterMinPrice(e.target.value)} className="h-8 text-sm" />
            <Input placeholder="до" type="number" value={filterMaxPrice} onChange={e => setFilterMaxPrice(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="flex gap-2">
            <Input placeholder="Занятий от" type="number" value={filterMinVisits} onChange={e => setFilterMinVisits(e.target.value)} className="h-8 text-sm" />
            <Input placeholder="до" type="number" value={filterMaxVisits} onChange={e => setFilterMaxVisits(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="flex gap-2 sm:col-span-2 md:col-span-1">
            <Input placeholder="Дней от" type="number" value={filterMinDays} onChange={e => setFilterMinDays(e.target.value)} className="h-8 text-sm" />
            <Input placeholder="до" type="number" value={filterMaxDays} onChange={e => setFilterMaxDays(e.target.value)} className="h-8 text-sm" />
          </div>
        </div>
        {hasActiveFilters && (
          <p className="text-xs text-muted-foreground">Найдено: {filteredPlans.length} из {plans.length}</p>
        )}
      </div>

      {isLoading ? <Loader2 className="animate-spin" /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPlans.length === 0 && <p className="text-muted-foreground col-span-full">Нет тарифов по выбранным фильтрам.</p>}
          {filteredPlans.map((plan: any) => (
            <Card key={plan.id} className={`relative transition-all hover:shadow-md flex flex-col ${!plan.is_active ? 'opacity-60 grayscale' : ''}`}>
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-xl">{plan.name}</CardTitle>
                    <div className="text-2xl font-bold mt-2 text-primary">
                      {plan.price.toLocaleString()} ₸
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    {!plan.is_active && <span className="bg-gray-200 text-gray-600 text-xs px-2 py-1 rounded">Архив</span>}
                    {plan.is_visible_in_client_portal !== false ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                        <Eye className="h-3 w-3" /> В кабинете клиента
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                        <EyeOff className="h-3 w-3" /> Скрыт от клиентов
                      </span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col justify-between">
                <div className="space-y-4 mb-4">
                  <div className="flex justify-between text-sm border-b pb-2">
                    <span className="text-muted-foreground">Занятий:</span>
                    <span className="font-medium">{plan.visits_count === null ? "Безлимит" : plan.visits_count}</span>
                  </div>
                  <div className="flex justify-between text-sm border-b pb-2">
                    <span className="text-muted-foreground">Срок действия:</span>
                    <span className="font-medium">{plan.duration_days} дней</span>
                  </div>
                  
                  {/* ИСПРАВЛЕНИЕ 2: Отображение описания списком */}
                  {plan.description && (
                      <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded">
                        {plan.description.split('\n').map((line: string, index: number) => (
                          <div key={index} className="flex items-start gap-2 mb-1 last:mb-0">
                            {line.trim().startsWith('-') ? (
                                <>
                                    <span className="mt-1 block w-1 h-1 rounded-full bg-primary/60 shrink-0" />
                                    <span>{line.replace(/^-/, '').trim()}</span>
                                </>
                            ) : (
                                line
                            )}
                          </div>
                        ))}
                      </div>
                  )}
                </div>

                <div className="flex gap-2 pt-2 mt-auto">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(plan)}>
                      <Edit className="w-3 h-3 mr-2" /> Изменить
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => {if(confirm("Удалить?")) deleteMutation.mutate(plan.id)}}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPlan ? "Редактировать тариф" : "Новый тариф"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Название</Label>
              <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Например: 8 занятий" />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Цена (₸)</Label>
                  <Input type="number" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label>Кол-во занятий</Label>
                  <Input type="number" value={formData.visits_count} onChange={e => setFormData({...formData, visits_count: e.target.value})} placeholder="Пусто = Безлимит" />
                </div>
            </div>
             <div className="grid gap-2">
                <Label>Срок действия (дней)</Label>
                <Input type="number" value={formData.duration_days} onChange={e => setFormData({...formData, duration_days: e.target.value})} />
            </div>
            <div className="grid gap-2">
                <Label>Описание (каждая фича с новой строки)</Label>
                {/* ИСПРАВЛЕНИЕ 3: Заменили Input на Textarea */}
                <Textarea 
                    className="min-h-[100px]"
                    value={formData.description} 
                    onChange={e => setFormData({...formData, description: e.target.value})} 
                    placeholder="Например:\n- Заморозка 7 дней\n- Полотенце включено\n- Доступ в сауну" 
                />
            </div>
            <div className="flex items-center space-x-2 border p-3 rounded-md bg-muted/20">
                <Switch checked={formData.is_active} onCheckedChange={c => setFormData({...formData, is_active: c})} />
                <Label>Активен</Label>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/20 p-3">
                <div className="space-y-1">
                  <Label htmlFor="client-portal-visibility">Отображать в личном кабинете клиента</Label>
                  <p className="text-xs text-muted-foreground">Тариф появится во вкладке «Все тарифы». Отключение не влияет на уже выданные абонементы.</p>
                </div>
                <Switch
                  id="client-portal-visibility"
                  checked={formData.is_visible_in_client_portal}
                  onCheckedChange={c => setFormData({...formData, is_visible_in_client_portal: c})}
                />
            </div>
          </div>
          <DialogFooter>
            <Button className="w-full" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                {mutation.isPending ? <Loader2 className="animate-spin mr-2" /> : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SubscriptionPlans;
