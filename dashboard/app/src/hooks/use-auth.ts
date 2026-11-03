import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface AuthStatus {
  authenticated: boolean;
}

async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await fetch("/api/auth/status", { credentials: "same-origin" });
  if (!res.ok) return { authenticated: false };
  return (await res.json()) as AuthStatus;
}

export function useAuthStatus() {
  return useQuery<AuthStatus, Error>({
    queryKey: ["auth", "status"],
    queryFn: fetchAuthStatus,
    staleTime: 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
  });
}

/** Thrown by data hooks when the server returns 401 — distinct from network/5xx errors
 * so the UI can tell "please log in" apart from "something broke". */
export class UnauthenticatedError extends Error {
  constructor() {
    super("UNAUTHENTICATED");
    this.name = "UnauthenticatedError";
  }
}

export interface LoginParams {
  username: string;
  password: string;
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, LoginParams>({
    mutationFn: async ({ username, password }) => {
      const res = await fetch("/api/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        if (res.status === 429) {
          const retryAfter = res.headers.get("Retry-After");
          throw new Error(
            retryAfter
              ? `Too many attempts. Try again in ${retryAfter}s.`
              : "Too many attempts. Try again later.",
          );
        }
        const data = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(data.error ?? "Invalid username or password");
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["auth", "status"] });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
    },
    onSettled: () => {
      // Drop any cached health/personal data from memory on logout, and flip
      // the UI back to the login gate regardless of network outcome.
      queryClient.removeQueries({ queryKey: ["dashboard"] });
      queryClient.removeQueries({ queryKey: ["health"] });
      void queryClient.invalidateQueries({ queryKey: ["auth", "status"] });
    },
  });
}
