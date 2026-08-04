import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type StaffRole = "owner" | "admin" | "trainer" | "client";

export const useCurrentProfile = () => useQuery({
  queryKey: ["current_profile"],
  queryFn: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, email, phone, role, position, is_active, must_change_password")
      .eq("id", user.id)
      .single();
    if (error) throw error;
    return data as typeof data & { role: StaffRole };
  },
  staleTime: 30_000,
});
