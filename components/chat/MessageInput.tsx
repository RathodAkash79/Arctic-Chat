'use client';

import { useState, useRef, useCallback, KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import styles from './MessageInput.module.scss';

interface Props {
    onSend: (text: string) => void;
    disabled?: boolean;
}

export default function MessageInput({ onSend, disabled }: Props) {
    const [text, setText] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

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

    const handleSend = () => {
        if (!text.trim() || disabled) return;
        onSend(text);
        setText('');
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        // Enter sends, Shift+Enter adds newline
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className={styles.inputBar}>
            <div className={styles.inputWrapper}>
                <textarea
                    ref={textareaRef}
                    className={styles.textarea}
                    placeholder="Type a message..."
                    value={text}
                    onChange={(e) => handleChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                    rows={1}
                />
                <button
                    className={`${styles.sendBtn} ${text.trim() ? styles.active : ''}`}
                    onClick={handleSend}
                    disabled={!text.trim() || disabled}
                    title="Send message"
                >
                    <Send size={18} />
                </button>
            </div>
        </div>
    );
}
