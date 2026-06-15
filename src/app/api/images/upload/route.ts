import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/utils/supabase/server';
import { mapImageFromDb } from '@/utils/supabase/mappers';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const productId = formData.get('productId') as string | null;
    const isPrimary = formData.get('isPrimary') === 'true';

    // Validate required fields
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!productId) {
      return NextResponse.json({ error: 'No productId provided' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Verify the product exists
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id')
      .eq('id', productId)
      .single();

    if (productError || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // Build a unique storage path: <productId>/<timestamp>_<originalname>
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${productId}/${timestamp}_${safeName}`;

    // Upload file to Supabase Storage
    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from('product-images')
      .upload(storagePath, arrayBuffer, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return NextResponse.json(
        { error: `Storage upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    // Get the public URL for the uploaded file
    const { data: urlData } = supabase.storage
      .from('product-images')
      .getPublicUrl(storagePath);

    const imageUrl = urlData.publicUrl;

    // Determine display_order: place at the end
    const { data: existingImages } = await supabase
      .from('product_images')
      .select('display_order')
      .eq('product_id', productId)
      .order('display_order', { ascending: false })
      .limit(1);

    const nextOrder = existingImages && existingImages.length > 0
      ? (existingImages[0] as any).display_order + 1
      : 0;

    // If this is the first image or isPrimary was requested, clear other primaries
    if (isPrimary) {
      await supabase
        .from('product_images')
        .update({ is_primary: false })
        .eq('product_id', productId)
        .eq('is_primary', true);
    }

    // Insert the image record
    const { data: imageRow, error: insertError } = await supabase
      .from('product_images')
      .insert({
        product_id: productId,
        image_url: imageUrl,
        display_order: nextOrder,
        is_primary: isPrimary,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Image record insert error:', insertError);
      // Attempt to clean up the uploaded file
      await supabase.storage.from('product-images').remove([storagePath]);
      return NextResponse.json(
        { error: `Failed to save image record: ${insertError.message}` },
        { status: 500 }
      );
    }

    // If no other images exist for this product, make it primary automatically
    if (!isPrimary) {
      const { count } = await supabase
        .from('product_images')
        .select('*', { count: 'exact', head: true })
        .eq('product_id', productId);

      if (count === 1) {
        await supabase
          .from('product_images')
          .update({ is_primary: true })
          .eq('id', (imageRow as any).id);

        (imageRow as any).is_primary = true;
      }
    }

    return NextResponse.json(mapImageFromDb(imageRow));
  } catch (error) {
    console.error('Image upload error:', error);
    return NextResponse.json(
      { error: 'Failed to upload image' },
      { status: 500 }
    );
  }
}
