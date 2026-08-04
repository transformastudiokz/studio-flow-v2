import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const adminSession = { user: { id: "admin-1" } } as Session;
const authMock = vi.hoisted(() => ({
  authListener: undefined as ((event: string, session: Session | null) => void) | undefined,
  roleResponse: Promise.resolve({ data: { role: "admin" }, error: null }) as Promise<{
    data: { role: string } | null;
    error: null;
  }>,
  unsubscribe: vi.fn(),
  getSession: vi.fn(),
  maybeSingle: vi.fn(),
}));

authMock.maybeSingle.mockImplementation(() => authMock.roleResponse);

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: authMock.getSession,
      onAuthStateChange: (listener: typeof authMock.authListener) => {
        authMock.authListener = listener;
        return { data: { subscription: { unsubscribe: authMock.unsubscribe } } };
      },
      signOut: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: authMock.maybeSingle })),
      })),
    })),
  },
}));

import { ProtectedRoute } from "@/App";

describe("ProtectedRoute", () => {
  beforeEach(() => {
    authMock.authListener = undefined;
    authMock.roleResponse = Promise.resolve({ data: { role: "admin" }, error: null });
    authMock.getSession.mockResolvedValue({ data: { session: adminSession } });
    authMock.maybeSingle.mockClear();
    authMock.unsubscribe.mockClear();
  });

  it("keeps an open form mounted while the same user's role is checked in the background", async () => {
    let resolveBackgroundCheck: ((value: { data: { role: string }; error: null }) => void) | undefined;

    render(
      <MemoryRouter>
        <ProtectedRoute checkAdmin>
          <label>
            Имя
            <input aria-label="Имя" defaultValue="" />
          </label>
        </ProtectedRoute>
      </MemoryRouter>,
    );

    const input = await screen.findByLabelText("Имя");
    fireEvent.change(input, { target: { value: "Несохранённое имя" } });

    authMock.roleResponse = new Promise((resolve) => {
      resolveBackgroundCheck = resolve;
    });

    await act(async () => {
      authMock.authListener?.("TOKEN_REFRESHED", adminSession);
    });

    expect(screen.getByLabelText("Имя")).toHaveValue("Несохранённое имя");

    await act(async () => {
      resolveBackgroundCheck?.({ data: { role: "admin" }, error: null });
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Имя")).toHaveValue("Несохранённое имя");
    });
  });
});
