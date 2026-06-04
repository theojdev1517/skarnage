'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';

export function useAuth() {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const ensureUser = async () => {
      let {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) {
          console.error('Anonymous sign-in failed:', error);
          setAuthError(
            'Could not sign you in. Refresh the page or check that anonymous auth is enabled.'
          );
        }
        user = data.user ?? null;
      }

      setUserId(user?.id ?? null);
      if (user) setAuthError(null);
      setLoading(false);
    };

    ensureUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { userId, loading, authError };
}