'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import type { User } from '@/types';
import { resolveImageUrl } from '@/lib/utils';

export function useAuth() {
    const router = useRouter();
    const { currentUser, setCurrentUser } = useAppStore();
    const [loading, setLoading] = useState(true);

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
            }
        };

        init();

        // Listen for auth changes (sign out, etc.)
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                if (event === 'SIGNED_OUT') {
                    setCurrentUser(null);
                    router.replace('/auth/login');
                } else if (event === 'SIGNED_IN' && session?.user) {
                    const profile = await fetchProfile(session.user.id);
                    if (profile && mounted) {
                        setCurrentUser(profile);
                    }
                }
            }
        );

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, [fetchProfile, router, setCurrentUser]);

    // Sign out
    const signOut = useCallback(async () => {
        await supabase.auth.signOut();
        setCurrentUser(null);
        router.replace('/auth/login');
    }, [router, setCurrentUser]);

    return { currentUser, loading, signOut };
}
