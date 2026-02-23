'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  User as UserIcon,
  Camera,
  AlertCircle,
} from 'lucide-react';
import styles from './setup-profile.module.scss';

export default function SetupProfilePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState('');
  const [pfpFile, setPfpFile] = useState<File | null>(null);
  const [pfpPreview, setPfpPreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push('/auth/login');
        return;
      }

      setUserId(user.id);

      // If profile already exists, redirect to main app
      const { data: profile } = await supabase
        .from('users')
        .select('id')
        .eq('id', user.id)
        .single();

      if (profile) {
        router.push('/');
      }
    };

    checkAuth();
  }, [router]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be less than 5MB.');
      return;
    }

    setPfpFile(file);
    setError('');

    // Generate preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPfpPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!displayName.trim()) {
      setError('Display name is required.');
      setLoading(false);
      return;
    }

    if (!userId) {
      setError('Session expired. Please log in again.');
      setLoading(false);
      return;
    }

    try {
      let pfpUrl = '';

      // Upload profile picture if provided
      if (pfpFile) {
        const formData = new FormData();
        formData.append('file', pfpFile);
        formData.append('purpose', 'profile');

        const uploadResponse = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });

        if (!uploadResponse.ok) {
          const errorData = await uploadResponse.json();
          throw new Error(errorData.error || 'Image upload failed.');
        }

        const uploadData = await uploadResponse.json();
        pfpUrl = uploadData.url;
      }

      // Get user email from auth
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        setError('Could not retrieve your email. Please log in again.');
        setLoading(false);
        return;
      }

      // Create user profile
      const { error: insertError } = await supabase
        .from('users')
        .insert({
          id: userId,
          email: user.email.toLowerCase(),
          display_name: displayName.trim(),
          pfp_url: pfpUrl,
          role: 'staff',
          role_weight: 50,
          status: 'active',
        });

      if (insertError) {
        setError(insertError.message);
        setLoading(false);
        return;
      }

      // Success → redirect to main app
      router.push('/');
    } catch (err) {
      console.error('Profile setup error:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setLoading(false);
    }
  };

  return (
    <div className={styles.card}>
      {/* Branding */}
      <div className={styles.branding}>
        <h1 className={styles.title}>Welcome! 👋</h1>
        <p className={styles.subtitle}>Set up your Arctic Chat profile</p>
      </div>

      {/* Error */}
      {error && (
        <div className={styles.alertError}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className={styles.form}>
        {/* Avatar Upload */}
        <div className={styles.avatarSection}>
          <div
            className={styles.avatarPreview}
            onClick={handleAvatarClick}
            role="button"
            tabIndex={0}
            aria-label="Upload profile picture"
          >
            {pfpPreview ? (
              <img src={pfpPreview} alt="Profile preview" />
            ) : (
              <UserIcon size={44} strokeWidth={1.2} />
            )}
            <div className={styles.avatarOverlay}>
              <Camera size={24} />
            </div>
          </div>
          <input
            type="file"
            ref={fileInputRef}
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
            disabled={loading}
            className={styles.fileInput}
          />
          <span className={styles.avatarHint}>
            Click to upload • Max 5MB (JPG, PNG, WEBP)
          </span>
        </div>

        {/* Display Name */}
        <div className={styles.inputGroup}>
          <label htmlFor="displayName">Display Name</label>
          <input
            type="text"
            id="displayName"
            placeholder="e.g. John Doe"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            disabled={loading}
            maxLength={50}
            autoComplete="name"
          />
          <span className={styles.hint}>
            This is how others will see you in chats
          </span>
        </div>

        {/* Submit */}
        <button
          type="submit"
          className={styles.submitButton}
          disabled={loading || !displayName.trim()}
        >
          <span className={styles.buttonContent}>
            {loading && <span className={styles.spinner} />}
            {loading ? 'Creating profile...' : 'Continue to Arctic Chat →'}
          </span>
        </button>
      </form>
    </div>
  );
}
