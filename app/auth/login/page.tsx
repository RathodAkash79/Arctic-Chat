'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  Mail,
  Lock,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import styles from './login.module.scss';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // Sign in with Supabase Auth
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.toLowerCase().trim(),
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
          .select('id, status, timeout_until')
          .eq('id', data.user.id)
          .single();

        if (profileError || !profile) {
          // No profile yet → setup
          router.push('/auth/setup-profile');
          return;
        }

        // Check ban status
        if (profile.status === 'banned') {
          setError('Your account has been banned. Contact an administrator.');
          await supabase.auth.signOut();
          setLoading(false);
          return;
        }

        // Check timeout status
        if (profile.status === 'timeout' && profile.timeout_until) {
          const timeoutDate = new Date(profile.timeout_until);
          if (timeoutDate > new Date()) {
            setError(
              `Your account is timed out until ${timeoutDate.toLocaleString()}.`
            );
            await supabase.auth.signOut();
            setLoading(false);
            return;
          }
        }

        // Success → redirect to main app
        router.push('/');
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.card}>
      {/* Branding */}
      <div className={styles.branding}>
        <div className={styles.logoIcon}>
          <img src="/icon.svg" alt="Arctic Chat Logo" width={32} height={32} />
        </div>
        <h1 className={styles.title}>
          <span>Arctic Chat</span>
        </h1>
        <p className={styles.subtitle}>Sign in to your account</p>
      </div>

      {/* Error */}
      {error && (
        <div className={styles.alertError}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleLogin} className={styles.form}>
        {/* Email */}
        <div className={styles.inputGroup}>
          <label htmlFor="login-email">Email</label>
          <div className={styles.inputWrapper}>
            <Mail size={18} className={styles.iconLeft} />
            <input
              type="email"
              id="login-email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              autoComplete="email"
            />
          </div>
        </div>

        {/* Password */}
        <div className={styles.inputGroup}>
          <label htmlFor="login-password">Password</label>
          <div className={styles.inputWrapper}>
            <Lock size={18} className={styles.iconLeft} />
            <input
              type={showPassword ? 'text' : 'password'}
              id="login-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              autoComplete="current-password"
            />
            <button
              type="button"
              className={styles.togglePassword}
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          className={styles.submitButton}
          disabled={loading}
        >
          <span className={styles.buttonContent}>
            {loading && <span className={styles.spinner} />}
            {loading ? 'Signing in...' : 'Sign In'}
          </span>
        </button>
      </form>

      {/* Footer */}
      <div className={styles.footer}>
        <p>
          Don&apos;t have an account?{' '}
          <Link href="/auth/signup">Sign up</Link>
        </p>
        <Link href="/auth/forgot-password" className={styles.forgotLink}>
          Forgot password?
        </Link>
      </div>
    </div>
  );
}
