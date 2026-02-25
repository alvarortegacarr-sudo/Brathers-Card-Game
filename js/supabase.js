const SUPABASE_URL = 'https://cgbwupduikywkknwwkab.supabase.co';
const SUPABASE_KEY = 'sb_publishable_CJvDobHTCqwvEMqR3LjMdQ_y_WC4Y-F'; // Your actual key

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  }
});