import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, DoorOpen, Edit, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type Service = { id: string; code: string; name: string; room: string; duration_minutes: number; list_price: number; is_active: boolean };
const money = (value: number) => new Intl.NumberFormat("ru-RU").format(value) + " ₸";
const initialForm = { name: "", room: "Малый зал", duration_minutes: "60", list_price: "", is_active: true };

export default function Services() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [form, setForm] = useState(initialForm);
  const { data: canManage = false } = useQuery<boolean>({
    queryKey: ["services_can_manage"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      const { data, error } = await supabase.from("profiles").select("role,is_active").eq("id", user.id).single();
      if (error) throw error;
      return data?.role === "owner" && data?.is_active !== false;
    },
  });
  const { data: services = [], isLoading } = useQuery<Service[]>({
    queryKey: ["service_catalog"],
    queryFn: async () => {
      const { data, error } = await supabase.from("service_catalog").select("*").eq("category", "rental").order("room").order("duration_minutes");
      if (error) throw error;
      return (data || []) as Service[];
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      const duration = Number(form.duration_minutes);
      const price = Number(form.list_price);
      if (!form.name.trim()) throw new Error("Укажи название услуги");
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("Укажи продолжительность");
      if (!Number.isFinite(price) || price < 0) throw new Error("Укажи стоимость");
      const payload = { name: form.name.trim(), room: form.room, duration_minutes: duration, list_price: price, is_active: form.is_active, category: "rental" };
      const result = editing
        ? await supabase.from("service_catalog").update(payload).eq("id", editing.id)
        : await supabase.from("service_catalog").insert({ ...payload, code: `rental-${crypto.randomUUID()}` });
      if (result.error) throw result.error;
    },
    onSuccess: async () => { toast.success(editing ? "Услуга обновлена" : "Услуга создана"); setOpen(false); await queryClient.invalidateQueries({ queryKey: ["service_catalog"] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const edit = (service: Service) => { setEditing(service); setForm({ name: service.name, room: service.room, duration_minutes: String(service.duration_minutes), list_price: String(service.list_price), is_active: service.is_active }); setOpen(true); };
  const create = () => { setEditing(null); setForm(initialForm); setOpen(true); };

  return <div className="space-y-6 animate-in fade-in">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-3xl font-bold">Услуги</h1><p className="mt-1 text-muted-foreground">Аренда залов и другие услуги, которые не относятся к фитнес-абонементам</p></div>{canManage ? <Button onClick={create}><Plus className="mr-2 h-4 w-4" />Добавить услугу</Button> : null}</div>
    {isLoading ? <Loader2 className="animate-spin" /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{services.map(service => <Card key={service.id} className={!service.is_active ? "opacity-60" : ""}><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><CardTitle className="text-lg leading-tight">{service.name}</CardTitle>{canManage ? <Button variant="ghost" size="icon" onClick={() => edit(service)} aria-label={`Редактировать ${service.name}`}><Edit className="h-4 w-4" /></Button> : null}</div></CardHeader><CardContent className="space-y-3"><p className="text-2xl font-bold text-primary">{money(Number(service.list_price))}</p><div className="flex flex-wrap gap-2 text-sm text-muted-foreground"><span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1"><DoorOpen className="h-3.5 w-3.5" />{service.room}</span><span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1"><Clock3 className="h-3.5 w-3.5" />{service.duration_minutes} мин</span></div><p className="text-xs text-muted-foreground">{service.is_active ? "Доступна для новых бронирований" : "В архиве"}</p></CardContent></Card>)}</div>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{editing ? "Редактировать услугу" : "Новая услуга"}</DialogTitle></DialogHeader><div className="grid gap-4 py-2"><div className="grid gap-2"><Label>Название</Label><Input value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))} /></div><div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label>Зал</Label><Select value={form.room} onValueChange={room => setForm(v => ({ ...v, room }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Малый зал">Малый зал</SelectItem><SelectItem value="Большой зал">Большой зал</SelectItem></SelectContent></Select></div><div className="grid gap-2"><Label>Продолжительность, минут</Label><Input type="number" min="1" value={form.duration_minutes} onChange={e => setForm(v => ({ ...v, duration_minutes: e.target.value }))} /></div></div><div className="grid gap-2"><Label>Стоимость, ₸</Label><Input type="number" min="0" value={form.list_price} onChange={e => setForm(v => ({ ...v, list_price: e.target.value }))} /></div><label className="flex items-center justify-between rounded-xl border p-3"><span><span className="block font-medium">Активна</span><span className="text-xs text-muted-foreground">Можно выбирать в новой аренде</span></span><Switch checked={form.is_active} onCheckedChange={is_active => setForm(v => ({ ...v, is_active }))} /></label></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button><Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Сохранить</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
