import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

const ClientInstructors = () => {
  const [selectedCoach, setSelectedCoach] = useState<any>(null);

  // Загружаем тренеров со специализациями
  const { data: instructors = [], isLoading } = useQuery({
    queryKey: ['portal_instructors'],
    queryFn: async () => {
      const response = await fetch('/api/portal-trainers');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не удалось загрузить тренеров');
      return result.trainers || [];
    }
  });

  return (
      <div className="client-page space-y-6">
        <h1 className="client-page-title">Наши тренеры</h1>
        
        {isLoading ? (
          <div className="flex justify-center p-8"><Loader2 className="w-8 h-8 animate-spin text-primary"/></div>
        ) : instructors.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">Список тренеров пуст</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {instructors.map((coach: any) => (
              <Card 
                key={coach.id} 
                className="client-surface client-focus cursor-pointer overflow-hidden transition-shadow hover:shadow-md"
                onClick={() => setSelectedCoach(coach)}
              >
                <CardContent className="flex items-center gap-3 p-3.5">
                  <Avatar className="h-14 w-14 shrink-0 border-2 border-white shadow-sm">
                    <AvatarImage src={coach.photo_url} alt={coach.display_name} className="object-cover" />
                    <AvatarFallback className="bg-[#e4eae4] text-[var(--client-sage-deep)] text-xl font-bold">
                      {coach.display_name?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  
                  <div className="flex-1 min-w-0">
                    <h3 className="truncate text-base font-bold">{coach.display_name}</h3>
                    {coach.specializations?.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {coach.specializations.slice(0, 2).map((s: any, i: number) => (
                          <span key={i} className="rounded-full bg-[#e4eae4] px-2 py-1 text-[10px] font-semibold text-[var(--client-sage-deep)]">
                            {s.class_type?.name}
                          </span>
                        ))}
                        {coach.specializations.length > 2 ? <span className="rounded-full bg-[#ece8df] px-2 py-1 text-[10px] font-semibold text-[#6f706b]">ещё {coach.specializations.length - 2}</span> : null}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 line-clamp-2 mt-1 leading-snug">
                        {coach.description || "Инструктор студии"}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Модальное окно с деталями */}
        <Dialog open={!!selectedCoach} onOpenChange={(open) => !open && setSelectedCoach(null)}>
            <DialogContent className="max-w-sm sm:max-w-md rounded-2xl p-0 overflow-hidden gap-0">
                
                {/* Фото в шапке */}
                <div className="relative h-48 bg-gray-100 w-full">
                    {selectedCoach?.photo_url ? (
                        <img 
                            src={selectedCoach.photo_url} 
                            alt={selectedCoach.display_name}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[#e4eae4] text-[var(--client-sage-deep)]">
                            <span className="text-6xl font-bold">{selectedCoach?.display_name?.[0]}</span>
                        </div>
                    )}
                    
                    {/* Кнопка закрытия */}
                    <button 
                        onClick={() => setSelectedCoach(null)}
                        aria-label="Закрыть"
                        className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/20 text-white backdrop-blur-sm transition-colors hover:bg-black/40"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6">
                    <DialogHeader className="mb-4 text-left">
                        <DialogTitle className="text-2xl font-bold">{selectedCoach?.display_name}</DialogTitle>
                        {/* Если есть отдельное поле специализации, можно добавить его сюда */}
                        {selectedCoach?.specializations?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {selectedCoach.specializations.map((s: any, i: number) => (
                            <span key={i} className="rounded-full bg-[#e4eae4] px-2 py-1 text-xs font-semibold text-[var(--client-sage-deep)]">
                            {s.class_type?.name}
                          </span>
                        ))}
                      </div>
                    )}
                    </DialogHeader>

                    <ScrollArea className="max-h-[300px] pr-2">
                        <div className="text-sm text-gray-600 leading-relaxed space-y-2">
                            {selectedCoach?.description ? (
                                selectedCoach.description.split('\n').map((paragraph: string, i: number) => (
                                    <p key={i}>{paragraph}</p>
                                ))
                            ) : (
                                <p className="italic text-gray-400">Информация о тренере пока не заполнена.</p>
                            )}
                        </div>
                    </ScrollArea>

                    <DialogFooter className="mt-6">
                        <Button className="w-full rounded-xl" onClick={() => setSelectedCoach(null)}>
                            Закрыть
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
      </div>
  );
};

export default ClientInstructors;
