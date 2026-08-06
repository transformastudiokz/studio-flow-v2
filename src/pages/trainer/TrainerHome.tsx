import { useQuery } from "@tanstack/react-query";
import { addMonths, endOfDay, endOfMonth, format, isSameDay, parseISO, startOfMonth } from "date-fns";
import { ru } from "date-fns/locale";
import { Calendar, Loader2, LogOut, Star, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { TrainerSessionCard, type TrainerScheduleSession } from "@/components/trainer/TrainerSessionCard";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

const count = (value: number | string | null | undefined) => Number(value || 0);
const capitalize = (value: string) => value.charAt(0).toLocaleUpperCase("ru-RU") + value.slice(1);

const TrainerHome = () => {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["trainer_home"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      const [{ data: coach, error: coachError }, { data: profile, error: profileError }] = await Promise.all([
        supabase.from("coaches").select("id,name").eq("user_id", user.id).single(),
        supabase.from("profiles").select("first_name,last_name,middle_name").eq("id", user.id).single(),
      ]);
      if (coachError || !coach) throw new Error("Тренер не найден. Обратитесь к администратору.");
      if (profileError || !profile) throw new Error("Карточка сотрудника не найдена.");

      const now = new Date();
      const range = { p_from: startOfMonth(now).toISOString(), p_to: endOfMonth(now).toISOString() };
      const [{ data: monthSessionsResult, error: sessionsError }, { data: metricsResult, error: metricsError }, { data: upcomingResult, error: upcomingError }] = await Promise.all([
        supabase.rpc("get_trainer_schedule_v2", range),
        supabase.rpc("get_trainer_home_metrics", range),
        supabase.rpc("get_trainer_schedule_v2", {
          p_from: endOfDay(now).toISOString(),
          p_to: addMonths(now, 3).toISOString(),
        }),
      ]);
      if (sessionsError) throw sessionsError;
      if (metricsError) throw metricsError;
      if (upcomingError) throw upcomingError;

      const monthSessions = (monthSessionsResult || []) as TrainerScheduleSession[];
      const todaySessions = monthSessions.filter((session) => isSameDay(parseISO(session.start_time), now));
      const nextSession = ((upcomingResult || []) as TrainerScheduleSession[])
        .filter((session) => session.booking_status !== "cancelled")
        .sort((left, right) => parseISO(left.start_time).getTime() - parseISO(right.start_time).getTime())[0] || null;
      const metrics = metricsResult?.[0] || { total_sessions: 0, total_clients: 0, total_stars: 0 };

      return {
        profile,
        todaySessions,
        nextSession,
        totalClients: count(metrics.total_clients),
        totalSessions: count(metrics.total_sessions),
        totalStars: count(metrics.total_stars),
      };
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: "always",
  });

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/trainer/login");
  };

  if (isLoading) return <div className="mt-20 flex justify-center"><Loader2 className="animate-spin text-primary" /></div>;

  const { profile, todaySessions = [], nextSession, totalClients = 0, totalSessions = 0, totalStars = 0 } = data || {};
  const surnameInitial = profile?.last_name?.trim()?.slice(0, 1).toLocaleUpperCase("ru-RU");
  const greetingName = [profile?.first_name?.trim(), surnameInitial ? `${surnameInitial}.` : ""].filter(Boolean).join(" ") || "Тренер";
  const now = new Date();

  const metrics = [
    { label: "занятий", value: totalSessions, icon: Calendar, color: "text-[#456B57]", background: "bg-[#EEF4F0]" },
    { label: "клиентов", value: totalClients, icon: Users, color: "text-[#557665]", background: "bg-[#F0F6F2]" },
    { label: "звёздочек", value: totalStars, icon: Star, color: "text-[#557665]", iconColor: "text-[#E6B23C]", background: "bg-[#FFF9E8]" },
  ];

  return (
    <div className="animate-in space-y-3 pb-3 fade-in">
      <header className="relative overflow-hidden bg-gradient-to-b from-[#719381] to-[#557665] px-5 pb-4 pt-5 text-white">
        <Button aria-label="Выйти" variant="ghost" size="icon" className="absolute right-3 top-2.5 h-9 w-9 text-white/75 hover:bg-white/10 hover:text-white" onClick={handleLogout}>
          <LogOut className="h-4.5 w-4.5" />
        </Button>
        <p className="text-xs text-white/75">Добро пожаловать,</p>
        <h1 className="mt-0.5 max-w-[calc(100%-44px)] truncate text-[25px] font-semibold leading-tight tracking-tight" title={greetingName}>{greetingName}</h1>
        <p className="mt-1.5 text-xs text-white/70">{format(now, "EEEE, d MMMM", { locale: ru })}</p>
      </header>

      <section className="px-3.5">
        <h2 className="mb-2 text-sm font-semibold text-foreground/75">{capitalize(format(now, "LLLL yyyy", { locale: ru }))}</h2>
        <div className="grid grid-cols-3 gap-2">
          {metrics.map(({ label, value, icon: Icon, color, iconColor, background }) => (
            <div key={label} className={`${background} min-w-0 rounded-2xl px-1.5 py-2 text-center`}>
              <Icon className={`${iconColor || color} mx-auto h-4 w-4`} fill={label === "звёздочек" && value > 0 ? "currentColor" : "none"} />
              <div className={`${color} mt-0.5 text-xl font-bold leading-6 tabular-nums`}>{value}</div>
              <div className={`${color} truncate text-[10px] font-medium leading-3`}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="px-3.5">
        <h2 className="mb-1.5 text-sm font-semibold text-foreground/75">Сегодня</h2>
        {todaySessions.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {todaySessions.map((session) => <TrainerSessionCard key={session.id} session={session} />)}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">Занятий сегодня нет</p>
          </div>
        )}
      </section>

      <section className="px-3.5">
        <h2 className="text-sm font-semibold text-foreground/75">Следующее занятие</h2>
        {nextSession ? (
          <div>
            <p className="mb-1 text-xs capitalize text-muted-foreground">{format(parseISO(nextSession.start_time), "EEEE, d MMMM", { locale: ru })}</p>
            <TrainerSessionCard session={nextSession} />
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center">
            <p className="text-sm text-muted-foreground">Следующее занятие пока не запланировано</p>
          </div>
        )}
      </section>
    </div>
  );
};

export default TrainerHome;
