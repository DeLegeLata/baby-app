// The Supabase client, built from the two values in .env.local. With no
// values the app still runs, logging to this phone only.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const configured = Boolean(url && key);

export const supabase: SupabaseClient | null = configured
  ? createClient(url!, key!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // No magic links or OAuth: both break in an installed iPhone web app.
        detectSessionInUrl: false
      }
    })
  : null;

export async function signIn(email: string, password: string) {
  if (!supabase) throw new Error('Supabase is not configured on this build');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  await supabase?.auth.signOut();
}
