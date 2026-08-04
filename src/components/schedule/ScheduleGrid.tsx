import { useEffect, useState } from "react";
import { format, isSameDay, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  HOUR_HEIGHT,
  SCHEDULE_END_HOUR,
  SCHEDULE_START_HOUR,
  STUDIO_ROOMS,
  normalizeRoom,
  sessionConflict,
  sessionPosition,
  type ScheduleSession,
} from "@/lib/schedule";
import { ScheduleSessionCard } from "./ScheduleSessionCard";

export type ScheduleView = "week" | "day" | "trainers" | "rooms";

type Column = {
  id: string;
  label: string;
  sublabel?: string;
  date: Date;
  sessions: ScheduleSession[];
  roomLanes?: boolean;
};

type Props = {
  view: ScheduleView;
  weekDays: Date[];
  selectedDay: Date;
  sessions: ScheduleSession[];
  coaches: Array<{ id: string; name: string }>;
  onOpenSession: (session: ScheduleSession) => void;
};

const hours = Array.from(
  { length: SCHEDULE_END_HOUR - SCHEDULE_START_HOUR + 1 },
  (_, index) => SCHEDULE_START_HOUR + index,
);

const gridHeight = (SCHEDULE_END_HOUR - SCHEDULE_START_HOUR) * HOUR_HEIGHT;

const buildColumns = ({ view, weekDays, selectedDay, sessions, coaches }: Omit<Props, "onOpenSession">): Column[] => {
  if (view === "week") {
    return weekDays.map((day) => ({
      id: day.toISOString(),
      label: format(day, "EEE d", { locale: ru }),
      sublabel: isSameDay(day, new Date()) ? "Сегодня" : undefined,
      date: day,
      sessions: sessions.filter((session) => isSameDay(parseISO(session.start_time), day)),
      roomLanes: true,
    }));
  }

  const daySessions = sessions.filter((session) => isSameDay(parseISO(session.start_time), selectedDay));
  if (view === "day") {
    return [{
      id: selectedDay.toISOString(),
      label: format(selectedDay, "EEEE, d MMMM", { locale: ru }),
      date: selectedDay,
      sessions: daySessions,
      roomLanes: true,
    }];
  }

  if (view === "rooms") {
    return STUDIO_ROOMS.map((room) => ({
      id: room,
      label: room,
      sublabel: format(selectedDay, "d MMMM", { locale: ru }),
      date: selectedDay,
      sessions: daySessions.filter((session) => normalizeRoom(session.room) === room),
    }));
  }

  const activeCoachIds = new Set(daySessions.map((session) => session.coach_id).filter(Boolean));
  const trainerColumns = coaches.filter((coach) => activeCoachIds.has(coach.id));
  const columns = trainerColumns.map((coach) => ({
    id: coach.id,
    label: coach.name,
    sublabel: format(selectedDay, "d MMMM", { locale: ru }),
    date: selectedDay,
    sessions: daySessions.filter((session) => session.coach_id === coach.id),
  }));
  const noCoach = daySessions.filter((session) => !session.coach_id);
  if (noCoach.length > 0) columns.push({ id: "none", label: "Без тренера", sublabel: format(selectedDay, "d MMMM", { locale: ru }), date: selectedDay, sessions: noCoach });
  return columns;
};

