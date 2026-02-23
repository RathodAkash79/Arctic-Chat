/**
 * ARCTIC CHAT — Image Compression
 * 
 * Uses Canvas API to compress images client-side before upload.
 * Supports WebP output for smaller file sizes.
 * Includes HD toggle for quality control.
 */

interface CompressOptions {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number; // 0-1
    format?: 'image/webp' | 'image/jpeg';
}

const STANDARD_OPTIONS: CompressOptions = {
    maxWidth: 1200,
    maxHeight: 1200,
    quality: 0.7,
    format: 'image/webp',
};

const HD_OPTIONS: CompressOptions = {
    maxWidth: 2400,
    maxHeight: 2400,
    quality: 0.9,
    format: 'image/webp',
};

/**
 * Compress an image file using Canvas API
 * Returns a compressed Blob and a preview data URL
 */
export async function compressImage(
    file: File,
    hd = false
): Promise<{ blob: Blob; previewUrl: string; width: number; height: number }> {
    const opts = hd ? HD_OPTIONS : STANDARD_OPTIONS;

    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(url);

            // Calculate new dimensions while maintaining aspect ratio
            let { width, height } = img;
            const maxW = opts.maxWidth || 1200;
            const maxH = opts.maxHeight || 1200;

            if (width > maxW || height > maxH) {
                const ratio = Math.min(maxW / width, maxH / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }

            // Draw to canvas
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            if (!ctx) {
                reject(new Error('Canvas context failed'));
                return;
            }

            ctx.drawImage(img, 0, 0, width, height);

            // Get preview URL
            const previewUrl = canvas.toDataURL(opts.format, opts.quality);

            // Convert to blob
            canvas.toBlob(
                (blob) => {
                    if (!blob) {
                        reject(new Error('Blob conversion failed'));
                        return;
                    }
                    resolve({ blob, previewUrl, width, height });
                },
                opts.format,
                opts.quality
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Image load failed'));
        };

        img.src = url;
    });
}

/**
 * Get file size in human readable format
 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
