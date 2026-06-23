import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://clwgwwrmxqnfaepqrmli.supabase.co'
const supabaseAnonKey = 'sb_secret_oZtS_Er_Zqfmy_XqIgm11Q_XCcLUDYb'

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
