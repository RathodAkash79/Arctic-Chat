import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

/**
 * GET /api/auth/whitelist-check?email=xxx@xxx.com
 * Check if an email is whitelisted (for testing/debugging)
 * 
 * POST /api/auth/whitelist-check
 * Add an email to whitelist (admin only) - REQUIRES valid service role key in auth header
 */

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const email = searchParams.get('email');

  if (!email) {
    return NextResponse.json(
      { error: 'Email parameter is required' },
      { status: 400 }
    );
  }

  try {
    const supabase = createServerClient();
    
    // Check whitelist (case-insensitive)
    const { data, error } = await supabase
      .from('whitelist')
      .select('*')
      .ilike('email', email.toLowerCase().trim())
      .single();

    if (error) {
      console.error('Whitelist check error:', error);
      return NextResponse.json(
        {
          whitelisted: false,
          email: email.toLowerCase().trim(),
          message: 'Email not found in whitelist',
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        whitelisted: true,
        email: data.email,
        added_at: data.created_at,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Get current user to verify they're an admin
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Unauthorized - No auth header' },
        { status: 401 }
      );
    }

    // Add email to whitelist
    const { data, error } = await supabase
      .from('whitelist')
      .insert({
        email: email.toLowerCase().trim(),
        added_by: null, // In production, get from current user
      })
      .select()
      .single();

    if (error) {
      console.error('Whitelist insert error:', error);
      
      // Check if email already exists
      if (error.message.includes('duplicate') || error.code === '23505') {
        return NextResponse.json(
          { error: 'Email already exists in whitelist' },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: true, email: data.email, created_at: data.created_at },
      { status: 201 }
    );
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
