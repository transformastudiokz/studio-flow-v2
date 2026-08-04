import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { format, startOfWeek, endOfWeek, addDays, addWeeks, parseISO, isSameDay } from "date-fns";
import { ru } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Clock, Users, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TrainerSchedule = () => {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(new Date());

  const baseDate = addWeeks(new Date(), weekOffset);
  const weekStart = startOfWeek(baseDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(baseDate, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i));

  const { data, isLoading } = useQuery({
    queryKey: ['trainer_schedule', weekStart.toISOString()],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data: sessions, error } = await supabase.rpc('get_trainer_schedule', { p_from: weekStart.toISOString(), p_to: weekEnd.toISOString() });
      if (error) throw error;
      return (sessions || []).map((session: any) => ({ ...session, class_type: { name: session.class_name, color: session.class_color }, bookings: [{ count: session.booked_count }] }));
    }
  });

  const daySessions = (data || []).filter((s: any) => isSameDay(parseISO(s.start_time), selectedDay));

  return (
    <div className="pb-8 animate-in fade-in">
      {/* Header */}
      <div className="px-4 pt-5 pb-3">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">Моё расписание</h1>
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setWeekOffset(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs font-medium px-2 capitalize">
              {format(weekStart, 'd MMM', { locale: ru })} – {format(weekEnd, 'd MMM', { locale: ru })}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setWeekOffset(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Day picker */}
        <div className="grid grid-cols-7 gap-1">
          {weekDays.map(day => {
            const isSelected = isSameDay(day, selectedDay);
            const isToday = isSameDay(day, new Date());
            const count = (data || []).filter((s: any) => isSameDay(parseISO(s.start_time), day)).length;
            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDay(day)}
                className={cn(
                  "flex flex-col items-center py-2 rounded-xl border transition-all",
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
        ) : daySessions.length === 0 ? (
          <div className="text-center py-10 border border-dashed rounded-2xl text-muted-foreground text-sm">Нет занятий</div>
        ) : (
          <div className="space-y-3">
            {daySessions.map((session: any) => {
              const booked = session.bookings?.[0]?.count || 0;
              const isFull = booked >= session.capacity;
              return (
                <div key={session.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex">
                  <div className="w-1.5 shrink-0" style={{ backgroundColor: session.class_type?.color || '#3b82f6' }} />
                  <div className="p-4 flex-1">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-bold">{session.class_type?.name}</p>
                        <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
                          <Clock className="w-3.5 h-3.5" />
                          <span className="tabular-nums">{format(parseISO(session.start_time), 'HH:mm')} – {format(parseISO(session.end_time), 'HH:mm')}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 bg-gray-50 rounded-xl px-3 py-2">
                        <Users className="w-4 h-4 text-gray-400" />
                        <span className={cn("text-lg font-bold", isFull ? "text-red-600" : "text-primary")}>{booked}</span>
                        <span className="text-gray-400 text-sm">/{session.capacity}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default TrainerSchedule;
