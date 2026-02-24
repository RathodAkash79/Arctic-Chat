'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Snowflake, Lock, AlertCircle } from 'lucide-react';
import styles from '../login/login.module.scss';

export default function ResetPasswordPage() {
    const router = useRouter();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Supabase sends the user back here with a session cookie after clicking the link
    useEffect(() => {
        supabase.auth.onAuthStateChange((event) => {
            if (event === 'PASSWORD_RECOVERY') {
                // User is authenticated via the recovery link — form is now active
            }
        });
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== confirm) {
            setError('Passwords do not match.');
            return;
        }
        if (password.length < 8) {
            setError('Password must be at least 8 characters.');
            return;
        }

        setLoading(true);
        setError('');

        const { error: updateError } = await supabase.auth.updateUser({ password });

        setLoading(false);

        if (updateError) {
            setError(updateError.message);
        } else {
            // Password updated — redirect to login
            router.replace('/auth/login');
        }
    };

    return (
        <div className={styles.card}>
            <div className={styles.branding}>
                <div className={styles.logoIcon}>
                    <img src="/icon.svg" alt="Arctic Chat Logo" width={32} height={32} />
                </div>
                <h1 className={styles.title}>New Password</h1>
                <p className={styles.subtitle}>Enter and confirm your new password.</p>
            </div>

            {error && (
                <div className={styles.alertError}>
                    <AlertCircle size={18} />
                    <span>{error}</span>
                </div>
            )}

            <form onSubmit={handleSubmit} className={styles.form}>
                <div className={styles.inputGroup}>
                    <label htmlFor="new-password">New Password</label>
                    <div className={styles.inputWrapper}>
                        <Lock size={18} className={styles.iconLeft} />
                        <input
                            type="password"
                            id="new-password"
                            placeholder="Min 8 characters"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            disabled={loading}
                            minLength={8}
                        />
                    </div>
                </div>
                <div className={styles.inputGroup}>
                    <label htmlFor="confirm-password">Confirm Password</label>
                    <div className={styles.inputWrapper}>
                        <Lock size={18} className={styles.iconLeft} />
                        <input
                            type="password"
                            id="confirm-password"
                            placeholder="Repeat password"
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            required
                            disabled={loading}
                        />
                    </div>
                </div>

                <button type="submit" className={styles.submitButton} disabled={loading}>
                    <span className={styles.buttonContent}>
                        {loading && <span className={styles.spinner} />}
                        {loading ? 'Updating...' : 'Update Password'}
                    </span>
                </button>
            </form>
        </div>
    );
}
