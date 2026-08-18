import { FormEvent, useState } from "react";
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
import { isValidStaffPhone } from "@/lib/staff-validation";
import { toast } from "sonner";

const roleLabel: Record<string, string> = { owner: "Управляющий", admin: "Администратор", trainer: "Тренер" };
const emptyForm = { id: "", firstName: "", lastName: "", middleName: "", email: "", phone: "", role: "admin", position: "Администратор" };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type StaffProfile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  middle_name: string | null;
  phone: string | null;
  email: string | null;
  role: string;
  position: string | null;
  is_active: boolean;
  must_change_password: boolean;
};

function validateStaffForm(form: typeof emptyForm) {
  const errors: Record<string, string> = {};
  if (!form.firstName.trim()) errors.firstName = "Укажи имя";
  if (!form.lastName.trim()) errors.lastName = "Укажи фамилию";
  if (!emailPattern.test(form.email.trim())) errors.email = "Укажи корректный email";
  if (!isValidStaffPhone(form.phone)) errors.phone = "Укажи телефон из 11 цифр";
  return errors;
}

export default function Staff() {
  const queryClient = useQueryClient();
  const { data: current } = useCurrentProfile();
  const [form, setForm] = useState(emptyForm);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const { data = [], isLoading } = useQuery({
    queryKey: ["staff"],
    enabled: current?.role === "owner",
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id,first_name,last_name,middle_name,phone,email,role,position,is_active,must_change_password").in("role", ["owner", "admin", "trainer"]).order("first_name");
      if (error) throw error;
      return (data || []) as StaffProfile[];
    },
  });

  const request = async (body: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Сессия истекла. Обнови страницу и войди снова.");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    let response: Response;
    try {
      response = await fetch("/api/staff", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body), signal: controller.signal });
    } catch (error) {
      if (error && typeof error === "object" && "name" in error && error.name === "AbortError") throw new Error("Сервер не ответил. Попробуй ещё раз.");
      throw new Error("Не удалось связаться с сервером. Проверь интернет и повтори.");
    } finally {
      window.clearTimeout(timeout);
    }
    const payload = await response.json().catch(() => ({ error: "Сервер вернул некорректный ответ" }));
    if (!response.ok) throw new Error(payload.error || "Ошибка");
    return payload;
  };

  const openCreate = () => { setForm(emptyForm); setFormErrors({}); setDialogOpen(true); };
  const openEdit = (person: StaffProfile) => {
    setForm({ id: person.id, firstName: person.first_name || "", lastName: person.last_name || "", middleName: person.middle_name || "", email: person.email || "", phone: person.phone || "", role: person.role === "owner" ? "owner" : person.role, position: person.position || roleLabel[person.role] || "" });
    setFormErrors({});
    setDialogOpen(true);
  };
  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    const errors = validateStaffForm(form);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return toast.error("Проверь обязательные поля");
    setSaving(true);
    try {
      await request({ action: form.id ? "update" : "create", userId: form.id || undefined, ...form });
      await queryClient.invalidateQueries({ queryKey: ["staff"] });
      setDialogOpen(false);
      toast.success(form.id ? "Данные сотрудника обновлены" : "Сотрудник создан. Временный пароль — последние 6 цифр телефона.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка"); }
    finally { setSaving(false); }
  };
  const copyAccess = async (person: StaffProfile) => {
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
      {isLoading ? <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div> : data.length === 0 ? <div className="p-12 text-center text-muted-foreground"><UserRoundCog className="mx-auto mb-3 h-9 w-9" />Сотрудники пока не добавлены</div> : data.map((person: StaffProfile) => <div key={person.id} className="grid gap-2 border-b px-5 py-4 text-sm lg:grid-cols-[1.4fr_1fr_1fr_1fr_1.3fr_120px_48px] lg:items-center"><span className="font-semibold">{`${person.first_name || ""} ${person.last_name || ""}`.trim() || "Без имени"}{person.id === current?.id && <Badge variant="outline" className="ml-2">Вы</Badge>}</span><span>{person.position || roleLabel[person.role]}</span><span><Badge variant={person.role === "owner" ? "default" : "secondary"}>{roleLabel[person.role] || person.role}</Badge></span><span>{person.phone || "—"}</span><span className="truncate">{person.email || "—"}</span><span>{!person.is_active ? <Badge variant="destructive">Отключён</Badge> : person.must_change_password ? <Badge variant="outline">Первый вход</Badge> : <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Активен</Badge>}</span><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => openEdit(person)}>Редактировать</DropdownMenuItem><DropdownMenuItem onClick={async () => { try { await request({ action: "reset-password", userId: person.id }); toast.success("Временный пароль сброшен. При входе сотрудник задаст новый."); } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка"); } }}>Сбросить пароль</DropdownMenuItem><DropdownMenuItem onClick={() => copyAccess(person)}>Скопировать данные для входа</DropdownMenuItem><DropdownMenuItem disabled={person.id === current?.id} onClick={async () => { try { await request({ action: "set-active", userId: person.id, active: !person.is_active }); await queryClient.invalidateQueries({ queryKey: ["staff"] }); toast.success(person.is_active ? "Доступ отключён" : "Доступ включён"); } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка"); } }}>{person.is_active ? "Отключить доступ" : "Включить доступ"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>)}</Card>

    <Dialog open={dialogOpen} onOpenChange={(open) => { if (!saving) setDialogOpen(open); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{form.id ? "Редактировать сотрудника" : "Новый сотрудник"}</DialogTitle>
          <DialogDescription>{form.id ? "Изменения обновят карточку и логин сотрудника." : "Система создаст карточку и учётную запись для входа. При первом входе сотрудник задаст собственный пароль."}</DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={save} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label>Имя *</Label><Input required aria-invalid={Boolean(formErrors.firstName)} value={form.firstName} onChange={e => { setForm({ ...form, firstName: e.target.value }); setFormErrors(({ firstName: _, ...rest }) => rest); }} />{formErrors.firstName && <p className="text-xs text-destructive">{formErrors.firstName}</p>}</div>
          <div className="space-y-2"><Label>Фамилия *</Label><Input required aria-invalid={Boolean(formErrors.lastName)} value={form.lastName} onChange={e => { setForm({ ...form, lastName: e.target.value }); setFormErrors(({ lastName: _, ...rest }) => rest); }} />{formErrors.lastName && <p className="text-xs text-destructive">{formErrors.lastName}</p>}</div>
          <div className="space-y-2 sm:col-span-2"><Label>Отчество</Label><Input value={form.middleName} onChange={e => setForm({ ...form, middleName: e.target.value })} /></div>
          <div className="space-y-2 sm:col-span-2"><Label>Email-логин *</Label><Input type="email" required autoComplete="off" aria-invalid={Boolean(formErrors.email)} placeholder="name@example.com" value={form.email} onChange={e => { setForm({ ...form, email: e.target.value }); setFormErrors(({ email: _, ...rest }) => rest); }} />{formErrors.email && <p className="text-xs text-destructive">{formErrors.email}</p>}</div>
          <div className="space-y-2"><Label>Телефон *</Label><Input type="tel" required autoComplete="off" inputMode="tel" aria-invalid={Boolean(formErrors.phone)} placeholder="+7 707 123 45 67" value={form.phone} onChange={e => { setForm({ ...form, phone: e.target.value }); setFormErrors(({ phone: _, ...rest }) => rest); }} />{formErrors.phone && <p className="text-xs text-destructive">{formErrors.phone}</p>}</div>
          <div className="space-y-2"><Label>Роль доступа</Label><Select value={form.role} disabled={form.id === current?.id} onValueChange={value => setForm({ ...form, role: value, position: form.id ? form.position : value === "trainer" ? "Тренер" : value === "owner" ? "Управляющий" : "Администратор" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="owner">Управляющий</SelectItem><SelectItem value="admin">Администратор</SelectItem><SelectItem value="trainer">Тренер</SelectItem></SelectContent></Select></div>
          <div className="space-y-2 sm:col-span-2"><Label>Должность</Label><Input value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} placeholder="Например: Ассистент руководителя" /></div>
        </div>
        <p className="text-xs text-muted-foreground">Временный пароль создаётся из последних 6 цифр телефона. После первого входа сотрудник задаст свой пароль.</p>
        <Button type="submit" className="w-full" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{saving ? "Сохраняем…" : form.id ? "Сохранить изменения" : "Создать сотрудника"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}
