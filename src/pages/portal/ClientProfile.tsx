import { ClientLayout } from "@/components/layout/ClientLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Loader2, LogOut, Phone } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useNavigate } from "react-router-dom";

const ClientProfile = () => {
  const navigate = useNavigate();

  // 1. Профиль
  const { data: client, isLoading, error: profileError } = useQuery({
    queryKey: ['my_client_profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Пользователь не авторизован");
      
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
        
      if (error) throw error;
      return data;
    },
    retry: 1
  });

  // 2. Абонементы
  const { data: subs = [] } = useQuery({
    queryKey: ['my_subs'],
    queryFn: async () => {
      if (!client?.id) return [];
      const { data } = await supabase
        .from('user_subscriptions')
        .select('*, plan:subscription_plans(name,duration_days)')
        .eq('user_id', client.id)
        .eq('is_active', true)
        .or('end_date.is.null,end_date.gte.' + new Date().toISOString().split('T')[0]); // Включаем неактивированные
      return data || [];
    },
    enabled: !!client?.id
  });

  // 3. История записей
  const { data: history = [] } = useQuery({
    queryKey: ['my_history'],
    queryFn: async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if(!user) return [];

        const { data } = await supabase
            .from('bookings')
            .select(`
                id, status, created_at,
                session:schedule_sessions(
                    start_time,
                    class_type:class_types(name)
                )
            `)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });
        return data || [];
    }
  });

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/portal/login");
  };

  if (isLoading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  if (profileError || !client) {
      return (
          <ClientLayout>
              <div className="p-6 text-center pt-20">
                  <h2 className="text-xl font-bold text-red-600 mb-2">Профиль не найден</h2>
                  <Button onClick={handleLogout}>Выйти</Button>
              </div>
          </ClientLayout>
      )
  }

  return (
    <ClientLayout>
      <div className="space-y-6 pb-20 px-4">
        <div className="flex items-center justify-between pt-4">
           <div className="flex items-center gap-4">
              <Avatar className="w-16 h-16 border-2 border-white shadow-sm">
                <AvatarFallback className="bg-blue-100 text-blue-600 text-xl font-bold">
                  {client?.first_name?.[0]}
                </AvatarFallback>
              </Avatar>
              <div>
                  <h1 className="text-xl font-bold">{client?.first_name} {client?.last_name}</h1>
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Phone className="w-3 h-3" /> {client?.phone}
                  </p>
              </div>
           </div>
           <Button variant="ghost" size="icon" onClick={handleLogout}><LogOut className="w-5 h-5 text-muted-foreground" /></Button>
        </div>

        <div>
           <h3 className="font-bold mb-3 text-lg">Мои абонементы</h3>
           <div className="space-y-3">
              {subs.length === 0 ? (
                <div className="p-4 bg-muted/30 rounded-xl text-center border border-dashed">
                   <p className="text-sm text-muted-foreground mb-2">Нет активных абонементов</p>
                   <Button size="sm" variant="outline" onClick={() => navigate('/portal/pricing')}>Купить</Button>
                </div>
              ) : (
                subs.map((sub: any) => (
                   <Card key={sub.id} className="bg-blue-600 text-white border-none shadow-md overflow-hidden relative rounded-xl">
                      <div className="absolute right-[-20px] top-[-20px] w-24 h-24 bg-white/10 rounded-full blur-2xl pointer-events-none" />
                      <CardContent className="p-5">
                          <div className="flex justify-between items-start mb-4">
                            <div>
                               <p className="text-xs opacity-80 uppercase font-medium">Тариф</p>
                               <h4 className="font-bold text-lg">{sub.plan?.name}</h4>
                            </div>
                            <div className="text-right">
                               <p className="text-3xl font-bold">{sub.visits_remaining ?? "∞"}</p>
                               <p className="text-xs opacity-80">занятий</p>
                            </div>
                          </div>
                          <div className="text-xs opacity-70">
                            {sub.end_date
                              ? `Действует до ${format(parseISO(sub.end_date), 'dd.MM.yyyy')}`
                              : sub.plan?.duration_days
                                ? `Активируется при первом посещении · ${sub.plan.duration_days} дней`
                                : "Без ограничения по сроку"}
                          </div>
                      </CardContent>
                   </Card>
                ))
              )}
           </div>
        </div>

        <Tabs defaultValue="history" className="w-full">
           <TabsList className="w-full">
              <TabsTrigger value="history" className="flex-1">Мои записи</TabsTrigger>
              <TabsTrigger value="info" className="flex-1">Инфо</TabsTrigger>
           </TabsList>
           
           <TabsContent value="history" className="mt-4 space-y-2">
              {history.length > 0 ? history.map((item: any) => (
                  <div key={item.id} className="flex justify-between items-center p-3 border-b last:border-0 hover:bg-gray-50 transition-colors rounded-md bg-white shadow-sm">
                      <div>
                          <div className="font-medium">{item.session?.class_type?.name}</div>
                          <div className="text-xs text-gray-500">
                              {item.session?.start_time ? format(parseISO(item.session.start_time), 'dd.MM HH:mm') : ""}
                          </div>
                      </div>
                      <div className={`text-xs px-2 py-1 rounded font-bold ${
                          item.status === 'completed' ? 'bg-green-100 text-green-700' : 
                          item.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-blue-50 text-blue-700'
                      }`}>
                          {item.status === 'completed' ? 'Посетил' : item.status === 'cancelled' ? 'Отмена' : 'Записан'}
                      </div>
                  </div>
              )) : <div className="text-center text-sm text-muted-foreground py-8">История пуста</div>}
           </TabsContent>

           <TabsContent value="info" className="mt-4">
              <Card><CardContent className="p-4"><div className="text-sm">Ваш телефон для связи: {client?.phone}</div></CardContent></Card>
           </TabsContent>
        </Tabs>
      </div>
    </ClientLayout>
  );
};

export default ClientProfile;