export function ScheduleGrid(props: Props) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const columns = buildColumns(props);
  const minimumColumnWidth = props.view === "week" ? 190 : 280;
  const allSessions = props.sessions;

  if (columns.length === 0) {
    return <div className="rounded-xl border border-dashed bg-card p-12 text-center text-sm text-muted-foreground">На выбранный день занятий нет</div>;
  }

  const mobileSessions = props.sessions
    .filter((session) => isSameDay(parseISO(session.start_time), props.selectedDay))
    .sort((left, right) => parseISO(left.start_time).getTime() - parseISO(right.start_time).getTime());

  return (
    <>
      <div className="space-y-4 lg:hidden">
        {STUDIO_ROOMS.map((room) => {
          const roomSessions = mobileSessions.filter((session) => normalizeRoom(session.room) === room);
          return (
            <section key={room} className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-3">
                <h2 className="text-sm font-semibold">{room}</h2>
                <span className="text-xs text-muted-foreground">{roomSessions.length} зан.</span>
              </div>
              <div className="space-y-2 p-3">
                {roomSessions.length === 0 ? <p className="py-5 text-center text-sm text-muted-foreground">Занятий нет</p> : roomSessions.map((session) => (
                  <div key={session.id} className="min-h-[86px]">
                    <ScheduleSessionCard session={session} hasConflict={Boolean(sessionConflict(session, allSessions))} onOpen={props.onOpenSession} />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border bg-white shadow-sm lg:block">
      <div style={{ minWidth: 64 + columns.length * minimumColumnWidth }}>
        <div className="sticky top-0 z-30 grid border-b bg-white/95 backdrop-blur" style={{ gridTemplateColumns: `64px repeat(${columns.length}, minmax(${minimumColumnWidth}px, 1fr))` }}>
          <div className="border-r bg-muted/20" />
          {columns.map((column) => (
            <div key={column.id} className="border-r px-2 py-2 text-center last:border-r-0">
              <div className="truncate text-xs font-semibold capitalize text-foreground">{column.label}</div>
              <div className="mt-0.5 h-4 text-[10px] text-primary">{column.sublabel || ""}</div>
              {column.roomLanes ? (
                <div className="mt-1 grid grid-cols-2 border-t pt-1 text-[9px] text-muted-foreground">
                  <span>Большой</span><span>Малый</span>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="grid" style={{ gridTemplateColumns: `64px repeat(${columns.length}, minmax(${minimumColumnWidth}px, 1fr))` }}>
          <div className="relative border-r bg-muted/10" style={{ height: gridHeight }}>
            {hours.slice(0, -1).map((hour) => (
              <div key={hour} className="absolute left-0 right-0 -translate-y-2 px-2 text-right text-[10px] font-medium tabular-nums text-muted-foreground" style={{ top: (hour - SCHEDULE_START_HOUR) * HOUR_HEIGHT }}>
                {String(hour).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {columns.map((column) => (
            <div key={column.id} className={cn("relative border-r last:border-r-0", column.sublabel === "Сегодня" && "bg-primary/[0.025]")} style={{ height: gridHeight }}>
              {hours.slice(0, -1).map((hour) => (
                <div key={hour} className="absolute left-0 right-0 border-t border-border/60" style={{ top: (hour - SCHEDULE_START_HOUR) * HOUR_HEIGHT }}>
                  <div className="absolute left-0 right-0 top-[44px] border-t border-dashed border-border/35" />
                </div>
              ))}
              {column.roomLanes ? <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-border/60" /> : null}
              {isSameDay(column.date, now) && now.getHours() >= SCHEDULE_START_HOUR && now.getHours() < SCHEDULE_END_HOUR ? (
                <div className="pointer-events-none absolute left-0 right-0 z-20 border-t border-rose-400/80" style={{ top: ((now.getHours() * 60 + now.getMinutes() - SCHEDULE_START_HOUR * 60) / 60) * HOUR_HEIGHT }}>
                  <span className="absolute -top-2.5 left-1 rounded bg-rose-500 px-1 text-[8px] font-semibold tabular-nums text-white">{format(now, "HH:mm")}</span>
                </div>
              ) : null}

              {column.sessions.map((session) => {
                const position = sessionPosition(session);
                const room = normalizeRoom(session.room);
                const laneStyle = column.roomLanes
                  ? { left: room === "Большой зал" ? 3 : "50.5%", width: "49%" }
                  : { left: 4, right: 4 };
                const conflict = Boolean(sessionConflict(session, allSessions));

                return (
                  <div
                    key={session.id}
                    className="absolute z-10 px-0.5"
                    style={{ top: position.top + 2, height: position.height, ...laneStyle }}
                  >
                    <ScheduleSessionCard
                      session={session}
                      compact={position.height < 70 || props.view === "week"}
                      hasConflict={conflict}
                      onOpen={props.onOpenSession}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      </div>
    </>
  );
}
