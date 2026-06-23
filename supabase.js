import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://clwgwwrmxqnfaepqrmli.supabase.co'
const supabaseAnonKey = 'eyJVU19DUElfTWF5XzIwMjYiOiB7ImhlYWRsaW5lX3lvWSI6ICI0LjIlIiwgImNvcmVfeW9ZIjogIjIuOSUifSwgIkluZGlhX0NQSV9NYXlfMjAyNiI6IHsiaGVhZGxpbmVfeW9ZIjogIjMuOTMlIiwgImZvb2RfeW9ZIjogIjQuNzglIn19
    '

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
    },
    realtime: {
        params: {
            eventsPerSecond: 10
        }
    }
})

// Helper to get current user profile
export const getCurrentProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    
    const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
    
    return profile;
}
