'use client';

import { useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Mail, AlertCircle, CheckCircle2 } from 'lucide-react';
import styles from '../login/login.module.scss';

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [sent, setSent] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        const { error: resetError } = await supabase.auth.resetPasswordForEmail(
            email.toLowerCase().trim(),
            {
                redirectTo: `${window.location.origin}/auth/reset-password`,
            }
        );

        setLoading(false);

        if (resetError) {
            setError(resetError.message);
        } else {
            setSent(true);
        }
    };

    return (
        <div className={styles.card}>
            {/* Branding */}
            <div className={styles.branding}>
                <div className={styles.logoIcon}>
                    <img src="/icon.svg" alt="Arctic Chat Logo" width={32} height={32} />
                </div>
                <h1 className={styles.title}>Reset Password</h1>
                <p className={styles.subtitle}>
                    {sent
                        ? 'Check your email for a reset link.'
                        : "Enter your email and we'll send you a reset link."}
                </p>
            </div>

            {/* Error */}
            {error && (
                <div className={styles.alertError}>
                    <AlertCircle size={18} />
                    <span>{error}</span>
                </div>
            )}

            {/* Success State */}
            {sent ? (
                <div className={styles.alertSuccess}>
                    <CheckCircle2 size={18} />
                    <span>
                        A password reset link has been sent to <strong>{email}</strong>.
                        Please check your inbox and follow the link to reset your password.
                    </span>
                </div>
            ) : (
                <form onSubmit={handleSubmit} className={styles.form}>
                    <div className={styles.inputGroup}>
                        <label htmlFor="forgot-email">Email</label>
                        <div className={styles.inputWrapper}>
                            <Mail size={18} className={styles.iconLeft} />
                            <input
                                type="email"
                                id="forgot-email"
                                placeholder="you@company.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                disabled={loading}
                                autoComplete="email"
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        className={styles.submitButton}
                        disabled={loading || !email.trim()}
                    >
                        <span className={styles.buttonContent}>
                            {loading && <span className={styles.spinner} />}
                            {loading ? 'Sending...' : 'Send Reset Link'}
                        </span>
                    </button>
                </form>
            )}

            {/* Footer */}
            <div className={styles.footer}>
                <p>
                    <Link href="/auth/login">← Back to Sign In</Link>
                </p>
            </div>
        </div>
    );
}
