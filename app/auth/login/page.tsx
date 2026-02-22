'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Mail, Lock, AlertCircle } from 'lucide-react';
import styles from './login.module.scss';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // Attempt login with Supabase Auth
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }

      if (data.user) {
        // Check if user profile exists
        const { data: profile, error: profileError } = await supabase
          .from('users')
          .select('*')
          .eq('id', data.user.id)
          .single();

        if (profileError || !profile) {
          // Profile doesn't exist, redirect to setup
          router.push('/auth/setup-profile');
        } else {
          // Check if user is banned or timed out
          if (profile.status === 'banned') {
            setError('Your account has been banned. Contact an administrator.');
            await supabase.auth.signOut();
            setLoading(false);
            return;
          }

          if (profile.status === 'timeout' && profile.timeout_until) {
            const timeoutDate = new Date(profile.timeout_until);
            if (timeoutDate > new Date()) {
              setError(`Your account is timed out until ${timeoutDate.toLocaleString()}`);
              await supabase.auth.signOut();
              setLoading(false);
              return;
            }
          }

          // Success! Redirect to main app
          router.push('/');
        }
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h1>Arctic Chat</h1>
          <p>Sign in to your account</p>
        </div>

        {error && (
          <div className={styles.error}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className={styles.form}>
          <div className={styles.inputGroup}>
            <label htmlFor="email">Email</label>
            <div className={styles.inputWrapper}>
              <Mail size={18} className={styles.icon} />
              <input
                type="email"
                id="email"
                placeholder="your.email@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className={styles.inputGroup}>
            <label htmlFor="password">Password</label>
            <div className={styles.inputWrapper}>
              <Lock size={18} className={styles.icon} />
              <input
                type="password"
                id="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          </div>

          <button 
            type="submit" 
            className={styles.submitButton}
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className={styles.footer}>
          <p>
            Don't have an account?{' '}
            <Link href="/auth/signup">Sign up</Link>
          </p>
          <Link href="/auth/forgot-password" className={styles.forgotLink}>
            Forgot password?
          </Link>
        </div>
      </div>
    </div>
  );
}
