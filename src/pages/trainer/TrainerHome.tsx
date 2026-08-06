import { useQuery } from "@tanstack/react-query";
import { endOfMonth, format, isSameDay, parseISO, startOfMonth } from "date-fns";
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
      const { data: monthSessionsResult, error: sessionsError } = await supabase.rpc("get_trainer_schedule_v2", {
        p_from: startOfMonth(now).toISOString(),
        p_to: endOfMonth(now).toISOString(),
      });
      if (sessionsError) throw sessionsError;

      const monthSessions = (monthSessionsResult || []) as TrainerScheduleSession[];
      const todaySessions = monthSessions.filter((session) => isSameDay(parseISO(session.start_time), now));
      const conductedSessions = monthSessions.filter((session) =>
        session.booking_status !== "cancelled" && parseISO(session.end_time).getTime() <= now.getTime());
      const conductedIds = conductedSessions.map((session) => session.id);

      let confirmedOnefit = 0;
      if (conductedIds.length > 0) {
        const { data: onefitRows, error: onefitError } = await supabase
          .from("onefit_bookings")
          .select("session_id,source_status,is_active")
          .in("session_id", conductedIds)
          .eq("source_status", "confirmed")
          .eq("is_active", true);
        if (onefitError) throw onefitError;
        confirmedOnefit = (onefitRows || []).length;
      }

      const totalClients = conductedSessions.reduce((sum, session) => sum + count(session.completed_count), 0) + confirmedOnefit;
      const totalStars = conductedSessions.reduce((sum, session) => sum + count(session.first_booking_count), 0);

      return {
        profile,
        todaySessions,
        totalClients,
        totalSessions: conductedSessions.length,
        totalStars,
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

  const { profile, todaySessions = [], totalClients = 0, totalSessions = 0, totalStars = 0 } = data || {};
  const surnameInitial = profile?.last_name?.trim()?.slice(0, 1).toLocaleUpperCase("ru-RU");
  const greetingName = [profile?.first_name?.trim(), surnameInitial ? `${surnameInitial}.` : ""].filter(Boolean).join(" ") || "Тренер";
  const now = new Date();

  const metrics = [
    { label: "занятий", value: totalSessions, icon: Calendar, color: "text-[#456B57]", background: "bg-[#EEF4F0]" },
    { label: "клиентов", value: totalClients, icon: Users, color: "text-[#557665]", background: "bg-[#F0F6F2]" },
    { label: "звёздочек", value: totalStars, icon: Star, color: "text-amber-700", background: "bg-[#FFF8E8]" },
  ];

  return (
    <div className="animate-in space-y-5 pb-8 fade-in">
      <header className="relative overflow-hidden bg-gradient-to-b from-[#6F927F] to-[#557665] px-5 pb-7 pt-9 text-white">
        <Button aria-label="Выйти" variant="ghost" size="icon" className="absolute right-3 top-3 h-11 w-11 text-white/75 hover:bg-white/10 hover:text-white" onClick={handleLogout}>
          <LogOut className="h-5 w-5" />
        </Button>
        <p className="mb-1 text-sm text-white/75">Добро пожаловать,</p>
        <h1 className="max-w-[calc(100%-48px)] truncate text-[30px] font-semibold leading-tight tracking-tight" title={greetingName}>{greetingName}</h1>
        <p className="mt-2 text-sm text-white/70">{format(now, "EEEE, d MMMM", { locale: ru })}</p>
      </header>

      <section className="px-4">
        <h2 className="mb-3 text-base font-semibold text-foreground/75">{capitalize(format(now, "LLLL yyyy", { locale: ru }))}</h2>
        <div className="grid grid-cols-3 gap-2.5">
          {metrics.map(({ label, value, icon: Icon, color, background }) => (
            <div key={label} className={`${background} min-w-0 rounded-[20px] px-2 py-3.5 text-center`}>
              <Icon className={`${color} mx-auto mb-1 h-5 w-5`} fill={label === "звёздочек" ? "currentColor" : "none"} />
              <div className={`${color} text-2xl font-bold tabular-nums`}>{value}</div>
              <div className={`${color} mt-0.5 truncate text-[11px] font-medium`}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="px-4">
        <h2 className="mb-3 text-base font-semibold text-foreground/75">Сегодня</h2>
        {todaySessions.length > 0 ? (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {todaySessions.map((session) => <TrainerSessionCard key={session.id} session={session} />)}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">Занятий сегодня нет</p>
          </div>
        )}
      </section>
    </div>
  );
};

export default TrainerHome;
