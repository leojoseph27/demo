import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/auth/login
 * Simple hardcoded authentication using environment variables.
 * No database lookup, no user registration, no Supabase Auth.
 * Single administrator only — credentials defined in ADMIN_EMAIL / ADMIN_PASSWORD env vars.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      console.error('ADMIN_EMAIL or ADMIN_PASSWORD environment variables are not set');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    if (email === adminEmail && password === adminPassword) {
      return NextResponse.json({
        id: 'admin',
        email: adminEmail,
        name: 'Admin',
      });
    }

    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  } catch (error) {
    console.error('Error logging in:', error);
    return NextResponse.json({ error: 'Failed to login' }, { status: 500 });
  }
}
