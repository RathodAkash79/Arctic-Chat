import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import AWS from 'aws-sdk';

/**
 * POST /api/media/delete
 * Deletes one or more objects from self-hosted S3-compatible storage.
 * 
 * Body: { keys: string[] }  — array of object storage keys (e.g. "chat/abc123.webp")
 * 
 * Auth: Requires a valid Supabase session token in Authorization header.
 */

const s3 = new AWS.S3({
    endpoint: process.env.OBJECT_STORAGE_API_URL,
    accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
    region: process.env.OBJECT_STORAGE_REGION || 'us-east-1',
});

const BUCKET = process.env.OBJECT_STORAGE_BUCKET || 'chat';

export async function POST(request: NextRequest) {
    try {
        // ── Auth guard ───────────────────────────────────────────
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const token = authHeader.slice(7);

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // ── Parse request body ───────────────────────────────────
        const body = await request.json();
        const keys: string[] = body?.keys;

        if (!Array.isArray(keys) || keys.length === 0) {
            return NextResponse.json({ error: 'No keys provided' }, { status: 400 });
        }

        // ── Delete each key from S3 ──────────────────────────────
        const results = await Promise.allSettled(
            keys.map((key) => {
                // Strip any proxy URL prefix if full URL was passed
                // e.g. "/api/media/chat/abc.webp" → "chat/abc.webp"
                const cleanKey = key.replace(/^\/api\/media\//, '').replace(/^\//, '');
                return s3.deleteObject({ Bucket: BUCKET, Key: cleanKey }).promise();
            })
        );

        const failed = results
            .map((r, i) => ({ key: keys[i], status: r.status }))
            .filter((r) => r.status === 'rejected');

        if (failed.length > 0) {
            console.warn('[media/delete] Some keys failed to delete:', failed);
        }

        return NextResponse.json({
            success: true,
            deleted: keys.length - failed.length,
            failed: failed.length,
        });
    } catch (err) {
        console.error('[media/delete] Error:', err);
        return NextResponse.json(
            {
                error: 'Delete failed',
                details: err instanceof Error ? err.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
}
