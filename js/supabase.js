// ==========================================
// SUPABASE CLIENT SETUP
// ==========================================

// Your Supabase credentials
const SUPABASE_URL = 'https://cgbwupduikywkknwwkab.supabase.co'; // Replace with your URL
const SUPABASE_KEY = 'sb_publishable_CJvDobHTCqwvEMqR3LjMdQ_y_WC4Y-F'; // Replace with your anon key

// Create client
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Expose to window for modules to access
window.supabaseClient = supabaseClient;

console.log('Supabase client initialized:', !!window.supabaseClient);