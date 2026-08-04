import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { endOfDay, format, parseISO, startOfDay } from "date-fns";
import { ru } from "date-fns/locale";
import { ArrowDownLeft, ArrowUpRight, CircleDollarSign, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const labels: Record<string, string> = { sale: "Продажа", upgrade: "Замена абонемента", refund: "Возврат", correction: "Корректировка", manual: "Операция" };
const money = (value: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "KZT", maximumFractionDigits: 0 }).format(value);

export default function Cash() {
  const queryClient = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [source, setSource] = useState<any>(null);
  const [operation, setOperation] = useState<"refund" | "upgrade" | "correction">("refund");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [newPlanId, setNewPlanId] = useState("");
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["cash_transactions", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.from("cash_transactions").select(`id, occurred_at, operation_type, title, amount, notes, related_transaction_id, client:profiles!cash_transactions_client_id_fkey(first_name,last_name), responsible:profiles!cash_transactions_responsible_user_id_fkey(first_name,last_name)`).gte("occurred_at", startOfDay(new Date(`${from}T00:00:00`)).toISOString()).lte("occurred_at", endOfDay(new Date(`${to}T00:00:00`)).toISOString()).order("occurred_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  const totals = useMemo(() => data.reduce((acc: { income: number; refunds: number }, row: any) => {
    const amount = Number(row.amount || 0); if (amount >= 0) acc.income += amount; else acc.refunds += Math.abs(amount); return acc;
  }, { income: 0, refunds: 0 }), [data]);
  const grouped = useMemo(() => data.reduce((acc: Record<string, any[]>, row: any) => { const key = format(parseISO(row.occurred_at), "yyyy-MM-dd"); (acc[key] ||= []).push(row); return acc; }, {}), [data]);
  const { data: plans = [] } = useQuery({ queryKey: ["cash_plans"], queryFn: async () => { const { data } = await supabase.from("subscription_plans").select("id,name,price").eq("is_active", true).order("name"); return data || []; } });
  const correction = useMutation({ mutationFn: async () => { if (!source) return; if (!amount || Number(amount) < 0) throw new Error("Укажи сумму"); if (!notes.trim()) throw new Error("Укажи причину"); if (operation === "upgrade" && !newPlanId) throw new Error("Выбери новый абонемент"); const { error } = await supabase.rpc("adjust_subscription_from_cash", { p_transaction_id: source.id, p_operation_type: operation, p_amount: Number(amount), p_notes: notes.trim(), p_new_plan_id: operation === "upgrade" ? newPlanId : null, p_deactivate: operation === "refund" }); if (error) throw error; }, onSuccess: async () => { toast.success("Корректировка сохранена отдельной операцией"); setSource(null); setAmount(""); setNotes(""); setNewPlanId(""); await queryClient.invalidateQueries({ queryKey: ["cash_transactions"] }); }, onError: (error: Error) => toast.error(error.message) });

  return <div className="space-y-6 animate-in fade-in">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-bold">Касса</h1><p className="mt-1 text-muted-foreground">Неизменяемая история продаж, возвратов и корректировок</p></div><div className="flex gap-2"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div></div>
    <div className="grid gap-4 md:grid-cols-3">
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Поступления</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-emerald-600">{money(totals.income)}</CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Возвраты</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-red-600">{money(totals.refunds)}</CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Итог</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{money(totals.income - totals.refunds)}</CardContent></Card>
    </div>
    <Card className="overflow-hidden"><div className="hidden grid-cols-[140px_150px_1fr_1.4fr_140px_1fr_150px] gap-4 border-b bg-muted/40 px-5 py-3 text-xs font-semibold text-muted-foreground lg:grid"><span>Дата и время</span><span>Операция</span><span>Клиент</span><span>Основание</span><span className="text-right">Сумма</span><span>Ответственный</span><span /></div>
      {isLoading ? <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div> : error ? <div className="p-8 text-center text-red-600">Не удалось загрузить кассу</div> : data.length === 0 ? <div className="p-12 text-center text-muted-foreground"><CircleDollarSign className="mx-auto mb-3 h-9 w-9" />За выбранный период операций нет</div> : Object.entries(grouped).map(([date, rows]) => <section key={date}><div className="border-y bg-slate-50 px-5 py-2 text-sm font-semibold capitalize">{format(new Date(`${date}T00:00:00`), "d MMMM yyyy", { locale: ru })}</div>{rows.map((row: any) => { const rowAmount = Number(row.amount); const client = Array.isArray(row.client) ? row.client[0] : row.client; const responsible = Array.isArray(row.responsible) ? row.responsible[0] : row.responsible; return <div key={row.id} className="grid gap-2 border-b px-5 py-4 text-sm lg:grid-cols-[140px_150px_1fr_1.4fr_140px_1fr_150px] lg:items-center"><span className="text-muted-foreground">{format(parseISO(row.occurred_at), "dd.MM.yyyy HH:mm")}</span><span className="flex items-center gap-2 font-medium">{rowAmount < 0 ? <ArrowDownLeft className="h-4 w-4 text-red-500" /> : <ArrowUpRight className="h-4 w-4 text-emerald-500" />}{labels[row.operation_type] || row.operation_type}</span><span>{client ? `${client.first_name || ""} ${client.last_name || ""}`.trim() : "Клиент"}</span><span><span className="block font-medium">{row.title}</span>{row.notes && <span className="text-xs text-muted-foreground">{row.notes}</span>}</span><span className={cn("text-right font-semibold tabular-nums", rowAmount < 0 ? "text-red-600" : "text-emerald-600")}>{money(rowAmount)}</span><span>{responsible ? `${responsible.first_name || ""} ${responsible.last_name || ""}`.trim() : "Импортировано"}</span><Button variant="outline" size="sm" onClick={() => { setSource(row); setAmount(String(Math.abs(rowAmount))); setOperation("refund"); }}>Скорректировать</Button></div>; })}</section>)}</Card>
    <Dialog open={Boolean(source)} onOpenChange={open => !open && setSource(null)}><DialogContent><DialogHeader><DialogTitle>Создать корректировку</DialogTitle><DialogDescription>Исходная операция сохранится. Новое действие появится отдельной связанной строкой.</DialogDescription></DialogHeader><div className="space-y-4"><div className="rounded-lg bg-muted p-3 text-sm"><strong>{source?.title}</strong><div className="text-muted-foreground">Исходная сумма: {money(Number(source?.amount || 0))}</div></div><div className="space-y-2"><Label>Действие</Label><Select value={operation} onValueChange={(value: any) => setOperation(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="refund">Возврат</SelectItem><SelectItem value="upgrade">Замена абонемента / доплата</SelectItem><SelectItem value="correction">Финансовая корректировка</SelectItem></SelectContent></Select></div>{operation === "upgrade" && <div className="space-y-2"><Label>Новый абонемент</Label><Select value={newPlanId} onValueChange={setNewPlanId}><SelectTrigger><SelectValue placeholder="Выбери абонемент" /></SelectTrigger><SelectContent>{plans.map((plan: any) => <SelectItem key={plan.id} value={plan.id}>{plan.name} · {money(Number(plan.price))}</SelectItem>)}</SelectContent></Select></div>}<div className="space-y-2"><Label>{operation === "upgrade" ? "Доплата" : "Сумма"}</Label><Input type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} /></div><div className="space-y-2"><Label>Причина</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Почему оформляется изменение" /></div><Button className="w-full" onClick={() => correction.mutate()} disabled={correction.isPending}>{correction.isPending ? "Сохранение…" : "Подтвердить корректировку"}</Button></div></DialogContent></Dialog>
  </div>;
}
