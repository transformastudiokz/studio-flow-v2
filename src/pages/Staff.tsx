import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MoreHorizontal, ShieldCheck, UserRoundCog, UsersRound } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCurrentProfile } from "@/hooks/use-current-profile";
import { toast } from "sonner";

const roleLabel: Record<string, string> = { owner: "Управляющий", admin: "Администратор", trainer: "Тренер" };
const initialStaff = [
  { firstName: "Амангельды", lastName: "Мариям", email: "amangeldimariyam@gmail.com", phone: "77074807448", role: "admin", position: "Ассистент руководителя" },
  { firstName: "Балтабай", lastName: "Акмейир Есимхановна", email: "coconutshake173@gmail.com", phone: "77024513507", role: "admin", position: "Администратор" },
  { firstName: "Тлеубердинова", lastName: "Айым Абаевна", email: "aiymtleuberdinova@gmail.com", phone: "77071113687", role: "admin", position: "Администратор" },
  { firstName: "Рабаева", lastName: "Аида Ерлановна", email: "aidarabaeva046@gmail.com", phone: "77771724640", role: "admin", position: "Администратор" },
  { firstName: "Ахмедова", lastName: "София Данияровна", email: "cofa.300871@mail.ru", phone: "+77010849939", role: "trainer", position: "Тренер", coachId: "205d5092-e649-49c8-837a-b5f97e18e027" },
  { firstName: "Бекбосынова", lastName: "Ажар Маратовна", email: "azhar.m1811@gmail.com", phone: "+77774619800", role: "trainer", position: "Тренер", coachId: "af4e8f09-e8e1-453c-9204-44c16e866685" },
  { firstName: "Дауренбекова", lastName: "Хорлан Бекетовна", email: "horlan639@gmail.com", phone: "+77072612721", role: "trainer", position: "Тренер", coachId: "b06d2cd6-b14a-47d9-ab58-fe2900a679bd" },
  { firstName: "Ким", lastName: "Наталья Олеговна", email: "Tasha0905@gmail.com", phone: "+77710200210", role: "trainer", position: "Тренер", coachId: "8163e83f-7675-4c3e-8fa6-6691fa16bd03" },
  { firstName: "Назарбеков", lastName: "Батырбек Ерсаинович", email: "nazbatir@mail.ru", phone: "+77055655249", role: "trainer", position: "Тренер", coachId: "e3f89d37-3513-4d12-b54d-134f3b15f653" },
  { firstName: "Нурханова", lastName: "Тумар Максатовна", email: "tumarnurkhanova@gmail.com", phone: "+77711444413", role: "trainer", position: "Тренер", coachId: "bec80802-98d5-4245-91d0-9ff0027d1a6b" },
  { firstName: "Темір", lastName: "Айкерім Рамазаңқызы", email: "aikerimyesset@gmail.com", phone: "+77024876080", role: "trainer", position: "Тренер", coachId: "ec5faab4-d519-4505-aa6d-43480d00c383" },
  { firstName: "Шарипова", lastName: "Анель", email: "asharipova2007@gmail.com", phone: "+77711273772", role: "trainer", position: "Тренер", coachId: "06b167fd-96e4-4697-a6da-ae2961a0333d" },
  { firstName: "Шахманова", lastName: "Акнур Кошербаевна", email: "shahmanaknur@gmail.com", phone: "+77754849893", role: "trainer", position: "Тренер", coachId: "8b7551e1-48d0-499f-b246-9338855115ab" },
] as const;

