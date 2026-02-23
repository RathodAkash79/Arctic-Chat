import { NextRequest, NextResponse } from 'next/server';
import AWS from 'aws-sdk';

/**
 * GET /api/media/[...path]
 * Proxies images from S3-compatible storage to avoid AccessDenied on direct URLs.
 * Usage: /api/media/profile/abc123.jpg
 */

const s3 = new AWS.S3({
    endpoint: process.env.OBJECT_STORAGE_API_URL,
    accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
    region: process.env.OBJECT_STORAGE_REGION || 'us-east-1',
});

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    try {
        const { path } = await params;
        const key = path.join('/');

        if (!key) {
            return NextResponse.json({ error: 'No path provided' }, { status: 400 });
        }

        const result = await s3
            .getObject({
                Bucket: process.env.OBJECT_STORAGE_BUCKET || 'chat',
                Key: key,
            })
            .promise();

        const contentType = result.ContentType || 'image/jpeg';
        const body = result.Body;

        if (!body) {
            return NextResponse.json({ error: 'File not found' }, { status: 404 });
        }

        // Convert to ArrayBuffer for NextResponse compatibility
        const bytes = Buffer.isBuffer(body)
            ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
            : new Uint8Array(body as ArrayBuffer);

        return new NextResponse(bytes as unknown as BodyInit, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=31536000, immutable',
            },
        });
    } catch (error) {
        console.error('Media proxy error:', error);
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
}
