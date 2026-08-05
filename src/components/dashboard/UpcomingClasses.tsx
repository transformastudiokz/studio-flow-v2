import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { differenceInMinutes, endOfDay, format, parseISO, startOfDay } from "date-fns";
import { ArrowRight, Clock, Loader2, MapPin, MessageCircle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClientStatusIndicators, ClientStatusLegend } from "@/components/clients/ClientStatusIndicators";
import { fetchClientStatuses, getClientStatusForBooking, type ClientStatus } from "@/lib/client-status";
import { toast } from "sonner";

type DashboardClient = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
};

type DashboardBooking = {
  id: string;
  status: string;
  user: DashboardClient | null;
  clientStatus?: ClientStatus;
};

type DashboardClass = {
  id: string;
  start_time: string;
  end_time: string;
  capacity: number;
  room: string | null;
  booking_status: "open" | "closed" | "cancelled";
  booking_closed_reason: string | null;
  class_type: { name: string } | null;
  coach: { name: string } | null;
  bookings: DashboardBooking[];
};

const attendanceStatus = {
  booked: { label: "Записан", className: "border-blue-200 bg-blue-50 text-blue-700" },
  completed: { label: "Пришёл", className: "border-green-200 bg-green-50 text-green-700" },
  absent: { label: "Не пришёл", className: "border-orange-200 bg-orange-50 text-orange-700" },
  cancelled: { label: "Отмена", className: "border-red-200 bg-red-50 text-red-700" },
  late_cancel: { label: "Поздняя отмена", className: "border-red-300 bg-red-100 text-red-800" },
} as const;

const occupiesPlace = (status: string) => !["cancelled", "late_cancel", "absent"].includes(status);

