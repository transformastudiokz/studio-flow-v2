import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, CheckCircle2, MessageCircle, ChevronLeft, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";

const NewClient = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    plan_id: "none",
  });

  const [created, setCreated] = useState<{
    phone: string;
    password: string;
    name: string;
  } | null>(null);

  const { data: plans = [] } = useQuery({
    queryKey: ["subscription_plans_all"],
    queryFn: async () => {
      const { data } = await supabase
        .from("subscription_plans")
        .select("id, name, price, visits_count, duration_days")
        .order("price");
      return data || [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const cleanPhone = form.phone.replace(/\D/g, "");
      if (!form.first_name || cleanPhone.length < 10) {
        throw new Error("Введите имя и телефон (минимум 10 цифр)");
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Сессия сотрудника истекла. Войди повторно.");
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          action: "create",
          firstName: form.first_name,
          lastName: form.last_name,
          phone: cleanPhone,
          email: form.email,
          planId: form.plan_id,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось создать клиента");
      if (!payload.temporaryPassword) {
        throw new Error("Клиент уже существует. Открой его карточку вместо повторного создания.");
      }
      return { phone: payload.login, password: payload.temporaryPassword, name: form.first_name };
    },
    onSuccess: (result) => {
      setCreated(result);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["trial_clients"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const sendWhatsApp = () => {
    if (!created) return;
    const planName = form.plan_id === "none" ? null : plans.find((p: any) => p.id === form.plan_id)?.name;
    const lines = [
      `Здравствуйте, ${created.name}!`,
      ``,
      `Ваши данные для входа в Balance Yoga Studio:`,
      `📱 Логин: ${created.phone}`,
      `🔑 Пароль: ${created.password}`,
      ``,
      ...(planName ? [`✅ Абонемент «${planName}» активирован`, ``] : []),
      `Ссылка для входа: ${window.location.origin}/portal/login`,
    ];
    const text = lines.join("\n");
    const phone = created.phone.startsWith("8")
      ? "7" + created.phone.slice(1)
      : created.phone;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
  };

  if (created) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 animate-in fade-in text-center px-4 pb-8">
        <CheckCircle2 className="w-20 h-20 text-green-500" />
        <div>
          <h2 className="text-2xl font-bold">Клиент создан!</h2>
          <p className="text-muted-foreground mt-1">{created.name}</p>
        </div>

        <Card className="w-full max-w-sm text-left">
          <CardContent className="pt-5 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Логин</span>
              <span className="font-mono font-semibold">{created.phone}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Пароль</span>
              <span className="font-mono font-semibold">{created.password}</span>
            </div>
            {form.plan_id !== "none" ? (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Абонемент</span>
                <span className="font-semibold">{plans.find((p: any) => p.id === form.plan_id)?.name}</span>
              </div>
            ) : <div className="flex justify-between"><span className="text-muted-foreground">Абонемент</span><span className="font-semibold text-orange-600">Не оформлен</span></div>}
          </CardContent>
        </Card>

        <Button className="w-full max-w-sm rounded-2xl h-12 bg-green-500 hover:bg-green-600" onClick={sendWhatsApp}>
          <MessageCircle className="mr-2 w-5 h-5" />
          Отправить в WhatsApp
        </Button>

        <div className="flex gap-3 w-full max-w-sm">
          <Button
            variant="outline"
            className="flex-1 rounded-2xl"
            onClick={() => {
              setCreated(null);
              setForm({ first_name: "", last_name: "", phone: "", email: "", plan_id: "none" });
            }}
          >
            <UserPlus className="mr-2 w-4 h-4" /> Ещё клиент
          </Button>
          <Button variant="ghost" className="flex-1 rounded-2xl" onClick={() => navigate("/clients")}>
            К клиентам
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in pb-8 max-w-lg">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Новый клиент</h1>
          <p className="text-sm text-muted-foreground">Создать карточку сейчас, абонемент можно оформить позже</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Имя *</Label>
            <Input
              placeholder="Айгерим"
              value={form.first_name}
              onChange={(e) => setForm({ ...form, first_name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Фамилия</Label>
            <Input
              placeholder="Иванова"
              value={form.last_name}
              onChange={(e) => setForm({ ...form, last_name: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Телефон *</Label>
          <Input
            placeholder="77012345678"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Логин = номер телефона · Пароль = yoga + последние 4 цифры
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Email (необязательно)</Label>
          <Input
            type="email"
            placeholder="client@mail.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Если не указан — используется {form.phone ? `${form.phone.replace(/\D/g, "")}@balance.kz` : "телефон@balance.kz"}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Абонемент</Label>
          <Select value={form.plan_id} onValueChange={(v) => setForm({ ...form, plan_id: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Выбрать абонемент" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Без абонемента — оформить позже</SelectItem>
              {plans.map((p: any) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} — {p.price.toLocaleString()} ₸ · {p.visits_count} зан.
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {form.phone && (
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="pt-4 pb-3 text-sm space-y-1">
              <p className="font-semibold text-blue-800">Данные для входа клиента:</p>
              <p className="text-blue-700">
                Логин: <span className="font-mono">{form.phone.replace(/\D/g, "")}</span>
              </p>
              <p className="text-blue-700">
                Пароль: <span className="font-mono">yoga{form.phone.replace(/\D/g, "").slice(-4)}</span>
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <Button
        className="w-full h-12 rounded-2xl text-base"
        onClick={() => createMutation.mutate()}
        disabled={createMutation.isPending}
      >
        {createMutation.isPending && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
        {form.plan_id === "none" ? "Создать клиента без абонемента" : "Создать клиента и оформить абонемент"}
      </Button>
    </div>
  );
};

export default NewClient;
