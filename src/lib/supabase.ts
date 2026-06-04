import { createBrowserClient } from '@supabase/ssr';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env';

export const createClient = () => {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
};

export const createServerClient = async () => {
  const cookieStore = await (await import('next/headers')).cookies();

  const { createServerClient } = await import('@supabase/ssr');

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY,
    {
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
            // Ignore errors in middleware/edge
          }
        },
      },
    }
  );
};