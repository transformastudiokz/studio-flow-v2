import { describe, expect, it } from "vitest";
import type { Session } from "@supabase/supabase-js";

import { getRoleCheckMode, shouldBlockProtectedRoute } from "@/lib/auth-guard";

const session = { user: { id: "admin-1" } } as Session;

describe("protected route loading behavior", () => {
  it("blocks the interface while the initial session is unknown", () => {
    expect(shouldBlockProtectedRoute(undefined, true, null)).toBe(true);
  });

  it("blocks the first admin role check", () => {
    expect(shouldBlockProtectedRoute(session, true, null)).toBe(true);
    expect(getRoleCheckMode(null, session.user.id)).toBe("blocking");
  });

  it("keeps the interface mounted for background checks of the same user", () => {
    expect(getRoleCheckMode(session.user.id, session.user.id)).toBe("background");
    expect(shouldBlockProtectedRoute(session, true, true)).toBe(false);
  });

  it("does not block the client portal after the session is resolved", () => {
    expect(shouldBlockProtectedRoute(session, false, false)).toBe(false);
  });
});