export default function Staff() {
  const queryClient = useQueryClient();
  const [importing, setImporting] = useState(false);
  const { data: current } = useCurrentProfile();
  const { data = [], isLoading } = useQuery({
    queryKey: ["staff"],
    enabled: current?.role === "owner",
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id,first_name,last_name,phone,email,role,position,is_active,must_change_password").in("role", ["owner", "admin", "trainer"]).order("first_name");
      if (error) throw error; return data || [];
    },
  });
  if (current && current.role !== "owner") return <div className="rounded-xl border bg-white p-10 text-center"><ShieldCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground" /><h1 className="text-xl font-semibold">Доступ только управляющему</h1><p className="mt-2 text-muted-foreground">Сотрудники и их права защищены от изменений администраторами.</p></div>;
  const request = async (body: Record<string, unknown>) => { const { data: { session } } = await supabase.auth.getSession(); const response = await fetch("/api/staff", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` }, body: JSON.stringify(body) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Ошибка"); return payload; };
  const importStaff = async () => { setImporting(true); let created = 0; const errors: string[] = []; for (const employee of initialStaff) { try { await request({ action: "upsert", ...employee }); created += 1; } catch (error) { errors.push(`${employee.firstName}: ${error instanceof Error ? error.message : "ошибка"}`); } } await queryClient.invalidateQueries({ queryKey: ["staff"] }); setImporting(false); if (created) toast.success(`Создано учётных записей: ${created}`); if (errors.length) toast.warning(`Не создано: ${errors.length}. Возможно, учётки уже существуют.`); };
  return <div className="space-y-6 animate-in fade-in"><div className="flex items-start justify-between gap-4"><div><h1 className="text-3xl font-bold">Сотрудники</h1><p className="mt-1 text-muted-foreground">Учётные записи и уровни доступа команды</p></div><Button onClick={importStaff} disabled={importing || data.length > 1}>{importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UsersRound className="mr-2 h-4 w-4" />}Создать 13 учётных записей</Button></div>
    <Card className="overflow-hidden"><div className="hidden grid-cols-[1.4fr_1fr_1fr_1fr_1.3fr_120px_48px] gap-4 border-b bg-muted/40 px-5 py-3 text-xs font-semibold text-muted-foreground lg:grid"><span>Сотрудник</span><span>Должность</span><span>Роль</span><span>Телефон</span><span>Email-логин</span><span>Статус</span><span /></div>
      {isLoading ? <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div> : data.length === 0 ? <div className="p-12 text-center text-muted-foreground"><UserRoundCog className="mx-auto mb-3 h-9 w-9" />Сотрудники появятся после безопасного создания учётных записей</div> : data.map((person: any) => <div key={person.id} className="grid gap-2 border-b px-5 py-4 text-sm lg:grid-cols-[1.4fr_1fr_1fr_1fr_1.3fr_120px_48px] lg:items-center"><span className="font-semibold">{`${person.first_name || ""} ${person.last_name || ""}`.trim() || "Без имени"}{person.id === current?.id && <Badge variant="outline" className="ml-2">Вы</Badge>}</span><span>{person.position || roleLabel[person.role]}</span><span><Badge variant={person.role === "owner" ? "default" : "secondary"}>{roleLabel[person.role] || person.role}</Badge></span><span>{person.phone || "—"}</span><span className="truncate">{person.email || "—"}</span><span>{!person.is_active ? <Badge variant="destructive">Отключён</Badge> : person.must_change_password ? <Badge variant="outline">Первый вход</Badge> : <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Активен</Badge>}</span><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => toast.info("Изменение ФИО и роли добавлю после сверки состава")}>Редактировать</DropdownMenuItem><DropdownMenuItem onClick={async () => { try { await request({ action: "reset-password", userId: person.id }); toast.success("Временный пароль сброшен. При входе сотрудник задаст новый."); } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка"); } }}>Сбросить пароль</DropdownMenuItem><DropdownMenuItem disabled={person.id === current?.id} onClick={async () => { try { await request({ action: "set-active", userId: person.id, active: !person.is_active }); await queryClient.invalidateQueries({ queryKey: ["staff"] }); toast.success(person.is_active ? "Доступ отключён" : "Доступ включён"); } catch (error) { toast.error(error instanceof Error ? error.message : "Ошибка"); } }}>{person.is_active ? "Отключить доступ" : "Включить доступ"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>)}</Card>
  </div>;
}
