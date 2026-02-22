'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { User as UserIcon, Upload, AlertCircle } from 'lucide-react';
import styles from './setup-profile.module.scss';

export default function SetupProfilePage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [pfpFile, setPfpFile] = useState<File | null>(null);
  const [pfpPreview, setPfpPreview] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    // Check if user is authenticated
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/auth/login');
      } else {
        setUserId(user.id);

        // Check if profile already exists
        const { data: profile } = await supabase
          .from('users')
          .select('*')
          .eq('id', user.id)
          .single();

        if (profile) {
          // Profile exists, redirect to main app
          router.push('/');
        }
      }
    };

    checkAuth();
  }, [router]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        setError('Image must be less than 5MB');
        return;
      }

      setPfpFile(file);

      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setPfpPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!displayName.trim()) {
      setError('Display name is required');
      setLoading(false);
      return;
    }

    if (!userId) {
      setError('User not authenticated');
      setLoading(false);
      return;
    }

    try {
      let pfpUrl = '';

      // Upload profile picture if provided
      if (pfpFile) {
        // TODO: Upload to custom object storage
        // For now, we'll use a placeholder
        // In production, call your custom object storage API
        pfpUrl = pfpPreview; // Temporary: use data URL
      }

      // Get user email from auth
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        setError('User email not found');
        setLoading(false);
        return;
      }

      // Create user profile
      const { error: insertError } = await supabase
        .from('users')
        .insert({
          id: userId,
          email: user.email,
          display_name: displayName.trim(),
          pfp_url: pfpUrl,
          role: 'staff', // Default role
          role_weight: 50, // Default weight for staff
          status: 'active',
        });

      if (insertError) {
        setError(insertError.message);
        setLoading(false);
        return;
      }

      // Profile created successfully, redirect to main app
      router.push('/');
    } catch (err) {
      console.error('Profile setup error:', err);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h1>Welcome! 👋</h1>
          <p>Let's set up your profile</p>
        </div>

        {error && (
          <div className={styles.error}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.form}>
          {/* Profile Picture Upload */}
          <div className={styles.avatarSection}>
            <div className={styles.avatarPreview}>
              {pfpPreview ? (
                <img src={pfpPreview} alt="Profile preview" />
              ) : (
                <UserIcon size={48} />
              )}
            </div>
            <label htmlFor="pfp-upload" className={styles.uploadButton}>
              <Upload size={18} />
              Upload Photo
            </label>
            <input
              type="file"
              id="pfp-upload"
              accept="image/*"
              onChange={handleFileChange}
              disabled={loading}
              className={styles.fileInput}
            />
            <span className={styles.hint}>Max 5MB (JPG, PNG, WEBP)</span>
          </div>

          {/* Display Name */}
          <div className={styles.inputGroup}>
            <label htmlFor="displayName">Display Name</label>
            <input
              type="text"
              id="displayName"
              placeholder="John Doe"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              disabled={loading}
              maxLength={50}
            />
            <span className={styles.hint}>
              This is how others will see you
            </span>
          </div>

          <button
            type="submit"
            className={styles.submitButton}
            disabled={loading || !displayName.trim()}
          >
            {loading ? 'Creating profile...' : 'Continue to Arctic Chat'}
          </button>
        </form>
      </div>
    </div>
  );
}
