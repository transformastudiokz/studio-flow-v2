import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Edit, Trash2, Loader2, Phone } from "lucide-react";
import { toast } from "sonner";
import { getClassTypeImageUrl } from "@/lib/class-type-assets";

// ─── CLASS TYPES ────────────────────────────────────────────────────────────

function ClassTypesTab() {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const emptyForm = { name: "", description: "", duration: "60", color: "#3b82f6" };
  const [form, setForm] = useState(emptyForm);

  const { data: types = [], isLoading } = useQuery({
    queryKey: ["class_types"],
    queryFn: async () => {
      const { data, error } = await supabase.from("class_types").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        description: form.description,
        duration_min: parseInt(form.duration),
        color: form.color,
      };
      if (editing) {
        const { error } = await supabase.from("class_types").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("class_types").insert([payload]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Тип занятия обновлён" : "Тип занятия добавлен");
      queryClient.invalidateQueries({ queryKey: ["class_types"] });
      setIsOpen(false);
      setEditing(null);
      setForm(emptyForm);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("class_types").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Удалено");
      queryClient.invalidateQueries({ queryKey: ["class_types"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setIsOpen(true);
  };

  const openEdit = (t: any) => {
    setEditing(t);
    setForm({ name: t.name, description: t.description || "", duration: String(t.duration_min || 60), color: t.color || "#3b82f6" });
    setIsOpen(true);
  };

  return (
    <>
      <div className="flex justify-between items-center mb-3">
        <span className="text-sm text-muted-foreground">{types.length} видов занятий</span>
        <Button size="sm" onClick={openCreate} className="h-8">
          <Plus className="w-4 h-4 mr-1" /> Добавить
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary" /></div>
      ) : types.length === 0 ? (
        <div className="text-center py-12 border border-dashed rounded-2xl text-muted-foreground text-sm">
          Нет видов занятий
        </div>
      ) : (
        <div className="space-y-2">
          {types.map((t: any) => {
            const imageUrl = getClassTypeImageUrl(t.name);
            return (
              <div key={t.id} className="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm flex items-center gap-3">
                {imageUrl ? (
                  <img src={imageUrl} alt={t.name} className="h-12 w-16 shrink-0 rounded-md object-cover" />
                ) : (
                  <div className="flex h-12 w-16 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] text-muted-foreground">
                    нет фото
                  </div>
                )}
                <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.duration_min} мин</p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-500" onClick={() => openEdit(t)}>
                  <Edit className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost" size="icon" className="h-8 w-8 text-red-400"
                  disabled={deleteMutation.isPending}
                  onClick={() => { if (confirm("Удалить?")) deleteMutation.mutate(t.id); }}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={isOpen} onOpenChange={(o) => { setIsOpen(o); if (!o) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Редактировать вид занятия" : "Новый вид занятия"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Название</Label>
              <Input placeholder="Йога, Пилатес..." value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Описание</Label>
              <Textarea placeholder="Описание..." value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Длительность (мин)</Label>
                <Input type="number" value={form.duration} onChange={e => setForm({ ...form, duration: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Цвет</Label>
                <Input type="color" className="h-10 px-2" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} />
              </div>
            </div>
            <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={!form.name || saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Сохранить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── INSTRUCTORS ─────────────────────────────────────────────────────────────

function InstructorsTab() {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const emptyForm = { name: "", specialization: "", phone: "", photo_url: "", bio: "", is_active: true, rate_per_client: "" };
  const [form, setForm] = useState(emptyForm);
  const [selectedClassTypes, setSelectedClassTypes] = useState<string[]>([]);

  const { data: coaches = [], isLoading } = useQuery({
    queryKey: ["coaches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coaches")
        .select("*, coach_class_types(class_type_id, class_types(id, name, color))")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: classTypes = [] } = useQuery({
    queryKey: ["class_types"],
    queryFn: async () => {
      const { data, error } = await supabase.from("class_types").select("id, name, color").order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        specialization: form.specialization,
        phone: form.phone,
        photo_url: form.photo_url,
        bio: form.bio,
        is_active: form.is_active,
        rate_per_client: parseInt(form.rate_per_client) || 0,
      };
      if (editing) {
        const { error } = await supabase.from("coaches").update(payload).eq("id", editing.id);
        if (error) throw error;
        await supabase.from("coach_class_types").delete().eq("coach_id", editing.id);
        if (selectedClassTypes.length > 0) {
          const { error: le } = await supabase.from("coach_class_types").insert(
            selectedClassTypes.map(id => ({ coach_id: editing.id, class_type_id: id }))
          );
          if (le) throw le;
        }
      } else {
        if (!form.name) throw new Error("Имя обязательно");
        const { data: newCoach, error } = await supabase.from("coaches").insert([payload]).select().single();
        if (error) throw error;
        if (selectedClassTypes.length > 0) {
          const { error: le } = await supabase.from("coach_class_types").insert(
            selectedClassTypes.map(id => ({ coach_id: newCoach.id, class_type_id: id }))
          );
          if (le) throw le;
        }
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Тренер обновлён" : "Тренер добавлен");
      queryClient.invalidateQueries({ queryKey: ["coaches"] });
      setIsOpen(false);
      setEditing(null);
      setForm(emptyForm);
      setSelectedClassTypes([]);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("coaches").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Тренер удалён");
      queryClient.invalidateQueries({ queryKey: ["coaches"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setSelectedClassTypes([]);
    setIsOpen(true);
  };

  const openEdit = (c: any) => {
    setEditing(c);
    setForm({
      name: c.name || "",
      specialization: c.specialization || "",
      phone: c.phone || "",
      photo_url: c.photo_url || "",
      bio: c.bio || "",
      is_active: c.is_active ?? true,
      rate_per_client: c.rate_per_client != null ? String(c.rate_per_client) : "",
    });
    setSelectedClassTypes((c.coach_class_types || []).map((x: any) => x.class_type_id));
    setIsOpen(true);
  };

  const toggleCT = (id: string) =>
    setSelectedClassTypes(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <>
      <div className="flex justify-between items-center mb-3">
        <span className="text-sm text-muted-foreground">{coaches.length} тренеров</span>
        <Button size="sm" onClick={openCreate} className="h-8">
          <Plus className="w-4 h-4 mr-1" /> Добавить
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary" /></div>
      ) : coaches.length === 0 ? (
        <div className="text-center py-12 border border-dashed rounded-2xl text-muted-foreground text-sm">
          Нет тренеров
        </div>
      ) : (
        <div className="space-y-2">
          {coaches.map((c: any) => (
            <div key={c.id} className="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm flex items-center gap-3">
              <Avatar className="h-10 w-10 shrink-0">
                <AvatarImage src={c.photo_url} />
                <AvatarFallback className="text-xs">{c.name?.substring(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm truncate">{c.name}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${c.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {c.is_active ? "Активен" : "Неактивен"}
                  </span>
                </div>
                {c.phone && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                    <Phone className="w-3 h-3" />{c.phone}
                  </div>
                )}
                <div className="flex flex-wrap gap-1 mt-1">
                  {(c.coach_class_types || []).map((cct: any) => (
                    <Badge
                      key={cct.class_type_id}
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0"
                      style={{ backgroundColor: cct.class_types?.color + "33", color: cct.class_types?.color }}
                    >
                      {cct.class_types?.name}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-500" onClick={() => openEdit(c)}>
                <Edit className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost" size="icon" className="h-8 w-8 text-red-400"
                disabled={deleteMutation.isPending}
                onClick={() => { if (confirm("Удалить тренера?")) deleteMutation.mutate(c.id); }}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={isOpen} onOpenChange={(o) => { setIsOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Редактировать тренера" : "Новый тренер"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Имя и Фамилия *</Label>
              <Input placeholder="Анна Иванова" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Телефон</Label>
              <Input placeholder="+7..." value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Ссылка на фото</Label>
              <Input placeholder="https://..." value={form.photo_url} onChange={e => setForm({ ...form, photo_url: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>О тренере</Label>
              <Textarea placeholder="Краткое описание..." value={form.bio} onChange={e => setForm({ ...form, bio: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Ставка за клиента (₸)</Label>
              <Input type="number" placeholder="0" value={form.rate_per_client} onChange={e => setForm({ ...form, rate_per_client: e.target.value })} />
            </div>
            {classTypes.length > 0 && (
              <div className="space-y-2">
                <Label>Специализация</Label>
                <div className="border rounded-md p-3 grid grid-cols-2 gap-2">
                  {classTypes.map((ct: any) => (
                    <div key={ct.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`ct-${ct.id}`}
                        checked={selectedClassTypes.includes(ct.id)}
                        onCheckedChange={() => toggleCT(ct.id)}
                      />
                      <label htmlFor={`ct-${ct.id}`} className="text-sm cursor-pointer flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: ct.color }} />
                        {ct.name}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 border p-3 rounded-md bg-muted/20">
              <Switch checked={form.is_active} onCheckedChange={v => setForm({ ...form, is_active: v })} />
              <Label>Активен</Label>
            </div>
            <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={!form.name || saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Сохранить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

export default function AdminManage() {
  return (
    <div className="space-y-4 animate-in fade-in pb-20">
      <div>
        <h1 className="text-xl font-bold">Управление</h1>
        <p className="text-xs text-muted-foreground">Виды занятий и тренеры</p>
      </div>

      <Tabs defaultValue="classes">
        <TabsList className="w-full">
          <TabsTrigger value="classes" className="flex-1">Виды занятий</TabsTrigger>
          <TabsTrigger value="coaches" className="flex-1">Тренеры</TabsTrigger>
        </TabsList>
        <TabsContent value="classes" className="mt-4">
          <ClassTypesTab />
        </TabsContent>
        <TabsContent value="coaches" className="mt-4">
          <InstructorsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
