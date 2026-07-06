const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey || !anonKey) {
  console.warn('Supabase env vars are missing. API routes depending on Supabase will fail until configured.');
}

const supabaseAdmin = createClient(supabaseUrl || '', serviceRoleKey || '', {
  auth: { persistSession: false }
});

const supabasePublic = createClient(supabaseUrl || '', anonKey || '', {
  auth: { persistSession: false }
});

module.exports = { supabaseAdmin, supabasePublic };
