import { useEffect, useMemo, useState } from "react";
import { format, isSameDay, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  HOUR_HEIGHT,
  SCHEDULE_END_HOUR,
  SCHEDULE_START_HOUR,
  STUDIO_ROOMS,
  normalizeRoom,
  scheduleStartHour,
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
  { length: SCHEDULE_END_HOUR - SCHEDULE_START_HOUR },
  (_, index) => SCHEDULE_START_HOUR + index,
);

const gridHeight = (SCHEDULE_END_HOUR - SCHEDULE_START_HOUR) * HOUR_HEIGHT;
const WEEK_COLUMN_MIN_WIDTH = 132;
const WEEK_CARD_HEIGHT = 72;
const WEEK_CARD_GAP = 5;
const WEEK_CELL_PADDING = 5;

const byStartRoomAndStatus = (left: ScheduleSession, right: ScheduleSession) => {
  const timeDifference = parseISO(left.start_time).getTime() - parseISO(right.start_time).getTime();
  if (timeDifference !== 0) return timeDifference;
  const roomDifference = STUDIO_ROOMS.indexOf(normalizeRoom(left.room)) - STUDIO_ROOMS.indexOf(normalizeRoom(right.room));
  if (roomDifference !== 0) return roomDifference;
  if (left.booking_status === right.booking_status) return left.id.localeCompare(right.id);
  if (left.booking_status === "cancelled") return 1;
  if (right.booking_status === "cancelled") return -1;
  return left.booking_status.localeCompare(right.booking_status);
};

