/**
 * Resolves image URLs — handles both old direct S3 URLs and new proxy URLs.
 * Old format: https://storage.arcticnodes.io/chat/profile/xxx.jpg
 * New format: /api/media/profile/xxx.jpg
 * 
 * Converts old URLs to proxy format so they work without AccessDenied errors.
 */
export function resolveImageUrl(url?: string | null): string {
    if (!url) return '';

    // Already a proxy URL
    if (url.startsWith('/api/media/')) return url;

    // Old direct S3 URL — extract the key and convert to proxy
    const storageUrl = process.env.NEXT_PUBLIC_STORAGE_URL || 'https://storage.arcticnodes.io';
    const bucket = 'chat';
    const prefix = `${storageUrl}/${bucket}/`;

    if (url.startsWith(prefix)) {
        const key = url.slice(prefix.length);
        return `/api/media/${key}`;
    }

    // Also handle if just the path after bucket
    if (url.includes('storage.arcticnodes.io')) {
        const match = url.match(/\/chat\/(.+)$/);
        if (match) {
            return `/api/media/${match[1]}`;
        }
    }

    // Return as-is for external URLs
    return url;
}
