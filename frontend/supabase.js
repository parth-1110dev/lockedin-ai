
// Browser-friendly Supabase client using CDN ESM build.
const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm')

const SUPABASE_URL = 'https://uaxokyhmpettnxxrhntv.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVheG9reWhtcGV0dG54eHJobnR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MDQ5MzcsImV4cCI6MjA5MzI4MDkzN30.oE-3uyRKvFJmOyMqOSuhBk6tPoMWw5obW4leRREc7b4'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export default supabase