const buildColumns = ({ view, weekDays, selectedDay, sessions, coaches }: Omit<Props, "onOpenSession">): Column[] => {
  if (view === "week") {
    return weekDays.map((day) => ({
      id: day.toISOString(),
      label: format(day, "EEEE", { locale: ru }),
      sublabel: format(day, "dd.MM"),
      date: day,
      sessions: sessions.filter((session) => isSameDay(parseISO(session.start_time), day)),
    }));
  }

  const daySessions = sessions.filter((session) => isSameDay(parseISO(session.start_time), selectedDay));
  if (view === "day") {
    return [{
      id: selectedDay.toISOString(),
      label: format(selectedDay, "EEEE", { locale: ru }),
      sublabel: format(selectedDay, "dd.MM"),
      date: selectedDay,
      sessions: daySessions,
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

const sessionsByStartHour = (sessions: ScheduleSession[]) => {
  const buckets = new Map<number, ScheduleSession[]>();
  [...sessions].sort(byStartRoomAndStatus).forEach((session) => {
    const hour = scheduleStartHour(session.start_time);
    buckets.set(hour, [...(buckets.get(hour) || []), session]);
  });
  return buckets;
};

function WeekGrid({ columns, now, allSessions, onOpenSession }: {
  columns: Column[];
  now: Date;
  allSessions: ScheduleSession[];
  onOpenSession: Props["onOpenSession"];
}) {
  const columnBuckets = useMemo(() => columns.map((column) => sessionsByStartHour(column.sessions)), [columns]);
  const hourlyRows = useMemo(() => hours.map((hour) => {
    const cells = columnBuckets.map((buckets) => buckets.get(hour) || []);
    const maximumSessions = Math.max(1, ...cells.map((cell) => cell.length));
    return {
      hour,
      cells,
      height: Math.max(HOUR_HEIGHT, maximumSessions * WEEK_CARD_HEIGHT + Math.max(0, maximumSessions - 1) * WEEK_CARD_GAP + WEEK_CELL_PADDING * 2),
    };
  }), [columnBuckets]);

  return (
    <div className="hidden overflow-x-auto rounded-xl border bg-white shadow-sm lg:block">
      <div className="min-w-[1000px]">
        <div
          className="sticky top-0 z-30 grid border-b bg-white/95 backdrop-blur"
          style={{ gridTemplateColumns: `58px repeat(${columns.length}, minmax(${WEEK_COLUMN_MIN_WIDTH}px, 1fr))` }}
        >
          <div className="border-r bg-muted/20" />
          {columns.map((column) => (
            <div
              key={column.id}
              className={cn(
                "flex min-h-12 items-center justify-center gap-1.5 border-r px-1.5 py-2 text-center last:border-r-0",
                isSameDay(column.date, now) && "bg-primary/[0.07]",
              )}
            >
              <span className="truncate text-[11px] font-semibold capitalize text-foreground">{column.label}</span>
              <span className={cn("shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground", isSameDay(column.date, now) && "rounded-full bg-primary px-1.5 py-0.5 text-primary-foreground")}>{column.sublabel}</span>
            </div>
          ))}
        </div>

        {hourlyRows.map(({ hour, cells, height }) => (
          <div
            key={hour}
            className="grid border-b last:border-b-0"
            style={{ gridTemplateColumns: `58px repeat(${columns.length}, minmax(${WEEK_COLUMN_MIN_WIDTH}px, 1fr))` }}
          >
            <div className="border-r bg-muted/10 px-1.5 pt-2 text-right text-[11px] font-semibold tabular-nums text-muted-foreground" style={{ minHeight: height }}>
              {String(hour).padStart(2, "0")}:00
            </div>
            {cells.map((cellSessions, columnIndex) => {
              const column = columns[columnIndex];
              return (
                <div
                  key={column.id}
                  className={cn("relative border-r p-[5px] last:border-r-0", isSameDay(column.date, now) && "bg-primary/[0.025]")}
                  style={{ minHeight: height }}
                >
                  {cellSessions.length === 0 ? null : (
                    <div className="flex h-full flex-col gap-[5px]">
                      {cellSessions.map((session) => (
                        <div key={session.id} className="shrink-0" style={{ height: WEEK_CARD_HEIGHT }}>
                          <ScheduleSessionCard
                            session={session}
                            hasConflict={parseISO(session.end_time) > now && Boolean(sessionConflict(session, allSessions))}
                            onOpen={onOpenSession}
                            weekCard
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ScheduleGrid(props: Props) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const columns = buildColumns(props);
  const allSessions = props.sessions;
  if (columns.length === 0) {
    return <div className="rounded-xl border border-dashed bg-card p-12 text-center text-sm text-muted-foreground">На выбранный день занятий нет</div>;
  }

  const mobileSessions = props.sessions
    .filter((session) => isSameDay(parseISO(session.start_time), props.selectedDay))
    .sort(byStartRoomAndStatus);

  return (
    <>
      <div className="space-y-2 lg:hidden">
        {mobileSessions.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card p-10 text-center text-sm text-muted-foreground">На выбранный день занятий нет</div>
        ) : mobileSessions.map((session) => (
          <div key={session.id} className="h-24">
            <ScheduleSessionCard session={session} hasConflict={parseISO(session.end_time) > now && Boolean(sessionConflict(session, allSessions))} onOpen={props.onOpenSession} />
          </div>
        ))}
      </div>

      {props.view === "week" || props.view === "day" ? (
        <WeekGrid columns={columns} now={now} allSessions={allSessions} onOpenSession={props.onOpenSession} />
      ) : (
        <div className="hidden overflow-x-auto rounded-xl border bg-white shadow-sm lg:block">
          <div style={{ minWidth: 58 + columns.length * 280 }}>
            <div className="sticky top-0 z-30 grid border-b bg-white/95 backdrop-blur" style={{ gridTemplateColumns: `58px repeat(${columns.length}, minmax(280px, 1fr))` }}>
              <div className="border-r bg-muted/20" />
              {columns.map((column) => (
                <div key={column.id} className="border-r px-2 py-2 text-center last:border-r-0">
                  <div className="truncate text-xs font-semibold capitalize text-foreground">{column.label}</div>
                  <div className="mt-0.5 h-4 text-[10px] text-primary">{column.sublabel || ""}</div>
                </div>
              ))}
            </div>

            <div className="grid" style={{ gridTemplateColumns: `58px repeat(${columns.length}, minmax(280px, 1fr))` }}>
              <div className="relative border-r bg-muted/10" style={{ height: gridHeight }}>
                {hours.map((hour) => (
                  <div key={hour} className="absolute left-0 right-0 -translate-y-2 px-2 text-right text-[10px] font-medium tabular-nums text-muted-foreground" style={{ top: (hour - SCHEDULE_START_HOUR) * HOUR_HEIGHT }}>
                    {String(hour).padStart(2, "0")}:00
                  </div>
                ))}
              </div>

              {columns.map((column) => (
                <div key={column.id} className={cn("relative border-r last:border-r-0", isSameDay(column.date, now) && "bg-primary/[0.025]")} style={{ height: gridHeight }}>
                  {hours.map((hour) => <div key={hour} className="absolute left-0 right-0 border-t border-border/60" style={{ top: (hour - SCHEDULE_START_HOUR) * HOUR_HEIGHT }} />)}
                  {column.sessions.map((session) => {
                    const position = sessionPosition(session);
                    return (
                      <div key={session.id} className="absolute left-1 right-1 z-10" style={{ top: position.top + 2, height: position.height }}>
                        <ScheduleSessionCard session={session} compact={position.height < 70} hasConflict={parseISO(session.end_time) > now && Boolean(sessionConflict(session, allSessions))} onOpen={props.onOpenSession} />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
