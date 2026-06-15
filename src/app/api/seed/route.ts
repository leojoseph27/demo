import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/utils/supabase/server';
import { createHash } from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient();
    const body = await request.json();
    const { email, password, name } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    // Check if admin already exists
    const { data: existing } = await supabase
      .from('admin_users')
      .select('id')
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({ error: 'Admin user already exists' }, { status: 400 });
    }

    const hashedPassword = createHash('sha256').update(password).digest('hex');

    const { data, error } = await supabase
      .from('admin_users')
      .insert({
        email,
        password: hashedPassword,
        name: name || 'Admin',
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase error creating admin:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ id: data.id, email: data.email, name: data.name }, { status: 201 });
  } catch (error) {
    console.error('Error seeding admin:', error);
    return NextResponse.json({ error: 'Failed to create admin user' }, { status: 500 });
  }
}
