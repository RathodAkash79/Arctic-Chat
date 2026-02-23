'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import styles from './auth.module.scss';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();

      if (session?.user) {
        // User is already logged in — check if they have a profile
        const { data: profile } = await supabase
          .from('users')
          .select('id')
          .eq('id', session.user.id)
          .single();

        if (profile) {
          // Fully set up user — redirect to main app
          router.replace('/');
          return;
        }
        // No profile yet — allow access to setup-profile page
      }

      setAllowed(true);
      setChecking(false);
    };

    checkSession();
  }, [router]);

  if (checking || !allowed) {
    return (
      <div className={styles.authLayout}>
        <div className={styles.orb} />
        <div className={styles.orb} />
        <div className={styles.orb} />
      </div>
    );
  }

  return (
    <div className={styles.authLayout}>
      <div className={styles.orb} />
      <div className={styles.orb} />
      <div className={styles.orb} />
      <div className={styles.content}>
        {children}
      </div>
    </div>
  );
}
