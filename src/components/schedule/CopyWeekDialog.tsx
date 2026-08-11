import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addDays, addWeeks, endOfWeek, format, parseISO, startOfWeek } from "date-fns";
import { ru } from "date-fns/locale";
import { AlertTriangle, CheckCircle2, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { resolveAvailableRoom, shiftSessionToWeek, sessionsOverlap, type ScheduleSession } from "@/lib/schedule";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceWeek: Date;
  sessions: ScheduleSession[];
};

type Preview = {
  targetWeek: Date;
  ready: ReturnType<typeof shiftSessionToWeek>[];
  conflicts: Array<{ name: string; start: string; reason: string }>;
};

type ExistingSession = {
  id: string;
  start_time: string;
  end_time: string;
  room: string | null;
  coach_id: string | null;
  booking_status: string;
  class_type: { name: string } | null;
};

export function CopyWeekDialog({ open, onOpenChange, sourceWeek, sessions }: Props) {
  const queryClient = useQueryClient();
  const [targetDate, setTargetDate] = useState(format(addWeeks(sourceWeek, 1), "yyyy-MM-dd"));
  const [preview, setPreview] = useState<Preview | null>(null);
  const source = useMemo(() => sessions.filter((session) => session.booking_status !== "cancelled" && session.session_kind !== "rental"), [sessions]);

  useEffect(() => {
    if (!open) return;
    setTargetDate(format(addWeeks(sourceWeek, 1), "yyyy-MM-dd"));
    setPreview(null);
  }, [open, sourceWeek]);

  const analyze = useMutation({
    mutationFn: async () => {
      if (source.length === 0) throw new Error("На исходной неделе нет занятий для копирования");
      const targetWeek = startOfWeek(new Date(`${targetDate}T12:00:00`), { weekStartsOn: 1 });
      const targetEnd = endOfWeek(targetWeek, { weekStartsOn: 1 });
      const { data, error } = await supabase
        .from("schedule_sessions")
        .select("id,start_time,end_time,room,coach_id,booking_status,class_type:class_types(name)")
        .gte("start_time", targetWeek.toISOString())
        .lte("start_time", targetEnd.toISOString());
      if (error) throw error;

      const existing = (data || []) as unknown as ExistingSession[];
      const ready: ReturnType<typeof shiftSessionToWeek>[] = [];
      const conflicts: Preview["conflicts"] = [];

      for (const session of source) {
        const candidate = shiftSessionToWeek(session, targetWeek);
        const overlappingExisting = existing.filter((item) => item.booking_status !== "cancelled" && sessionsOverlap(candidate, item));
        const overlappingBatch = ready.filter((item) => sessionsOverlap(candidate, item));
        const coachConflict = [...overlappingExisting, ...overlappingBatch].find((item) => candidate.coach_id && item.coach_id === candidate.coach_id);
        const resolvedRoom = resolveAvailableRoom(candidate.room, [...overlappingExisting, ...overlappingBatch].map((item) => item.room));

        if (coachConflict || !resolvedRoom) {
          conflicts.push({
            name: session.class_type?.name || "Занятие",
            start: candidate.start_time,
            reason: coachConflict ? "Тренер занят" : "Оба зала заняты",
          });
        } else {
          ready.push({ ...candidate, room: resolvedRoom });
        }
      }
      return { targetWeek, ready, conflicts };
    },
    onSuccess: setPreview,
    onError: (error: Error) => toast.error(error.message),
  });

  const copy = useMutation({
    mutationFn: async () => {
      if (!preview?.ready.length) throw new Error("Нет занятий без конфликтов");
      const { error } = await supabase.from("schedule_sessions").insert(preview.ready);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["schedule_sessions"] });
      toast.success(`Скопировано занятий: ${preview?.ready.length || 0}`, { description: preview?.conflicts.length ? `Пропущено конфликтующих: ${preview.conflicts.length}` : undefined });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const targetWeek = startOfWeek(new Date(`${targetDate}T12:00:00`), { weekStartsOn: 1 });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Копировать расписание недели</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-xl bg-muted/30 p-3 text-sm">
            <p className="text-muted-foreground">Исходная неделя</p>
            <p className="font-semibold">{format(startOfWeek(sourceWeek, { weekStartsOn: 1 }), "d MMMM", { locale: ru })} — {format(endOfWeek(sourceWeek, { weekStartsOn: 1 }), "d MMMM yyyy", { locale: ru })}</p>
            <p className="mt-1 text-xs text-muted-foreground">Будут скопированы только фитнес-занятия — без клиентов, посещений, оплат и аренды.</p>
          </div>
          <div className="grid gap-2"><Label>Неделя назначения</Label><Input type="date" value={targetDate} onChange={(event) => { setTargetDate(event.target.value); setPreview(null); }} /><p className="text-xs text-muted-foreground">{format(targetWeek, "d MMMM", { locale: ru })} — {format(addDays(targetWeek, 6), "d MMMM yyyy", { locale: ru })}</p></div>
          {!preview ? <Button variant="outline" className="w-full" onClick={() => analyze.mutate()} disabled={analyze.isPending}>{analyze.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}Проверить конфликты</Button> : (
            <div className="space-y-3">
              <Alert><CheckCircle2 className="h-4 w-4" /><AlertDescription>Можно скопировать: <strong>{preview.ready.length}</strong> занятий.</AlertDescription></Alert>
              {preview.conflicts.length ? <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription><strong>Пропущено: {preview.conflicts.length}</strong><ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-4 pr-2">{preview.conflicts.map((item) => <li key={`${item.name}-${item.start}`}>{format(parseISO(item.start), "dd.MM HH:mm")} · {item.name} — {item.reason}</li>)}</ul></AlertDescription></Alert> : null}
            </div>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button><Button onClick={() => copy.mutate()} disabled={!preview?.ready.length || copy.isPending}>{copy.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Скопировать без конфликтующих</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
