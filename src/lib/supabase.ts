import { createClient } from '@supabase/supabase-js';

const FALLBACK_URL = 'https://ygzcbgugcvicbmusgfie.supabase.co';
const FALLBACK_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlnemNiZ3VnY3ZpY2JtdXNnZmllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwMTAzMDgsImV4cCI6MjEwMjU4NjMwOH0.kqgN6qNxNmK44zUYz6KpxMTr3aoyMoEzK4XqVq9OYtc';

const envUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

const supabaseUrl = envUrl || FALLBACK_URL;
const supabaseAnonKey = envKey || FALLBACK_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 20,
    },
  },
});
