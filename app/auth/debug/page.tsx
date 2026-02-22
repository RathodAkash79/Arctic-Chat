'use client';

import { useState } from 'react';
import { Mail, Check, X, AlertCircle } from 'lucide-react';
import styles from './debug.module.scss';

export default function WhitelistDebugPage() {
  const [email, setEmail] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const handleCheck = async () => {
    if (!email.trim()) {
      setError('Please enter an email');
      return;
    }

    setChecking(true);
    setError('');
    setResult(null);

    try {
      const response = await fetch(
        `/api/auth/whitelist-check?email=${encodeURIComponent(email)}`
      );
      const data = await response.json();
      setResult(data);
    } catch (err) {
      console.error('Check error:', err);
      setError('Failed to check whitelist');
    } finally {
      setChecking(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCheck();
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1>🔍 Whitelist Debug Tool</h1>
        <p>Check if your email is whitelisted before signing up</p>

        <div className={styles.form}>
          <div className={styles.inputGroup}>
            <label>Check Email</label>
            <div className={styles.inputWrapper}>
              <Mail size={20} className={styles.icon} />
              <input
                type="email"
                placeholder="your.email@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyPress={handleKeyPress}
                disabled={checking}
              />
            </div>
          </div>

          <button
            onClick={handleCheck}
            disabled={checking || !email.trim()}
            className={styles.button}
          >
            {checking ? 'Checking...' : 'Check Whitelist'}
          </button>
        </div>

        {error && (
          <div className={styles.error}>
            <AlertCircle size={18} />
            {error}
          </div>
        )}

        {result && (
          <div
            className={`${styles.result} ${
              result.whitelisted ? styles.success : styles.fail
            }`}
          >
            <div className={styles.status}>
              {result.whitelisted ? (
                <>
                  <Check size={24} />
                  <span>✅ Whitelisted</span>
                </>
              ) : (
                <>
                  <X size={24} />
                  <span>❌ Not Whitelisted</span>
                </>
              )}
            </div>

            <div className={styles.details}>
              <p>
                <strong>Email:</strong> {result.email}
              </p>
              {result.added_at && (
                <p>
                  <strong>Added:</strong>{' '}
                  {new Date(result.added_at).toLocaleString()}
                </p>
              )}
              {result.message && (
                <p>
                  <strong>Message:</strong> {result.message}
                </p>
              )}
            </div>

            {!result.whitelisted && (
              <div className={styles.hint}>
                <p>
                  Your email is not in the whitelist. Please ask an administrator to add it.
                </p>
                <code>{email.toLowerCase().trim()}</code>
              </div>
            )}
          </div>
        )}

        <div className={styles.info}>
          <h3>ℹ️ How it works:</h3>
          <ul>
            <li>Enter your email above to check if it's whitelisted</li>
            <li>If ✅, you can proceed with signup</li>
            <li>If ❌, contact your admin with this exact email: <code>{email.toLowerCase()}</code></li>
            <li>Email check is case-insensitive</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
