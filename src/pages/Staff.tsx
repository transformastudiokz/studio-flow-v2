import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MoreHorizontal, Plus, ShieldCheck, UserRoundCog } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrentProfile } from "@/hooks/use-current-profile";
import { toast } from "sonner";

const roleLabel: Record<string, string> = { owner: "Управляющий", admin: "Администратор", trainer: "Тренер" };
const emptyForm = { id: "", firstName: "", lastName: "", middleName: "", email: "", phone: "", role: "admin", position: "Администратор" };

export default function Staff() {
  const queryClient = useQueryClient();
  const { data: current } = useCurrentProfile();
  const [form, setForm] = useState(emptyForm);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data = [], isLoading } = useQuery({
    queryKey: ["staff"],
    enabled: current?.role === "owner",
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id,first_name,last_name,middle_name,phone,email,role,position,is_active,must_change_password").in("role", ["owner", "admin", "trainer"]).order("first_name");
      if (error) throw error;
      return data || [];
    },
  });

  const request = async (body: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch("/api/staff", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Ошибка");
    return payload;
  };

  const openCreate = () => { setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (person: any) => {
    setForm({ id: person.id, firstName: person.first_name || "", lastName: person.last_name || "", middleName: person.middle_name || "", email: person.email || "", phone: person.phone || "", role: person.role === "owner" ? "owner" : person.role, position: person.position || roleLabel[person.role] || "" });
    setDialogOpen(true);
  };
  const save = async () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim() || form.phone.replace(/\D/g, "").length < 10) return toast.error("Заполни имя, фамилию, email и корректный телефон");
    setSaving(true);
    try {
      await request({ action: form.id ? "update" : "create", userId: form.id || undefined, ...form });
      await queryClient.invalidateQueries({ queryKey: ["staff"] });
      setDialogOpen(false);
      toast.success(form.id ? "Данные сотрудника обновлены" : "Сотрудник создан. Временный пароль — последние 6 цифр телефона.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка"); }
    finally { setSaving(false); }
  };
  const copyAccess = async (person: any) => {
    try {
      const payload = await request({ action: "prepare-access", userId: person.id });
      const message = `Данные для входа в CRM Fitness\n\nСсылка: https://crm-fitness-one.vercel.app/login\nEmail: ${payload.email}\nВременный пароль: ${payload.temporaryPassword}\n\nПри первом входе система попросит создать собственный пароль.`;
      await navigator.clipboard.writeText(message);
      await queryClient.invalidateQueries({ queryKey: ["staff"] });
      toast.success("Данные скопированы. Временный пароль уже действует.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось скопировать данные"); }
  };

  if (current && current.role !== "owner") return <div className="rounded-xl border bg-white p-10 text-center"><ShieldCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground" /><h1 className="text-xl font-semibold">Доступ только управляющему</h1><p className="mt-2 text-muted-foreground">Сотрудники и их права защищены от изменений администраторами.</p></div>;

  return <div className="space-y-6 animate-in fade-in">
    <div className="flex items-start justify-between gap-4"><div><h1 className="text-3xl font-bold">Сотрудники</h1><p className="mt-1 text-muted-foreground">Учётные записи и уровни доступа команды</p></div><Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Добавить сотрудника</Button></div>
    <Card className="overflow-hidden"><div className="hidden grid-cols-[1.4fr_1fr_1fr_1fr_1.3fr_120px_48px] gap-4 border-b bg-muted/40 px-5 py-3 text-xs font-semibold text-muted-foreground lg:grid"><span>Сотрудник</span><span>Должность</span><span>Роль</span><span>Телефон</span><span>Email-логин</span><span>Статус</span><span /></div>
      {isLoading ? <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div> : data.length === 0 ? <div className="p-12 text-center text-muted-foreground"><UserRoundCog className="mx-auto mb-3 h-9 w-9" />Сотрудники пока не добавлены</div> : data.map((person: any) => <div key={person.id} className="grid gap-2 border-b px-5 py-4 text-sm lg:grid-cols-[1.4fr_1fr_1fr_1fr_1.3fr_120px_48px] lg:items-center"><span className="font-semibold">{`${person.first_name || ""} ${person.last_name || ""}`.trim() || "Без имени"}{person.id === current?.id && <Badge variant="outline" className="ml-2">Вы</Badge>}</span><span>{person.position || roleLabel[person.role]}</span><span><Badge variant={person.role === "owner" ? "default" : "secondary"}>{roleLabel[person.role] || person.role}</Badge></span><span>{person.phone || "—"}</span><span className="truncate">{person.email || "—"}</span><span>{!person.is_active ? <Badge variant="destructive">Отключён</Badge> : person.must_change_password ? <Badge variant="outline">Первый вход</Badge> : <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Активен</Badge>}</span><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => openEdit(person)}>Редактировать</DropdownMenuItem><DropdownMenuItem onClick={async () => { try { await request({ action: "reset-password", userId: person.id }); toast.success("Временный пароль сброшен. При входе сотрудник задаст новый."); } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка"); } }}>Сбросить пароль</DropdownMenuItem><DropdownMenuItem onClick={() => copyAccess(person)}>Скопировать данные для входа</DropdownMenuItem><DropdownMenuItem disabled={person.id === current?.id} onClick={async () => { try { await request({ action: "set-active", userId: person.id, active: !person.is_active }); await queryClient.invalidateQueries({ queryKey: ["staff"] }); toast.success(person.is_active ? "Доступ отключён" : "Доступ включён"); } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка"); } }}>{person.is_active ? "Отключить доступ" : "Включить доступ"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>)}</Card>

    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{form.id ? "Редактировать сотрудника" : "Новый сотрудник"}</DialogTitle>
          <DialogDescription>{form.id ? "Изменения обновят карточку и логин сотрудника." : "Система создаст карточку и учётную запись для входа. При первом входе сотрудник задаст собственный пароль."}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label>Имя *</Label><Input required value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} /></div>
          <div className="space-y-2"><Label>Фамилия *</Label><Input required value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} /></div>
          <div className="space-y-2 sm:col-span-2"><Label>Отчество</Label><Input value={form.middleName} onChange={e => setForm({ ...form, middleName: e.target.value })} /></div>
          <div className="space-y-2 sm:col-span-2"><Label>Email-логин</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
          <div className="space-y-2"><Label>Телефон</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="space-y-2"><Label>Роль доступа</Label><Select value={form.role} disabled={form.id === current?.id} onValueChange={value => setForm({ ...form, role: value, position: form.id ? form.position : value === "trainer" ? "Тренер" : value === "owner" ? "Управляющий" : "Администратор" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="owner">Управляющий</SelectItem><SelectItem value="admin">Администратор</SelectItem><SelectItem value="trainer">Тренер</SelectItem></SelectContent></Select></div>
          <div className="space-y-2 sm:col-span-2"><Label>Должность</Label><Input value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} placeholder="Например: Ассистент руководителя" /></div>
        </div>
        <Button className="w-full" onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{form.id ? "Сохранить изменения" : "Создать сотрудника"}</Button>
      </DialogContent>
    </Dialog>
  </div>;
}
