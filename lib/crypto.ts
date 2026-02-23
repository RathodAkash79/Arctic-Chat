/**
 * ARCTIC CHAT — Client-Side Encryption (AES-256-GCM)
 * 
 * Simple symmetric encryption using a shared passphrase.
 * The passphrase is stored in localStorage (per-device, never sent to server).
 * All messages are encrypted client-side before being sent to Supabase.
 * 
 * Format: base64(iv:ciphertext)
 * IV = 12 random bytes (unique per message)
 */

const STORAGE_KEY = 'arctic_chat_passphrase';
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/**
 * Derives a CryptoKey from a passphrase using PBKDF2
 */
async function deriveKey(passphrase: string): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        ENCODER.encode(passphrase),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    // Use a fixed salt (app-specific) — the passphrase IS the secret
    const salt = ENCODER.encode('arctic-chat-v2-salt');

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt,
            iterations: 100_000,
            hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

// Cache the derived key in memory
let cachedKey: CryptoKey | null = null;
let cachedPassphrase: string | null = null;

async function getKey(passphrase: string): Promise<CryptoKey> {
    if (cachedKey && cachedPassphrase === passphrase) return cachedKey;
    cachedKey = await deriveKey(passphrase);
    cachedPassphrase = passphrase;
    return cachedKey;
}

/**
 * Encrypt a plaintext message
 * Returns base64-encoded string: iv:ciphertext
 */
export async function encryptMessage(plaintext: string): Promise<string> {
    const passphrase = getPassphrase();
    if (!passphrase) return plaintext; // No passphrase = send plaintext

    try {
        const key = await getKey(passphrase);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = ENCODER.encode(plaintext);

        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            encoded
        );

        // Combine IV + ciphertext and base64 encode
        const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
        combined.set(iv);
        combined.set(new Uint8Array(ciphertext), iv.length);

        return 'enc:' + btoa(String.fromCharCode(...combined));
    } catch (err) {
        console.error('Encryption failed:', err);
        return plaintext;
    }
}

/**
 * Decrypt an encrypted message
 * Input: base64 string prefixed with "enc:"
 */
export async function decryptMessage(encrypted: string): Promise<string> {
    // Not encrypted
    if (!encrypted.startsWith('enc:')) return encrypted;

    const passphrase = getPassphrase();
    if (!passphrase) return '[Encrypted]';

    try {
        const key = await getKey(passphrase);
        const data = Uint8Array.from(atob(encrypted.slice(4)), (c) => c.charCodeAt(0));

        const iv = data.slice(0, 12);
        const ciphertext = data.slice(12);

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            ciphertext
        );

        return DECODER.decode(decrypted);
    } catch (err) {
        console.error('Decryption failed:', err);
        return '[Decryption Failed]';
    }
}

// ============================================
// PASSPHRASE MANAGEMENT
// ============================================

/**
 * Get the stored passphrase
 */
export function getPassphrase(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(STORAGE_KEY);
}

/**
 * Set/update the passphrase
 */
export function setPassphrase(passphrase: string): void {
    localStorage.setItem(STORAGE_KEY, passphrase);
    // Clear cached key so it re-derives
    cachedKey = null;
    cachedPassphrase = null;
}

/**
 * Check if passphrase is set
 */
export function hasPassphrase(): boolean {
    return !!getPassphrase();
}

/**
 * Clear the passphrase (lock)
 */
export function clearPassphrase(): void {
    localStorage.removeItem(STORAGE_KEY);
    cachedKey = null;
    cachedPassphrase = null;
}
