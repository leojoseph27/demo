import { NextResponse } from 'next/server';
import { createAdminClient } from '@/utils/supabase/server';

/**
 * POST /api/setup
 * Verifies that the required Supabase tables and storage bucket exist.
 * Run this once after deploying the application.
 * No admin_users table needed — auth is handled via environment variables.
 */
export async function POST() {
  const supabase = createAdminClient();
  const results: { step: string; status: string; message?: string }[] = [];

  // Step 1: Verify products table
  const { error: productsError } = await supabase.from('products').select('id').limit(1);
  results.push({
    step: 'products table',
    status: productsError ? 'error' : 'ok',
    message: productsError?.message,
  });

  // Step 2: Verify product_images table
  const { error: imagesError } = await supabase.from('product_images').select('id').limit(1);
  results.push({
    step: 'product_images table',
    status: imagesError ? 'error' : 'ok',
    message: imagesError?.message,
  });

  // Step 3: Check/create product-images storage bucket
  const { data: buckets } = await supabase.storage.listBuckets();
  const productImagesBucket = buckets?.find(b => b.name === 'product-images');

  if (!productImagesBucket) {
    const { error: bucketError } = await supabase.storage.createBucket('product-images', {
      public: true,
      fileSizeLimit: 10485760, // 10MB
    });

    if (bucketError) {
      results.push({
        step: 'product-images bucket',
        status: 'warning',
        message: bucketError.message,
      });
    } else {
      results.push({ step: 'product-images bucket', status: 'created' });
    }
  } else {
    results.push({ step: 'product-images bucket', status: 'ok' });
  }

  // Step 4: Verify admin env vars are set
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  results.push({
    step: 'admin credentials',
    status: adminEmail && adminPassword ? 'ok' : 'error',
    message: !adminEmail || !adminPassword
      ? 'ADMIN_EMAIL and/or ADMIN_PASSWORD environment variables are not set'
      : undefined,
  });

  return NextResponse.json({ results });
}