export const UpcomingClasses = () => {
  const queryClient = useQueryClient();

  const { data: cancellationWindow = 90 } = useQuery({
    queryKey: ["dashboard_cancellation_window"],
    queryFn: async () => {
      const { data } = await supabase
        .from("studio_info")
        .select("value")
        .eq("key", "cancellation_minutes")
        .maybeSingle();
      return data?.value ? Number.parseInt(data.value, 10) : 90;
    },
  });

  const { data: classes = [], isLoading } = useQuery<DashboardClass[]>({
    queryKey: ["dashboard_upcoming_classes"],
    queryFn: async () => {
      const today = new Date();
      const { data, error } = await supabase
        .from("schedule_sessions")
        .select(`
          id, start_time, end_time, capacity, room, booking_status, booking_closed_reason,
          class_type:class_types(name),
          coach:coaches(name),
          bookings:bookings(
            id, status,
            user:profiles(id, first_name, last_name, phone)
          )
        `)
        .gte("start_time", startOfDay(today).toISOString())
        .lte("start_time", endOfDay(today).toISOString())
        .order("start_time");

      if (error) throw error;

      const rawClasses = (data || []) as unknown as DashboardClass[];
      const userIds = rawClasses.flatMap((session) =>
        (session.bookings || [])
          .map((booking) => booking.user?.id)
          .filter((id): id is string => Boolean(id)),
      );
      const clientStatuses = await fetchClientStatuses(userIds);

      return rawClasses.map((session) => ({
        ...session,
        bookings: (session.bookings || []).map((booking) => ({
          ...booking,
          clientStatus: getClientStatusForBooking(
            clientStatuses.get(booking.user?.id),
            booking.id,
          ),
        })),
      }));
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({
      bookingId,
      status,
      sessionTime,
    }: {
      bookingId: string;
      status: string;
      sessionTime: string;
    }) => {
      if (status === "cancelled") {
        const minutesBeforeClass = differenceInMinutes(parseISO(sessionTime), new Date());
        if (minutesBeforeClass > 0 && minutesBeforeClass < cancellationWindow) {
          const shouldContinue = window.confirm(
            `До занятия осталось ${minutesBeforeClass} мин. Отменить запись и вернуть занятие в абонемент?`,
          );
          if (!shouldContinue) throw new Error("Отмена прервана");
        }
      }

      const { error } = await supabase
        .from("bookings")
        .update({ status })
        .eq("id", bookingId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Статус посещения обновлён");
      queryClient.invalidateQueries({ queryKey: ["dashboard_upcoming_classes"] });
      queryClient.invalidateQueries({ queryKey: ["attendance_report"] });
    },
    onError: (error: Error) => {
      if (error.message !== "Отмена прервана") toast.error(error.message);
    },
  });

  const openWhatsApp = (client: DashboardClient | null, session: DashboardClass) => {
    if (!client?.phone) return toast.error("У клиента не указан телефон");

    const phone = client.phone.replace(/\D/g, "");
    const message = [
      `Здравствуйте, ${client.first_name}!`,
      `Напоминаем, что вы записаны на «${session.class_type?.name || "занятие"}»`,
      `${format(parseISO(session.start_time), "dd.MM")} в ${format(parseISO(session.start_time), "HH:mm")}.`,
      "Ждём вас!",
    ].join("\n");

    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank");
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border/50 bg-card shadow-sm animate-in fade-in">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-base font-semibold">Ближайшие занятия</h3>
          <p className="mt-1 text-xs text-muted-foreground">Нажмите на занятие, чтобы открыть список клиентов</p>
        </div>
        <Button asChild variant="ghost" size="sm" className="shrink-0 text-primary">
          <Link to="/schedule">Все занятия <ArrowRight className="ml-1.5 h-4 w-4" /></Link>
        </Button>
      </div>
      <div className="max-h-[210px] divide-y divide-border overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center p-8"><Loader2 className="animate-spin text-primary" /></div>
        ) : classes.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <span className="text-2xl">☕️</span>
            На сегодня занятий нет
          </div>
        ) : (
          classes.map((item) => {
            const activeBookings = (item.bookings || []).filter((booking) =>
              occupiesPlace(booking.status),
            );
            const bookingsCount = activeBookings.length;
            const percent = Math.min((bookingsCount / item.capacity) * 100, 100);

            return (
              <Dialog key={item.id}>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className={`block w-full px-4 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${item.booking_status === "cancelled" ? "bg-slate-200 text-slate-600 hover:bg-slate-200" : item.booking_status === "closed" ? "bg-slate-50 hover:bg-slate-100" : "hover:bg-muted/40"}`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-medium text-foreground">{item.class_type?.name}</h4>
                        {item.booking_status !== "open" && <p className="mt-1 text-xs font-semibold text-slate-600">{item.booking_status === "cancelled" ? "Занятие отменено" : "Запись закрыта"}{item.booking_closed_reason ? ` · ${item.booking_closed_reason}` : ""}</p>}
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Users className="h-3 w-3" /> {item.coach?.name || "Без тренера"}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-1.5 text-sm font-bold text-primary">
                          <Clock className="h-4 w-4" />
                          {format(parseISO(item.start_time), "HH:mm")}
                        </div>
                        <div className="mt-1 flex items-center justify-end gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" /> {item.room || "Зал 1"}
                        </div>
                      </div>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div
                          className={`h-full rounded-full transition-all ${percent >= 100 ? "bg-red-500" : "bg-primary"}`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <span className="w-12 text-right text-xs font-medium text-muted-foreground">
                        {bookingsCount}/{item.capacity}
                      </span>
                    </div>
                  </button>
                </DialogTrigger>
                <DialogContent className="w-[calc(100vw-24px)] max-w-3xl gap-0 overflow-hidden p-0 shadow-2xl sm:max-h-[min(820px,90vh)]">
                  <div className="border-b p-4">
                    <div className="flex items-start justify-between gap-4 pr-5">
                      <div>
                        <DialogTitle className="text-base font-semibold">{item.class_type?.name}</DialogTitle>
                        <DialogDescription className="mt-1 text-sm text-muted-foreground">
                          {format(parseISO(item.start_time), "HH:mm")}–{format(parseISO(item.end_time), "HH:mm")}
                          {item.coach?.name ? ` · ${item.coach.name}` : ""}
                          {item.room ? ` · ${item.room}` : ""}
                        </DialogDescription>
                      </div>
                      <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                        {bookingsCount}/{item.capacity}
                      </span>
                    </div>
                    <ClientStatusLegend className="mt-3" />
                  </div>

                  <ScrollArea className="max-h-[min(680px,calc(100vh-230px))]">
                    <div className="divide-y">
                      {(item.bookings || []).length === 0 ? (
                        <div className="p-8 text-center text-sm text-muted-foreground">На занятие пока никто не записан</div>
                      ) : (
                        (item.bookings || []).map((booking) => {
                          const client = booking.user;
                          const status = attendanceStatus[booking.status as keyof typeof attendanceStatus] || attendanceStatus.booked;

                          return (
                            <div key={booking.id} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                              <ClientStatusIndicators status={booking.clientStatus} reserveSpace />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center">
                                  {client ? (
                                    <Link
                                      to={`/clients/${client.id}`}
                                      className="truncate text-sm font-medium hover:text-primary hover:underline"
                                    >
                                      {client.first_name} {client.last_name || ""}
                                    </Link>
                                  ) : (
                                    <span className="text-sm font-medium">Неизвестный клиент</span>
                                  )}
                                </div>
                                <p className="truncate text-xs text-muted-foreground">{client?.phone || "Телефон не указан"}</p>
                              </div>

                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 shrink-0 text-green-600 hover:bg-green-50 hover:text-green-700"
                                title="Написать в WhatsApp"
                                onClick={() => openWhatsApp(client, item)}
                                disabled={!client?.phone}
                              >
                                <MessageCircle className="h-4 w-4" />
                              </Button>

                              <Select
                                value={booking.status}
                                disabled={updateStatusMutation.isPending}
                                onValueChange={(value) =>
                                  updateStatusMutation.mutate({
                                    bookingId: booking.id,
                                    status: value,
                                    sessionTime: item.start_time,
                                  })
                                }
                              >
                                <SelectTrigger className={`h-8 w-[132px] shrink-0 text-xs font-semibold ${status.className}`}>
                                  <SelectValue>{status.label}</SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="booked">Записан</SelectItem>
                                  <SelectItem value="completed">Пришёл</SelectItem>
                                  <SelectItem value="absent">Не пришёл</SelectItem>
                                  <SelectItem value="cancelled">Отмена (возврат)</SelectItem>
                                  <SelectItem value="late_cancel">Поздняя отмена</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </ScrollArea>
                </DialogContent>
              </Dialog>
            );
          })
        )}
      </div>
    </div>
  );
};
