import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient as createSupabaseClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Create a Supabase client for server components and API routes.
 * Uses cookie-based auth for SSR.
 */
export const createClient = async () => {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl!, supabaseAnonKey!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // The `setAll` method was called from a Server Component.
        }
      },
    },
  });
};

// Singleton admin client — reused across all API route invocations.
// Avoids creating a new SupabaseClient instance per request, which can
// leak HTTP agents and eventually exhaust file descriptors / memory.
let _adminClient: SupabaseClient | null = null;

/**
 * Create (or return the cached) Supabase admin client that bypasses RLS.
 * Uses the service role key if available, otherwise falls back to anon key.
 * Only use this in API routes where elevated access is needed.
 */
export const createAdminClient = (): SupabaseClient => {
  if (_adminClient) return _adminClient;

  const key = supabaseServiceKey || supabaseAnonKey;
  if (!supabaseUrl || !key) {
    throw new Error(
      "Supabase URL or key is not configured. Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars."
    );
  }

  _adminClient = createSupabaseClient(supabaseUrl, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _adminClient;
};
