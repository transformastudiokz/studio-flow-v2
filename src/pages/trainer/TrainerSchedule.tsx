import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { format, startOfWeek, endOfWeek, addDays, addWeeks, parseISO, isSameDay } from "date-fns";
import { ru } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TrainerSessionCard, type TrainerScheduleSession } from "@/components/trainer/TrainerSessionCard";

const TrainerSchedule = () => {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(new Date());

  const baseDate = addWeeks(new Date(), weekOffset);
  const weekStart = startOfWeek(baseDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(baseDate, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i));

  const { data = [], isLoading, isError } = useQuery<TrainerScheduleSession[]>({
    queryKey: ['trainer_schedule', weekStart.toISOString()],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data: sessions, error } = await supabase.rpc('get_trainer_schedule_v2', { p_from: weekStart.toISOString(), p_to: weekEnd.toISOString() });
      if (error) throw error;
      return (sessions || []) as TrainerScheduleSession[];
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: "always",
  });

  const daySessions = data.filter((session) => isSameDay(parseISO(session.start_time), selectedDay));
  const moveWeek = (delta: number) => {
    setWeekOffset((current) => current + delta);
    setSelectedDay((current) => addWeeks(current, delta));
  };

  return (
    <div className="pb-8 animate-in fade-in">
      {/* Header */}
      <div className="px-4 pt-5 pb-3">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">Моё расписание</h1>
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
            <Button aria-label="Предыдущая неделя" variant="ghost" size="icon" className="h-9 w-9" onClick={() => moveWeek(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs font-medium px-2 capitalize">
              {format(weekStart, 'd MMM', { locale: ru })} – {format(weekEnd, 'd MMM', { locale: ru })}
            </span>
            <Button aria-label="Следующая неделя" variant="ghost" size="icon" className="h-9 w-9" onClick={() => moveWeek(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Day picker */}
        <div className="grid grid-cols-7 gap-1">
          {weekDays.map(day => {
            const isSelected = isSameDay(day, selectedDay);
            const isToday = isSameDay(day, new Date());
            const count = data.filter((session) => isSameDay(parseISO(session.start_time), day)).length;
            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDay(day)}
                className={cn(
                  "flex min-h-16 flex-col items-center justify-center rounded-xl border py-2 transition-all",
                  isSelected ? "bg-primary text-white border-primary shadow" : "bg-white border-gray-100 text-gray-500",
                  isToday && !isSelected && "border-blue-300 bg-blue-50/50"
                )}
              >
                <span className="text-[9px] font-bold uppercase">{format(day, 'EEE', { locale: ru }).slice(0, 2)}</span>
                <span className="text-base font-bold leading-tight">{format(day, 'd')}</span>
                {count > 0 && <span className={cn("text-[9px] font-bold", isSelected ? "text-white/80" : "text-primary")}>{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sessions */}
      <div className="px-4 mt-2">
        <p className="text-sm font-medium text-muted-foreground capitalize mb-3">
          {format(selectedDay, 'EEEE, d MMMM', { locale: ru })}
        </p>

        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary/50" /></div>
        ) : isError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">Не удалось загрузить расписание. Обнови страницу.</div>
        ) : daySessions.length === 0 ? (
          <div className="text-center py-10 border border-dashed rounded-2xl text-muted-foreground text-sm">Нет занятий</div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {daySessions.map((session) => <TrainerSessionCard key={session.id} session={session} />)}
          </div>
        )}
      </div>
    </div>
  );
};

export default TrainerSchedule;
