const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env — copy .env.example to .env and fill it in.'
  );
}

// Service-role client: bypasses RLS. Only ever used server-side, never sent
// to the frontend. Used for: verifying user tokens, admin-only reads/writes,
// and calculations that need a consistent view of the rate card.
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

module.exports = { supabaseAdmin };
