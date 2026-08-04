import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const Login = () => {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    let cleanLogin = login.trim();
    
    // Превращаем номер в "технический email" если введен телефон
    // (Или используем логин админа, если ты создавал его через email)
    if (!cleanLogin.includes("@")) {
      // Предполагаем, что админ тоже входит по номеру телефона в формате email
      cleanLogin = cleanLogin.replace(/\D/g, ''); 
      cleanLogin = `${cleanLogin}@balance.kz`; // Используем тот же домен, что и у клиентов
    }

    // 1. Авторизация
    const { error } = await supabase.auth.signInWithPassword({
      email: cleanLogin,
      password: password
    });

    if (error) {
      toast.error("Ошибка входа", { description: "Неверный логин или пароль" });
      setLoading(false);
      return;
    }

    // 2. Проверка прав (В новой таблице PROFILES)
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('role, is_active, must_change_password')
          .eq('id', user.id)
          .single();

        if (profileError || !['admin', 'owner', 'trainer'].includes(profile?.role) || profile?.is_active === false) {
          console.error("Ошибка прав:", profileError);
          toast.error("Доступ запрещен", { description: "У этого аккаунта нет прав администратора" });
          await supabase.auth.signOut(); // Выкидываем сразу
        } else {
          toast.success("Добро пожаловать!");
          if (profile.must_change_password) navigate("/change-password");
          else navigate(profile.role === 'trainer' ? "/trainer/schedule" : "/dashboard");
        }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 p-4">
      <Card className="w-full max-w-md shadow-2xl border-gray-800 bg-gray-950 text-white">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold text-green-500">Admin Panel</CardTitle>
          <CardDescription className="text-gray-400">Вход для персонала</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="text" 
              placeholder="Email или телефон"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                className="bg-gray-900 border-gray-700 text-white h-12"
                required
              />
            </div>
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="Пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-gray-900 border-gray-700 text-white h-12"
                required
              />
            </div>
            <Button type="submit" className="w-full h-12 text-lg bg-green-600 hover:bg-green-700" disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : "Войти"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
