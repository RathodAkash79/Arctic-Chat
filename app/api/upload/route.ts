import { NextRequest, NextResponse } from 'next/server';
import AWS from 'aws-sdk';

/**
 * POST /api/upload
 * Uploads a file to S3-compatible storage (MinIO/Arctic)
 * 
 * Expected FormData:
 * - file: File
 * - purpose: 'profile' | 'chat' (optional, defaults to 'profile')
 */

// Configure S3 client for MinIO/Arctic storage
const s3 = new AWS.S3({
  endpoint: process.env.OBJECT_STORAGE_API_URL,
  accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY,
  secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY,
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
  region: process.env.OBJECT_STORAGE_REGION || 'us-east-1',
});

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const purpose = (formData.get('purpose') as string) || 'profile';

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File size exceeds 5MB limit' },
        { status: 400 }
      );
    }

    // Validate content type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only images allowed.' },
        { status: 400 }
      );
    }

    // Generate unique filename
    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const randomId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const filename = `${purpose}/${randomId}.${extension}`;

    // Convert file to buffer
    const buffer = await file.arrayBuffer();
    const bufferData = Buffer.from(buffer);

    // Upload to S3
    const params = {
      Bucket: process.env.OBJECT_STORAGE_BUCKET || 'chat',
      Key: filename,
      Body: bufferData,
      ContentType: file.type,
      ACL: 'public-read', // Make it publicly accessible
    };

    const result = await s3.upload(params).promise();

    // Generate public URL
    const publicUrl = `${process.env.OBJECT_STORAGE_API_URL}/${process.env.OBJECT_STORAGE_BUCKET}/${filename}`;

    console.log(`File uploaded: ${filename}`);

    return NextResponse.json(
      {
        success: true,
        filename,
        size: file.size,
        type: file.type,
        url: publicUrl,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Upload error:', error);

    return NextResponse.json(
      {
        error: 'File upload failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
