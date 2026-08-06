import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, UserRound, Lock } from "lucide-react";
import { supabase } from "@/lib/supabase";

const TrainerLogin = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = async () => {
    if (!login || !password) return toast.error("Введите e-mail или телефон и пароль");
    setIsLoading(true);
    try {
      const cleanLogin = login.trim();
      const email = cleanLogin.includes("@")
        ? cleanLogin.toLocaleLowerCase("ru-RU")
        : `${cleanLogin.replace(/\D/g, "")}@balance.kz`;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Ошибка авторизации");

      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      if (profile?.role !== 'trainer') {
        await supabase.auth.signOut();
        throw new Error("У этого аккаунта нет прав тренера");
      }

      toast.success("Добро пожаловать!");
      navigate("/trainer");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Ошибка входа");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-sm border-none shadow-xl">
        <CardHeader className="text-center pb-2">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <span className="text-3xl">🏋️</span>
          </div>
          <CardTitle className="text-xl font-bold">Портал тренера</CardTitle>
          <CardDescription>Balance Yoga Studio</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label>E-mail или телефон</Label>
            <div className="relative">
              <UserRound className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <Input autoComplete="username" className="pl-9 h-11" value={login} onChange={e => setLogin(e.target.value)} placeholder="name@example.com" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Пароль</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <Input autoComplete="current-password" type="password" className="pl-9 h-11" value={password} onChange={e => setPassword(e.target.value)} placeholder="******" onKeyDown={event => { if (event.key === "Enter") void handleLogin(); }} />
            </div>
          </div>
          <Button className="w-full h-11" onClick={handleLogin} disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Войти
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default TrainerLogin;
