import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
    try {
        const { userId, message } = await req.json();

        if (!userId || !message) {
            return NextResponse.json(
                { error: 'Missing userId or message' },
                { status: 400 }
            );
        }

        // Use the service role client which bypasses RLS
        const supabaseAdmin = createServerClient();

        const { data, error } = await supabaseAdmin
            .from('feedback')
            .insert({
                user_id: userId,
                message: message,
            })
            .select()
            .single();

        if (error) {
            console.error('Feedback insert error:', error);
            return NextResponse.json(
                { error: 'Failed to insert feedback' },
                { status: 500 }
            );
        }

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        console.error('Feedback API error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
