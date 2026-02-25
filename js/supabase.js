// ==========================================
// SUPABASE CLIENT SETUP
// ==========================================

// Your Supabase credentials
const SUPABASE_URL = 'https://cgbwupduikywkknwwkab.supabase.co'; // Replace with your URL
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnYnd1cGR1aWt5d2trbnd3a2FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEwOTQ2NDcsImV4cCI6MjA4NjY3MDY0N30.U0Z_ejpsmtR22RRTVCvjCaRpz2ZENgUhVnGv5mXmxmE'; // Replace with your anon key

// Create client
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Expose to window for modules to access
window.supabaseClient = supabaseClient;

console.log('Supabase client initialized:', !!window.supabaseClient);