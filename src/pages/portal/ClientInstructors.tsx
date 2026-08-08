import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
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
      const { data, error } = await supabase
        .from('coaches')
        .select('*, specializations:coach_class_types(class_type:class_types(name, color))')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      return data;
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
                <CardContent className="p-4 flex items-center gap-4">
                  <Avatar className="w-16 h-16 border-2 border-white shadow-sm shrink-0">
                    <AvatarImage src={coach.photo_url} alt={coach.name} className="object-cover" />
                    <AvatarFallback className="bg-[#e4eae4] text-[var(--client-sage-deep)] text-xl font-bold">
                      {coach.name?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-lg truncate">{coach.name}</h3>
                    {coach.specializations?.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {coach.specializations.map((s: any, i: number) => (
                          <span key={i} className="rounded-full bg-[#e4eae4] px-2 py-1 text-[10px] font-semibold text-[var(--client-sage-deep)]">
                            {s.class_type?.name}
                          </span>
                        ))}
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
                            alt={selectedCoach.name} 
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center bg-blue-50 text-blue-300">
                            <span className="text-6xl font-bold">{selectedCoach?.name?.[0]}</span>
                        </div>
                    )}
                    
                    {/* Кнопка закрытия */}
                    <button 
                        onClick={() => setSelectedCoach(null)}
                        className="absolute top-3 right-3 p-1.5 bg-black/20 hover:bg-black/40 text-white rounded-full backdrop-blur-sm transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6">
                    <DialogHeader className="mb-4 text-left">
                        <DialogTitle className="text-2xl font-bold">{selectedCoach?.name}</DialogTitle>
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
