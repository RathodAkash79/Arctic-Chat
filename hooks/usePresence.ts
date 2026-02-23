'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';

export function usePresence() {
    const { currentUser, setOnlineUsers } = useAppStore();

    useEffect(() => {
        if (!currentUser) return;

        // Create a single global channel for tracking all online users
        const channel = supabase.channel('online-users', {
            config: {
                presence: {
                    key: currentUser.id, // Group presence by user ID
                },
            },
        });

        // Listen for presence synchronization events
        channel
            .on('presence', { event: 'sync' }, () => {
                const newState = channel.presenceState();

                // newState is an object like: { [user_id]: [ { user_id: "...", presence_ref: "..." } ] }
                // We just want a flat array of unique user IDs
                const onlineIds = Object.keys(newState);
                setOnlineUsers(onlineIds);
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    // Track current user as online
                    await channel.track({
                        user_id: currentUser.id,
                        online_at: new Date().toISOString(),
                    });
                }
            });

        // Cleanup: unsubscribe on unmount or user change
        return () => {
            supabase.removeChannel(channel);
        };
    }, [currentUser, setOnlineUsers]);
}
