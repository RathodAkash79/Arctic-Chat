'use client';

import { useAuth } from '@/hooks/useAuth';

export default function ChatLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { currentUser, loading } = useAuth();

    // Show nothing while checking auth (useAuth handles redirects)
    if (loading || !currentUser) {
        return (
            <div
                style={{
                    width: '100vw',
                    height: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'var(--bg-primary)',
                }}
            >
                <div
                    style={{
                        width: 32,
                        height: 32,
                        border: '3px solid rgba(255,255,255,0.1)',
                        borderTopColor: 'var(--accent-primary)',
                        borderRadius: '50%',
                        animation: 'spin 0.6s linear infinite',
                    }}
                />
            </div>
        );
    }

    return <>{children}</>;
}
