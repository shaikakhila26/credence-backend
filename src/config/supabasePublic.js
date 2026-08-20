const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

if (!process.env.SUPABASE_ANON_KEY) {
  throw new Error('Missing SUPABASE_ANON_KEY in .env');
}

// This client behaves exactly like a browser client (anon key, no elevated
// privileges) — used only to call signInWithPassword() and mint a real
// session for simulated phone-OTP login. See routes/authPhone.js.
const supabasePublic = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

module.exports = { supabasePublic };
