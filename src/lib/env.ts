/** Must use static `process.env.NEXT_PUBLIC_*` access so Next inlines them on the client. */
function requireValue(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(
      `Missing ${label}. Add it to .env.local (see Supabase project settings).`
    );
  }
  return value;
}

export const SUPABASE_URL = requireValue(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  'NEXT_PUBLIC_SUPABASE_URL'
);

export const SUPABASE_ANON_KEY = requireValue(
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  'NEXT_PUBLIC_SUPABASE_ANON_KEY'
);