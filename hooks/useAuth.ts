'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import type { User } from '@/types';
import { resolveImageUrl } from '@/lib/utils';

export function useAuth() {
    const router = useRouter();
    const { currentUser, setCurrentUser } = useAppStore();
    const [loading, setLoading] = useState(true);
    const statusChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

    // Fetch user profile from the users table
    const fetchProfile = useCallback(async (userId: string): Promise<User | null> => {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();

        if (error || !data) return null;
        const user = data as User;
        user.pfp_url = resolveImageUrl(user.pfp_url);
        return user;
    }, []);

    // Subscribe to realtime status changes — force logout if banned/timed out
    const subscribeToStatusChanges = useCallback((userId: string) => {
        if (statusChannelRef.current) {
            supabase.removeChannel(statusChannelRef.current);
        }

        statusChannelRef.current = supabase
            .channel(`user-status-${userId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'users',
                    filter: `id=eq.${userId}`,
                },
                async (payload) => {
                    const updated = payload.new as { status: string; timeout_until?: string | null };
                    const isBanned = updated.status === 'banned';
                    const isActiveTimeout =
                        updated.status === 'timeout' &&
                        updated.timeout_until &&
                        new Date(updated.timeout_until) > new Date();

                    if (isBanned || isActiveTimeout) {
                        // Force logout immediately
                        await supabase.auth.signOut();
                        setCurrentUser(null);
                        router.replace('/auth/login');
                    } else {
                        // Refresh profile in store to reflect updated status
                        const fresh = await fetchProfile(userId);
                        if (fresh) setCurrentUser(fresh);
                    }
                }
            )
            .subscribe();
    }, [fetchProfile, setCurrentUser, router]);

    // Initialize auth state
    useEffect(() => {
        let mounted = true;

        const init = async () => {
            try {
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

                // Check ban/timeout at login time
                if (profile.status === 'banned') {
                    await supabase.auth.signOut();
                    if (mounted) {
                        setCurrentUser(null);
                        setLoading(false);
                        router.replace('/auth/login');
                    }
                    return;
                }

                if (profile.status === 'timeout' && profile.timeout_until) {
                    if (new Date(profile.timeout_until) > new Date()) {
                        await supabase.auth.signOut();
                        if (mounted) {
                            setCurrentUser(null);
                            setLoading(false);
                            router.replace('/auth/login');
                        }
                        return;
                    }
                }

                if (mounted) {
                    setCurrentUser(profile);
                    subscribeToStatusChanges(profile.id);
                    setLoading(false);
                }
            } catch (err) {
                console.error('[useAuth] Init failed:', err);
                if (mounted) {
                    setLoading(false);
                    router.replace('/auth/login');
                }
            }
        };

        // Safety timeout: if init() hangs (stale connection), force loading=false after 10s
        const safetyTimer = setTimeout(() => {
            if (mounted && loading) {
                console.warn('[useAuth] Auth init timed out after 10s — forcing load complete');
                setLoading(false);
            }
        }, 10000);

        init().finally(() => clearTimeout(safetyTimer));

        // Listen for auth changes (sign out, etc.)
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                if (event === 'SIGNED_OUT') {
                    setCurrentUser(null);
                    if (statusChannelRef.current) {
                        supabase.removeChannel(statusChannelRef.current);
                        statusChannelRef.current = null;
                    }
                    router.replace('/auth/login');
                } else if (event === 'SIGNED_IN' && session?.user) {
                    const profile = await fetchProfile(session.user.id);
                    if (profile && mounted) {
                        setCurrentUser(profile);
                        subscribeToStatusChanges(profile.id);
                    }
                }
            }
        );

        return () => {
            mounted = false;
            subscription.unsubscribe();
            if (statusChannelRef.current) {
                supabase.removeChannel(statusChannelRef.current);
                statusChannelRef.current = null;
            }
        };
    }, [fetchProfile, router, setCurrentUser, subscribeToStatusChanges]);

    // Sign out
    const signOut = useCallback(async () => {
        await supabase.auth.signOut();
        setCurrentUser(null);
        router.replace('/auth/login');
    }, [router, setCurrentUser]);

    return { currentUser, loading, signOut };
}
