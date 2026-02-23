'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import type { User } from '@/types';

const HEARTBEAT_INTERVAL = 60_000; // Update last_seen every 60s

export function useAuth() {
    const router = useRouter();
    const { currentUser, setCurrentUser } = useAppStore();
    const [loading, setLoading] = useState(true);
    const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Fetch user profile from the users table
    const fetchProfile = useCallback(async (userId: string): Promise<User | null> => {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();

        if (error || !data) return null;
        return data as User;
    }, []);

    // Update last_seen heartbeat
    const startHeartbeat = useCallback(() => {
        if (heartbeatRef.current) return;

        // Immediate update
        supabase.rpc('update_last_seen').catch(() => { });

        heartbeatRef.current = setInterval(() => {
            supabase.rpc('update_last_seen').catch(() => { });
        }, HEARTBEAT_INTERVAL);
    }, []);

    const stopHeartbeat = useCallback(() => {
        if (heartbeatRef.current) {
            clearInterval(heartbeatRef.current);
            heartbeatRef.current = null;
        }
    }, []);

    // Initialize auth state
    useEffect(() => {
        let mounted = true;

        const init = async () => {
            const { data: { session } } = await supabase.auth.getSession();

            if (!session?.user) {
                if (mounted) {
                    setCurrentUser(null);
                    setLoading(false);
                    router.replace('/auth/login');
                }
                return;
            }

            const profile = await fetchProfile(session.user.id);

            if (!profile) {
                if (mounted) {
                    setLoading(false);
                    router.replace('/auth/setup-profile');
                }
                return;
            }

            if (mounted) {
                setCurrentUser(profile);
                setLoading(false);
                startHeartbeat();
            }
        };

        init();

        // Listen for auth changes (sign out, etc.)
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                if (event === 'SIGNED_OUT') {
                    setCurrentUser(null);
                    stopHeartbeat();
                    router.replace('/auth/login');
                } else if (event === 'SIGNED_IN' && session?.user) {
                    const profile = await fetchProfile(session.user.id);
                    if (profile && mounted) {
                        setCurrentUser(profile);
                        startHeartbeat();
                    }
                }
            }
        );

        return () => {
            mounted = false;
            subscription.unsubscribe();
            stopHeartbeat();
        };
    }, [fetchProfile, router, setCurrentUser, startHeartbeat, stopHeartbeat]);

    // Sign out
    const signOut = useCallback(async () => {
        stopHeartbeat();
        await supabase.auth.signOut();
        setCurrentUser(null);
        router.replace('/auth/login');
    }, [router, setCurrentUser, stopHeartbeat]);

    return { currentUser, loading, signOut };
}
