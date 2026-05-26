// Supabase client config for BikeSite v2.
//
// These values are intentionally embedded in the public frontend:
//   - SUPABASE_URL: the project's REST/Realtime/Auth endpoint.
//   - SUPABASE_KEY: the "publishable" key (Supabase's renamed anon key).
//     Per Supabase: "Publishable keys can be safely shared publicly."
//     Row-Level Security (supabase/03_rls.sql) is what actually protects the data.
//
// NEVER replace this with a `secret`/`service_role` key or the database password.

export const SUPABASE_URL = 'https://muwboglmwdooismfvuof.supabase.co';
// Legacy anon JWT (role: anon). Safe in client code; RLS gates the data.
// Supabase is migrating to a sb_publishable_* format — either works.
export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im11d2JvZ2xtd2Rvb2lzbWZ2dW9mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0ODA2NzgsImV4cCI6MjA5NTA1NjY3OH0.y2_ejmwkJVFJE_6C0vMqLq0C29zvNSsvcU7jybnemcE';
