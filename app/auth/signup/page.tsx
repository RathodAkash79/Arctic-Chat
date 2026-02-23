'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  Snowflake,
  Mail,
  Lock,
  AlertCircle,
  CheckCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import styles from './signup.module.scss';
import Link from 'next/link';

function getPasswordStrength(password: string) {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) return { level: 'weak', label: 'Weak' };
  if (score === 2) return { level: 'fair', label: 'Fair' };
  if (score === 3) return { level: 'good', label: 'Good' };
  return { level: 'strong', label: 'Strong' };
}

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const strength = getPasswordStrength(password);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess(false);

    // -- Validations --
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      setLoading(false);
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      setLoading(false);
      return;
    }

    try {
      // 1. Whitelist check (case-insensitive)
      const emailLower = email.toLowerCase().trim();

      const { data: whitelistEntry, error: whitelistError } = await supabase
        .from('whitelist')
        .select('email')
        .ilike('email', emailLower)
        .single();

      if (whitelistError || !whitelistEntry) {
        setError(
          'This email is not whitelisted. Contact your admin to request access.'
        );
        setLoading(false);
        return;
      }

      // 2. Sign up via Supabase Auth
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: emailLower,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/setup-profile`,
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        setLoading(false);
        return;
      }

      if (data.user) {
        setSuccess(true);
        // Redirect to profile setup
        setTimeout(() => {
          router.push('/auth/setup-profile');
        }, 1500);
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
          <Snowflake size={28} strokeWidth={1.5} />
        </div>
        <h1 className={styles.title}>
          <span>Arctic Chat</span>
        </h1>
        <p className={styles.subtitle}>Create your account</p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className={styles.alertError}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Success Alert */}
      {success && (
        <div className={styles.alertSuccess}>
          <CheckCircle size={18} />
          <span>Account created! Redirecting to profile setup...</span>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSignup} className={styles.form}>
        {/* Email */}
        <div className={styles.inputGroup}>
          <label htmlFor="signup-email">Email</label>
          <div className={styles.inputWrapper}>
            <Mail size={18} className={styles.iconLeft} />
            <input
              type="email"
              id="signup-email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading || success}
              autoComplete="email"
            />
          </div>
          <span className={styles.hint}>Only whitelisted emails can register</span>
        </div>

        {/* Password */}
        <div className={styles.inputGroup}>
          <label htmlFor="signup-password">Password</label>
          <div className={styles.inputWrapper}>
            <Lock size={18} className={styles.iconLeft} />
            <input
              type={showPassword ? 'text' : 'password'}
              id="signup-password"
              placeholder="Min. 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading || success}
              minLength={8}
              autoComplete="new-password"
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

          {/* Password Strength */}
          {password.length > 0 && (
            <>
              <div className={styles.strengthBar}>
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className={`${styles.strengthSegment} ${i <= (strength.level === 'weak' ? 1 : strength.level === 'fair' ? 2 : strength.level === 'good' ? 3 : 4)
                        ? `${styles.active} ${styles[strength.level]}`
                        : ''
                      }`}
                  />
                ))}
              </div>
              <span className={`${styles.strengthLabel} ${styles[strength.level]}`}>
                {strength.label}
              </span>
            </>
          )}
        </div>

        {/* Confirm Password */}
        <div className={styles.inputGroup}>
          <label htmlFor="signup-confirm">Confirm Password</label>
          <div className={styles.inputWrapper}>
            <Lock size={18} className={styles.iconLeft} />
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              id="signup-confirm"
              placeholder="Re-enter password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={loading || success}
              minLength={8}
              autoComplete="new-password"
            />
            <button
              type="button"
              className={styles.togglePassword}
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              tabIndex={-1}
              aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
            >
              {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          className={styles.submitButton}
          disabled={loading || success}
        >
          <span className={styles.buttonContent}>
            {loading && <span className={styles.spinner} />}
            {loading ? 'Creating account...' : success ? 'Success!' : 'Sign Up'}
          </span>
        </button>
      </form>

      {/* Footer */}
      <div className={styles.footer}>
        <p>
          Already have an account?{' '}
          <Link href="/auth/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
