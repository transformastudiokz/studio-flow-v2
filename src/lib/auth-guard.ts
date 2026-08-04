import type { Session } from "@supabase/supabase-js";

export type RoleCheckMode = "blocking" | "background";

export const getRoleCheckMode = (
  currentUserId: string | null,
  nextUserId: string,
): RoleCheckMode => (currentUserId === nextUserId ? "background" : "blocking");

export const shouldBlockProtectedRoute = (
  session: Session | null | undefined,
  checkAdmin: boolean,
  isAdmin: boolean | null,
) => session === undefined || Boolean(checkAdmin && session && isAdmin === null);
