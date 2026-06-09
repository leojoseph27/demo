import { NextResponse } from 'next/server';

/**
 * GET /api/auth/check
 * Always returns { exists: true } since the admin is hardcoded
 * via environment variables — no setup or registration needed.
 */
export async function GET() {
  return NextResponse.json({ exists: true });
}
