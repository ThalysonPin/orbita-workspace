import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isPublicSupabaseKey } from "./public-config";

const memoryStorage = new Map<string, string>();
/** Keep authentication in this tab's sessionStorage, never passwords or service keys. */
const tabStorage = {
  getItem(key: string) { try { return window.sessionStorage.getItem(key); } catch { return memoryStorage.get(key) ?? null; } },
  setItem(key: string, value: string) { try { window.sessionStorage.setItem(key, value); } catch { memoryStorage.set(key, value); } },
  removeItem(key: string) { try { window.sessionStorage.removeItem(key); } catch { memoryStorage.delete(key); } },
};
export type PublicConfiguration = { client: SupabaseClient | null; url: string; publishableKey: string; status: "ready" | "missing" | "invalid" };
function configure(): PublicConfiguration {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, "") || "";
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || "";
  if (!url || !publishableKey) return { client: null, url, publishableKey, status: "missing" };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) throw new Error("invalid_url");
    if (!isPublicSupabaseKey(publishableKey)) throw new Error("invalid_key");
    const client = createClient(url, publishableKey, { auth: { storage: tabStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" } });
    return { client, url, publishableKey, status: "ready" };
  } catch { return { client: null, url, publishableKey, status: "invalid" }; }
}
export const configuration = configure();
export function appReturnUrl(): string {
  const result = new URL(import.meta.env.BASE_URL, window.location.origin);
  result.search = ""; result.hash = "";
  return result.href;
}
