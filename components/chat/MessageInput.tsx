'use client';

import { useState, useRef, useCallback, KeyboardEvent } from 'react';
import { Send, Paperclip, X, Sparkles, Clock } from 'lucide-react';
import { compressImage, formatFileSize } from '@/lib/imageCompression';
import styles from './MessageInput.module.scss';

interface Props {
    onSend: (text: string, mediaUrl?: string, isDisappearing?: boolean) => void;
    disabled?: boolean;
}

export default function MessageInput({ onSend, disabled }: Props) {
    const [text, setText] = useState('');
    const [mediaPreview, setMediaPreview] = useState<string | null>(null);
    const [mediaFile, setMediaFile] = useState<Blob | null>(null);
    const [mediaInfo, setMediaInfo] = useState<string>('');
    const [hdMode, setHdMode] = useState(false);
    const [isDisappearing, setIsDisappearing] = useState(false);
    const [compressing, setCompressing] = useState(false);
    const [uploading, setUploading] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Auto-resize textarea
    const adjustHeight = useCallback(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        const maxHeight = 120; // ~5 lines
        el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
    }, []);

    const handleChange = (value: string) => {
        setText(value);
        setTimeout(adjustHeight, 0);
    };

    // Handle file selection
    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Only images
        if (!file.type.startsWith('image/')) {
            alert('Only images are supported');
            return;
        }

        setCompressing(true);
        try {
            const { blob, previewUrl } = await compressImage(file, hdMode);
            setMediaPreview(previewUrl);
            setMediaFile(blob);
            setMediaInfo(
                `${formatFileSize(file.size)} → ${formatFileSize(blob.size)} (${hdMode ? 'HD' : 'Standard'})`
            );
        } catch (err) {
            console.error('Compression failed:', err);
            alert('Image compression failed');
        }
        setCompressing(false);

        // Reset file input
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // Upload media and send
    const uploadAndSend = async () => {
        let mediaUrl: string | undefined;

        if (mediaFile) {
            setUploading(true);
            try {
                const formData = new FormData();
                formData.append('file', mediaFile, 'image.webp');
                formData.append('purpose', 'chat');

                const res = await fetch('/api/upload', { method: 'POST', body: formData });
                const data = await res.json();

                if (data.url) {
                    mediaUrl = data.url;
                } else {
                    console.error('Upload failed:', data.error);
                    setUploading(false);
                    return;
                }
            } catch (err) {
                console.error('Upload error:', err);
                setUploading(false);
                return;
            }
            setUploading(false);
        }

        onSend(text, mediaUrl, isDisappearing);
        setText('');
        setMediaPreview(null);
        setMediaFile(null);
        setMediaInfo('');
        setIsDisappearing(false);
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
    };

    const handleSend = () => {
        if (disabled || uploading || compressing) return;
        if (!text.trim() && !mediaFile) return;
        uploadAndSend();
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const clearMedia = () => {
        setMediaPreview(null);
        setMediaFile(null);
        setMediaInfo('');
    };

    const canSend = (text.trim() || mediaFile) && !disabled && !uploading && !compressing;

    return (
        <div className={styles.inputBar}>
            {/* Media Preview */}
            {mediaPreview && (
                <div className={styles.mediaPreview}>
                    <img src={mediaPreview} alt="Preview" />
                    <div className={styles.mediaOverlay}>
                        <span className={styles.mediaSize}>{mediaInfo}</span>
                        <button className={styles.mediaClear} onClick={clearMedia}>
                            <X size={16} />
                        </button>
                    </div>
                </div>
            )}

            <div className={styles.inputWrapper}>
                {/* Attach Button */}
                <button
                    className={styles.attachBtn}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={compressing || uploading}
                    title="Attach image"
                >
                    <Paperclip size={18} />
                </button>

                {mediaFile && (
                    <>
                        {/* HD Toggle */}
                        <button
                            className={`${styles.hdBtn} ${hdMode ? styles.hdActive : ''}`}
                            onClick={() => setHdMode(!hdMode)}
                            title={hdMode ? 'HD mode on' : 'Standard quality'}
                        >
                            <Sparkles size={14} />
                            <span>HD</span>
                        </button>

                        {/* Disappearing Toggle */}
                        <button
                            className={`${styles.hdBtn} ${isDisappearing ? styles.hdActive : ''}`}
                            onClick={() => setIsDisappearing(!isDisappearing)}
                            title={isDisappearing ? 'View Once (Disappearing)' : 'Keep Media'}
                        >
                            <Clock size={14} />
                            <span>24h</span>
                        </button>
                    </>
                )}

                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                />

                <textarea
                    ref={textareaRef}
                    className={styles.textarea}
                    placeholder="Type a message..."
                    value={text}
                    onChange={(e) => handleChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={disabled || uploading}
                    rows={1}
                />

                <button
                    className={`${styles.sendBtn} ${canSend ? styles.active : ''}`}
                    onClick={handleSend}
                    disabled={!canSend}
                    title="Send message"
                >
                    {uploading ? (
                        <div className={styles.spinnerTiny} />
                    ) : (
                        <Send size={18} />
                    )}
                </button>
            </div>
        </div>
    );
}
