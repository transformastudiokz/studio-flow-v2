import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Phone, Lock, User } from "lucide-react";
import { supabase } from "@/lib/supabase";

const ClientLogin = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const normalizePhone = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
    if (digits.length === 10) return `7${digits}`;
    return digits;
  };

  const handleAuth = async (type: "login" | "register") => {
    if (!phone) return toast.error("Введите телефон");
    if (!password) return toast.error("Введите пароль");
    if (type === "register" && password.length < 6) return toast.error("Пароль должен быть не менее 6 символов");
    if (type === "register" && !firstName) return toast.error("Введите имя");

    setIsLoading(true);
    const cleanPhone = normalizePhone(phone);
    const email = `${cleanPhone}@balance.kz`;
    const pwd = password;

    try {
      if (type === "register") {
        // 1. Регистрируем в Supabase Auth
        // Мы передаем данные в metadata, чтобы Триггер в базе подхватил их
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email, 
          password: pwd,
          options: { 
            data: { 
              first_name: firstName, 
              last_name: lastName, 
              phone: cleanPhone 
            } 
          }
        });

        if (authError) throw authError;
        
        const userId = authData.user?.id;
        if (!userId) throw new Error("Ошибка регистрации");

        // 2. На всякий случай обновляем телефон в профиле явно
        // (хотя триггер должен был создать профиль, иногда метаданные могут не долететь)
        await supabase.from('profiles').update({ 
            phone: cleanPhone,
            first_name: firstName,
            last_name: lastName
        }).eq('id', userId);

        toast.success("Регистрация успешна!");
      } else {
        // Canonical login plus legacy aliases created by older CRM screens.
        // All new accounts use @balance.kz; the fallbacks keep old clients
        // able to sign in while their account is migrated by staff actions.
        const candidates = [email, `${cleanPhone}@balance.local`, `${cleanPhone}@auth.local`];
        let lastError: Error | null = null;
        let signedIn = false;
        for (const candidate of candidates) {
          const { error } = await supabase.auth.signInWithPassword({ email: candidate, password: pwd });
          if (!error) {
            signedIn = true;
            break;
          }
          lastError = error;
        }
        if (!signedIn) throw lastError || new Error("Неверный телефон или пароль");
        toast.success("С возвращением!");
      }
      
      // Переход в портал
      navigate("/portal");
      
    } catch (e: any) {
      toast.error(e.message || "Ошибка авторизации");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md border-none shadow-xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold text-primary">Balance Yoga</CardTitle>
          <CardDescription>Вход для клиентов</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="login">Вход</TabsTrigger>
              <TabsTrigger value="register">Регистрация</TabsTrigger>
            </TabsList>
            
            {/* ВХОД */}
            <TabsContent value="login" className="space-y-4">
              <div className="space-y-2">
                <Label>Телефон</Label>
                <div className="relative">
                    <Phone className="absolute left-3 top-3 h-4 w-4 text-slate-400"/>
                    <Input className="pl-9" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="777..." />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Пароль</Label>
                <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-400"/>
                    <Input type="password" className="pl-9" value={password} onChange={e=>setPassword(e.target.value)} placeholder="******" />
                </div>
              </div>
              <Button className="w-full" onClick={()=>handleAuth('login')} disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>} Войти
              </Button>
            </TabsContent>

            {/* РЕГИСТРАЦИЯ */}
            <TabsContent value="register" className="space-y-4">
               <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <Label>Имя</Label>
                    <Input placeholder="Иван" value={firstName} onChange={e=>setFirstName(e.target.value)} />
                 </div>
                 <div className="space-y-2">
                    <Label>Фамилия</Label>
                    <Input placeholder="Иванов" value={lastName} onChange={e=>setLastName(e.target.value)} />
                 </div>
               </div>
               
               <div className="space-y-2">
                 <Label>Телефон</Label>
                 <Input placeholder="777..." value={phone} onChange={e=>setPhone(e.target.value)} />
               </div>
               
               <div className="space-y-2">
                 <Label>Придумайте пароль</Label>
                 <Input type="password" placeholder="******" value={password} onChange={e=>setPassword(e.target.value)} />
               </div>

               <Button className="w-full" onClick={()=>handleAuth('register')} disabled={isLoading}>
                 {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>} Зарегистрироваться
               </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};
export default ClientLogin;
