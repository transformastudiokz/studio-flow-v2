import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { format, startOfMonth, endOfMonth, parseISO, isSameDay } from "date-fns";
import { ru } from "date-fns/locale";
import { Loader2, LogOut, Users, Calendar, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { TrainerSessionCard, type TrainerScheduleSession } from "@/components/trainer/TrainerSessionCard";

const TrainerHome = () => {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['trainer_home'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      // Get coach record linked to this user
      const { data: coach, error: coachError } = await supabase
        .from('coaches')
        .select('*')
        .eq('user_id', user.id)
        .single();
      if (coachError || !coach) throw new Error("Тренер не найден. Обратитесь к администратору.");

      const now = new Date();
      const monthStart = startOfMonth(now).toISOString();
      const monthEnd = endOfMonth(now).toISOString();

      const { data: monthSessionsResult, error: sessionsError } = await supabase.rpc('get_trainer_schedule_v2', {
        p_from: monthStart,
        p_to: monthEnd,
      });
      if (sessionsError) throw sessionsError;
      const monthSessions = (monthSessionsResult || []) as TrainerScheduleSession[];
      const todaySessions = monthSessions.filter((session) => isSameDay(parseISO(session.start_time), new Date()));

      // Only attended/completed count for payroll
      const totalClients = (monthSessions || []).reduce((sum: number, s: any) =>
        sum + Number(s.completed_count || 0), 0);
      const totalSessions = (monthSessions || []).length;
      const payment = totalClients * (coach.rate_per_client || 0);

      return { coach, todaySessions, monthSessions, totalClients, totalSessions, payment };
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: "always",
  });

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/trainer/login");
  };

  if (isLoading) return <div className="flex justify-center mt-20"><Loader2 className="animate-spin text-primary" /></div>;

  const { coach, todaySessions, totalClients, totalSessions, payment } = data || {};

  return (
    <div className="space-y-6 pb-8 animate-in fade-in">
      {/* Header */}
      <div className="bg-gradient-to-br from-primary to-blue-700 px-5 pt-10 pb-8 text-white relative">
        <Button variant="ghost" size="icon" className="absolute top-4 right-4 text-white/70 hover:text-white hover:bg-white/10" onClick={handleLogout}>
          <LogOut className="w-5 h-5" />
        </Button>
        <p className="text-white/70 text-sm mb-1">Добро пожаловать,</p>
        <h1 className="text-2xl font-bold">{coach?.name}</h1>
        <p className="text-white/60 text-sm mt-1">{format(new Date(), 'EEEE, d MMMM', { locale: ru })}</p>
      </div>

      {/* Stats this month */}
      <div className="px-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          {format(new Date(), 'MMMM yyyy', { locale: ru })}
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-blue-50 rounded-2xl p-4 text-center">
            <Calendar className="w-5 h-5 text-blue-500 mx-auto mb-1" />
            <div className="text-2xl font-bold text-blue-700">{totalSessions}</div>
            <div className="text-xs text-blue-500 mt-0.5">занятий</div>
          </div>
          <div className="bg-green-50 rounded-2xl p-4 text-center">
            <Users className="w-5 h-5 text-green-500 mx-auto mb-1" />
            <div className="text-2xl font-bold text-green-700">{totalClients}</div>
            <div className="text-xs text-green-500 mt-0.5">клиентов</div>
          </div>
          <div className="bg-orange-50 rounded-2xl p-4 text-center">
            <TrendingUp className="w-5 h-5 text-orange-500 mx-auto mb-1" />
            <div className="text-xl font-bold text-orange-700">{(payment || 0).toLocaleString()}</div>
            <div className="text-xs text-orange-500 mt-0.5">₸ заработок</div>
          </div>
        </div>
      </div>

      {/* Today's sessions */}
      <div className="px-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Сегодня</h2>
        {todaySessions && todaySessions.length > 0 ? (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {todaySessions.map((session) => <TrainerSessionCard key={session.id} session={session} />)}
          </div>
        ) : (
          <div className="bg-gray-50 rounded-2xl p-8 text-center border border-dashed border-gray-200">
            <p className="text-muted-foreground text-sm">Занятий сегодня нет</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TrainerHome;
