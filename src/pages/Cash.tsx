import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { endOfDay, format, parseISO, startOfDay, subDays } from "date-fns";
import { ru } from "date-fns/locale";
import { ArrowDownLeft, ArrowUpRight, CircleDollarSign, ExternalLink, Loader2, MoreHorizontal } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatResponsibleShortName } from "@/lib/person-name";
import { excludeTechnicalCorrectionPairs } from "@/lib/cash-ledger";
import { toast } from "sonner";

const labels: Record<string, string> = { sale: "Продажа", upgrade: "Замена абонемента", refund: "Возврат", correction: "Корректировка", manual: "Операция", rental_payment: "Аренда", rental_refund: "Возврат аренды" };
const paymentMethods: Record<string, string> = { kaspi: "Kaspi", halyk: "Halyk", cash: "Наличные", bank_account: "Расчётный счёт" };
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
  const [rentalPaymentMethod, setRentalPaymentMethod] = useState("kaspi");
  const [rentalPaymentDate, setRentalPaymentDate] = useState(today);
  const [clientPreview, setClientPreview] = useState<any>(null);
  const [commentSource, setCommentSource] = useState<any>(null);
  const [commentText, setCommentText] = useState("");
  useEffect(() => {
    if (!source?.rental_booking_id) return;
    setRentalPaymentMethod(source.payment_method || "kaspi");
    setRentalPaymentDate(format(parseISO(source.occurred_at), "yyyy-MM-dd"));
  }, [source]);
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["cash_transactions", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.from("cash_transactions").select(`id, occurred_at, operation_type, title, amount, notes, payment_method, rental_booking_id, related_transaction_id, client_id, subscription_id, client:profiles!cash_transactions_client_id_fkey(first_name,last_name,phone,email), responsible:profiles!cash_transactions_responsible_user_id_fkey(first_name,last_name), comments:cash_transaction_comments(id,comment,created_at,author:profiles!cash_transaction_comments_author_user_id_fkey(first_name,last_name))`).gte("occurred_at", startOfDay(new Date(`${from}T00:00:00`)).toISOString()).lte("occurred_at", endOfDay(new Date(`${to}T00:00:00`)).toISOString()).order("occurred_at", { ascending: false });
      if (error) throw error;
      const { data: correctionReversals, error: correctionError } = await supabase
        .from("cash_transactions")
        .select("id,operation_type,notes,related_transaction_id")
        .eq("operation_type", "rental_refund")
        .not("related_transaction_id", "is", null)
        .ilike("notes", "Сторно перед корректировкой:%");
      if (correctionError) throw correctionError;
      return excludeTechnicalCorrectionPairs(data || [], correctionReversals || []);
    },
  });
  const totals = useMemo(() => data.reduce((acc: { income: number; refunds: number }, row: any) => {
    const amount = Number(row.amount || 0); if (amount >= 0) acc.income += amount; else acc.refunds += Math.abs(amount); return acc;
  }, { income: 0, refunds: 0 }), [data]);
  const grouped = useMemo(() => data.reduce((acc: Record<string, any[]>, row: any) => { const key = format(parseISO(row.occurred_at), "yyyy-MM-dd"); (acc[key] ||= []).push(row); return acc; }, {}), [data]);
  const { data: plans = [] } = useQuery({ queryKey: ["cash_plans"], queryFn: async () => { const { data } = await supabase.from("subscription_plans").select("id,name,price").eq("is_active", true).order("name"); return data || []; } });
  const { data: clientSubscriptions = [], isLoading: clientLoading } = useQuery({ queryKey: ["cash_client_subscriptions", clientPreview?.client_id], enabled: Boolean(clientPreview?.client_id), queryFn: async () => { const { data, error } = await supabase.from("user_subscriptions").select("id,visits_total,visits_remaining,start_date,end_date,is_active,plan:subscription_plans(name)").eq("user_id", clientPreview.client_id).order("created_at", { ascending: false }); if (error) throw error; return data || []; } });
  const correction = useMutation({ mutationFn: async () => { if (!source) return; if (!amount || Number(amount) <= 0) throw new Error("Укажи сумму"); if (!notes.trim()) throw new Error("Укажи причину"); if (source.rental_booking_id) { const { error } = await supabase.rpc("correct_rental_payment", { p_transaction_id: source.id, p_new_amount: Number(amount), p_new_method: rentalPaymentMethod, p_new_occurred_at: new Date(`${rentalPaymentDate}T12:00:00`).toISOString(), p_reason: notes.trim() }); if (error) throw error; return; } if (operation === "upgrade" && !newPlanId) throw new Error("Выбери новый абонемент"); const { error } = await supabase.rpc("adjust_subscription_from_cash", { p_transaction_id: source.id, p_operation_type: operation, p_amount: Number(amount), p_notes: notes.trim(), p_new_plan_id: operation === "upgrade" ? newPlanId : null, p_deactivate: operation === "refund" }); if (error) throw error; }, onSuccess: async () => { toast.success("Корректировка сохранена отдельной операцией"); setSource(null); setAmount(""); setNotes(""); setNewPlanId(""); await queryClient.invalidateQueries({ queryKey: ["cash_transactions"] }); }, onError: (error: Error) => toast.error(error.message) });
  const annul = useMutation({ mutationFn: async (row: any) => { if (!window.confirm("Аннулировать эту операцию? Исходная строка останется в истории, а касса создаст обратную операцию.")) return false; const rowAmount = Number(row.amount); if (row.rental_booking_id) { if (rowAmount <= 0) throw new Error("Возврат аренды нельзя аннулировать этим действием"); const { error } = await supabase.rpc("refund_rental_payment", { p_transaction_id: row.id, p_amount: Math.abs(rowAmount), p_method: row.payment_method || "cash", p_occurred_at: new Date().toISOString(), p_reason: "Аннулирование операции" }); if (error) throw error; return true; } const { error } = await supabase.rpc("adjust_subscription_from_cash", { p_transaction_id: row.id, p_operation_type: rowAmount >= 0 ? "refund" : "correction", p_amount: Math.abs(rowAmount), p_notes: "Аннулирование операции", p_new_plan_id: null, p_deactivate: rowAmount >= 0 }); if (error) throw error; return true; }, onSuccess: async result => { if (!result) return; toast.success("Операция аннулирована с сохранением истории"); await queryClient.invalidateQueries({ queryKey: ["cash_transactions"] }); }, onError: (error: Error) => toast.error(error.message) });
  const addComment = useMutation({ mutationFn: async () => { if (!commentSource) return; const comment = commentText.trim(); if (!comment) throw new Error("Напиши комментарий"); const { error } = await supabase.from("cash_transaction_comments").insert({ transaction_id: commentSource.id, comment }); if (error) throw error; }, onSuccess: async () => { toast.success("Комментарий добавлен без новой финансовой операции"); setCommentSource(null); setCommentText(""); await queryClient.invalidateQueries({ queryKey: ["cash_transactions"] }); }, onError: (error: Error) => toast.error(error.message) });
  const setQuickDate = (date: Date) => { const value = format(date, "yyyy-MM-dd"); setFrom(value); setTo(value); };

  return <div className="space-y-6 animate-in fade-in">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-bold">Касса</h1><p className="mt-1 text-muted-foreground">Неизменяемая история продаж, возвратов и корректировок</p></div><div className="flex flex-wrap items-center gap-2"><Button variant={from === today && to === today ? "default" : "outline"} onClick={() => setQuickDate(new Date())}>Сегодня</Button><Button variant={from === format(subDays(new Date(), 1), "yyyy-MM-dd") && to === from ? "default" : "outline"} onClick={() => setQuickDate(subDays(new Date(), 1))}>Вчера</Button><Input className="w-auto" type="date" value={from} onChange={e => setFrom(e.target.value)} /><Input className="w-auto" type="date" value={to} onChange={e => setTo(e.target.value)} /></div></div>
    <div className="grid gap-4 md:grid-cols-3">
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Поступления</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-emerald-600">{money(totals.income)}</CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Возвраты</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-red-600">{money(totals.refunds)}</CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Итог</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{money(totals.income - totals.refunds)}</CardContent></Card>
    </div>
    <Card className="overflow-hidden"><div className="hidden grid-cols-[140px_150px_1fr_1.4fr_140px_1fr_48px] gap-4 border-b bg-muted/40 px-5 py-3 text-xs font-semibold text-muted-foreground lg:grid"><span>Дата и время</span><span>Операция</span><span>Клиент</span><span>Основание</span><span className="text-right">Сумма</span><span>Ответственный</span><span /></div>
      {isLoading ? <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div> : error ? <div className="p-8 text-center text-red-600">Не удалось загрузить кассу</div> : data.length === 0 ? <div className="p-12 text-center text-muted-foreground"><CircleDollarSign className="mx-auto mb-3 h-9 w-9" />За выбранный период операций нет</div> : Object.entries(grouped).map(([date, rows]) => <section key={date}><div className="border-y bg-slate-50 px-5 py-2 text-sm font-semibold capitalize">{format(new Date(`${date}T00:00:00`), "d MMMM yyyy", { locale: ru })}</div>{rows.map((row: any) => { const rowAmount = Number(row.amount); const client = Array.isArray(row.client) ? row.client[0] : row.client; const responsible = Array.isArray(row.responsible) ? row.responsible[0] : row.responsible; const comments = [...(row.comments || [])].sort((left: any, right: any) => parseISO(left.created_at).getTime() - parseISO(right.created_at).getTime()); return <div key={row.id} className="grid gap-2 border-b px-5 py-4 text-sm lg:grid-cols-[140px_150px_1fr_1.4fr_140px_1fr_48px] lg:items-center"><span className="text-muted-foreground">{format(parseISO(row.occurred_at), "dd.MM.yyyy HH:mm")}</span><span className="flex items-center gap-2 font-medium">{rowAmount < 0 ? <ArrowDownLeft className="h-4 w-4 text-red-500" /> : <ArrowUpRight className="h-4 w-4 text-emerald-500" />}{labels[row.operation_type] || row.operation_type}</span><button type="button" className="text-left font-medium hover:text-primary hover:underline" onClick={() => setClientPreview({ ...row, client })}>{client ? `${client.first_name || ""} ${client.last_name || ""}`.trim() : "Клиент"}</button><span><span className="block font-medium">{row.title}</span>{row.notes && <span className="block text-xs text-muted-foreground">{row.notes}</span>}{comments.map((comment: any) => { const author = Array.isArray(comment.author) ? comment.author[0] : comment.author; return <span key={comment.id} className="mt-1 block text-xs text-slate-600"><span className="font-medium">Комментарий{author ? ` · ${formatResponsibleShortName(author)}` : ""}:</span> {comment.comment}</span>; })}</span><span className={cn("text-right font-semibold tabular-nums", rowAmount < 0 ? "text-red-600" : "text-emerald-600")}>{money(rowAmount)}</span><span title={responsible ? `${responsible.first_name || ""} ${responsible.last_name || ""}`.trim() : undefined}>{formatResponsibleShortName(responsible)}</span><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Действия с операцией"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => { setCommentSource(row); setCommentText(""); }}>Добавить комментарий</DropdownMenuItem><DropdownMenuItem onClick={() => { setSource(row); setAmount(String(Math.abs(rowAmount))); setOperation("refund"); setNotes(""); }}>Изменить / скорректировать</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="text-red-600" onClick={() => annul.mutate(row)}>Аннулировать операцию</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>; })}</section>)}</Card>
    <Dialog open={Boolean(commentSource)} onOpenChange={open => { if (!open) { setCommentSource(null); setCommentText(""); } }}><DialogContent><DialogHeader><DialogTitle>Добавить комментарий</DialogTitle><DialogDescription>Комментарий будет привязан к этой оплате. Сумма, абонемент и итоги кассы не изменятся.</DialogDescription></DialogHeader><div className="space-y-4"><div className="rounded-lg bg-muted p-3 text-sm"><strong>{commentSource?.title}</strong><div className="text-muted-foreground">{money(Number(commentSource?.amount || 0))}</div></div><div className="space-y-2"><Label>Комментарий</Label><Textarea autoFocus value={commentText} onChange={event => setCommentText(event.target.value)} placeholder="Добавь важную информацию об оплате" /></div><Button className="w-full" onClick={() => addComment.mutate()} disabled={addComment.isPending}>{addComment.isPending ? "Сохранение…" : "Добавить комментарий"}</Button></div></DialogContent></Dialog>
    <Dialog open={Boolean(source)} onOpenChange={open => !open && setSource(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Создать корректировку</DialogTitle>
          <DialogDescription>Исходная операция сохранится. Новое действие появится отдельной связанной строкой.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg bg-muted p-3 text-sm"><strong>{source?.title}</strong><div className="text-muted-foreground">Исходная сумма: {money(Number(source?.amount || 0))}</div></div>
          {source?.rental_booking_id ? (
            <div className="rounded-lg border bg-amber-50/50 p-3 text-sm text-muted-foreground">Корректировка аренды создаст сторно исходного платежа и новую строку. История кассы сохранится полностью.</div>
          ) : (
            <div className="space-y-2"><Label>Действие</Label><Select value={operation} onValueChange={(value: any) => setOperation(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="refund">Возврат</SelectItem><SelectItem value="upgrade">Замена абонемента / доплата</SelectItem><SelectItem value="correction">Финансовая корректировка</SelectItem></SelectContent></Select></div>
          )}
          {!source?.rental_booking_id && operation === "upgrade" ? <div className="space-y-2"><Label>Новый абонемент</Label><Select value={newPlanId} onValueChange={setNewPlanId}><SelectTrigger><SelectValue placeholder="Выбери абонемент" /></SelectTrigger><SelectContent>{plans.map((plan: any) => <SelectItem key={plan.id} value={plan.id}>{plan.name} · {money(Number(plan.price))}</SelectItem>)}</SelectContent></Select></div> : null}
          <div className="space-y-2"><Label>{!source?.rental_booking_id && operation === "upgrade" ? "Доплата" : "Сумма"}</Label><Input type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} /></div>
          {source?.rental_booking_id ? <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Способ оплаты</Label><Select value={rentalPaymentMethod} onValueChange={setRentalPaymentMethod}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(paymentMethods).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Дата оплаты</Label><Input type="date" value={rentalPaymentDate} onChange={event => setRentalPaymentDate(event.target.value)} /></div></div> : null}
          <div className="space-y-2"><Label>Причина</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Почему оформляется изменение" /></div>
          <Button className="w-full" onClick={() => correction.mutate()} disabled={correction.isPending}>{correction.isPending ? "Сохранение…" : "Подтвердить корректировку"}</Button>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(clientPreview)} onOpenChange={open => !open && setClientPreview(null)}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>{clientPreview?.client ? `${clientPreview.client.first_name || ""} ${clientPreview.client.last_name || ""}`.trim() : "Карточка клиента"}</DialogTitle><DialogDescription>{clientPreview?.client?.phone || "Телефон не указан"}{clientPreview?.client?.email ? ` · ${clientPreview.client.email}` : ""}</DialogDescription></DialogHeader><div className="space-y-4"><div className="flex items-center justify-between"><h3 className="font-semibold">Абонементы</h3>{clientPreview?.client_id && <Button asChild variant="outline" size="sm"><Link to={`/clients/${clientPreview.client_id}`}>Полная карточка <ExternalLink className="ml-2 h-3.5 w-3.5" /></Link></Button>}</div>{clientLoading ? <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div> : clientSubscriptions.length === 0 ? <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">У клиента нет абонементов</div> : <div className="max-h-[360px] space-y-2 overflow-y-auto">{clientSubscriptions.map((subscription: any) => { const plan = Array.isArray(subscription.plan) ? subscription.plan[0] : subscription.plan; return <div key={subscription.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{plan?.name || "Абонемент"}</p><p className="mt-1 text-sm text-muted-foreground">Осталось {subscription.visits_remaining} из {subscription.visits_total} занятий</p><p className="mt-1 text-xs text-muted-foreground">{subscription.start_date || "—"} — {subscription.end_date || "без срока"}</p></div><Badge variant={subscription.is_active ? "default" : "secondary"}>{subscription.is_active ? "Активен" : "Завершён"}</Badge></div></div>; })}</div>}<Button className="w-full" onClick={() => { const row = clientPreview; setClientPreview(null); setSource(row); setAmount(String(Math.abs(Number(row.amount)))); setOperation("upgrade"); setNotes(""); }}>Скорректировать абонемент</Button></div></DialogContent></Dialog>
  </div>;
}
