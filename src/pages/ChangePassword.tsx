import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LockKeyhole, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function ChangePassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 8) return toast.error("Новый пароль должен содержать минимум 8 символов");
    if (/^\d{6}$/.test(password)) return toast.error("Нельзя оставить временный пароль из 6 цифр");
    if (password !== repeat) return toast.error("Пароли не совпадают");
    setSaving(true);
    try {
      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) throw authError;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Сессия завершилась. Войдите снова.");
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", session.user.id).single();
      if (profile?.role === "trainer") {
        const response = await fetch("/api/trainer-auth", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ action: "password-changed" }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Не удалось завершить смену пароля");
      } else {
        const { error } = await supabase.from("profiles").update({ must_change_password: false }).eq("id", session.user.id);
        if (error) throw error;
      }
      toast.success("Пароль сохранён");
      navigate(profile?.role === "trainer" ? "/trainer/schedule" : "/dashboard", { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить пароль");
    } finally { setSaving(false); }
  };

  return <div className="min-h-screen bg-slate-950 p-4 flex items-center justify-center">
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><LockKeyhole /></div>
        <CardTitle>Создай постоянный пароль</CardTitle>
        <CardDescription>Временный пароль больше использовать нельзя. После сохранения откроется CRM.</CardDescription>
      </CardHeader>
      <CardContent><form onSubmit={submit} className="space-y-4">
        <div className="space-y-2"><Label>Новый пароль</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></div>
        <div className="space-y-2"><Label>Повтори пароль</Label><Input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" /></div>
        <Button className="w-full" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Сохранить и войти</Button>
      </form></CardContent>
    </Card>
  </div>;
}
