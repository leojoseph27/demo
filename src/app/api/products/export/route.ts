import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/utils/supabase/server';
import * as XLSX from 'xlsx';

/**
 * Excel Export Route — Two-Row Header with Merged "SIZE mm" Group
 *
 * Recreates the user's Excel template format:
 *
 *   Row 1: sr | English Description | Arabic Description | ND Number | barcode | Colour | SIZE mm | Made | Material | Additional INFO | PRICE | Pcs | Images
 *   Row 2:    |                     |                     |           |         |         | L | W | H      |         |                 |       |     |       |
 *
 * "SIZE mm" spans 3 columns (L, W, H) as a merged cell.
 * Data rows start at Row 3.
 *
 * IMPORTANT: Uses paginated batch fetching to handle Supabase's 1000-row default limit.
 * All 1732+ products are exported, not just the first 1000.
 */

// Column layout definition (in order of appearance in the Excel)
interface ColDef {
  header1: string;   // Row 1 header text (parent header or the main header)
  header2: string;   // Row 2 header text (sub-header or empty)
  dbField: string;   // Supabase snake_case column name (or virtual field name)
  isJsonArray?: boolean;
  isVirtual?: boolean;  // Virtual fields that need custom extraction logic
}

const COLUMN_DEFS: ColDef[] = [
  { header1: 'sr', header2: '', dbField: 'sr' },
  { header1: 'English Description', header2: '', dbField: 'english_description' },
  { header1: 'Arabic Description', header2: '', dbField: 'arabic_description' },
  { header1: 'ND Number', header2: '', dbField: 'nd_number' },
  { header1: 'barcode', header2: '', dbField: 'barcode' },
  { header1: 'Colour', header2: '', dbField: 'colours', isJsonArray: true },
  // SIZE mm group — parent header spans 3 columns
  { header1: 'SIZE mm', header2: 'L', dbField: 'length' },
  { header1: '',        header2: 'W', dbField: 'width' },
  { header1: '',        header2: 'H', dbField: 'height' },
  { header1: 'Made', header2: '', dbField: 'made' },
  { header1: 'Material', header2: '', dbField: 'materials', isJsonArray: true },
  { header1: 'Additional INFO', header2: '', dbField: 'additional_info', isJsonArray: true },
  { header1: 'PRICE', header2: '', dbField: 'price' },
  { header1: 'Pcs', header2: '', dbField: 'pcs' },
  { header1: 'Images', header2: '', dbField: 'product_images_urls', isVirtual: true },
];

/**
 * Parse a JSON array field back to a comma-separated string for Excel.
 * Handles both actual arrays (from proper JSONB) and JSON strings (legacy data).
 * ["Red", "Blue"] → "Red, Blue"
 * '["Red","Blue"]' → "Red, Blue"
 */
function jsonArrayToString(value: any): string {
  if (!value) return '';
  // Already an array (proper JSONB)
  if (Array.isArray(value)) return value.join(', ');
  // String (legacy JSONB-as-string or text column)
  if (typeof value === 'string') {
    try {
      const arr = JSON.parse(value);
      if (Array.isArray(arr)) return arr.join(', ');
      return String(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Extract a virtual field value from a product row.
 * Virtual fields are computed from related data, not stored directly.
 */
function getVirtualFieldValue(product: any, dbField: string): string {
  if (dbField === 'product_images_urls') {
    // Combine all uploaded image URLs into a comma-separated string
    if (product.product_images && Array.isArray(product.product_images)) {
      const urls = product.product_images
        .filter((img: any) => img.image_url)
        .map((img: any) => img.image_url);
      return urls.length > 0 ? urls.join(', ') : '';
    }
    return '';
  }
  return '';
}

/**
 * Fetch ALL products from Supabase using paginated batch fetching.
 * Supabase's REST API defaults to max 1000 rows per request.
 */
async function fetchAllProducts(supabase: ReturnType<typeof createAdminClient>) {
  const allRows: any[] = [];
  let offset = 0;
  const batchSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('products')
      .select('*, product_images(*)')
      .order('sr', { ascending: true, nullsFirst: true })
      .range(offset, offset + batchSize - 1);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allRows.push(...data);
      hasMore = data.length === batchSize;
      offset += batchSize;
    }
  }

  return allRows;
}

/**
 * Fetch products within a serial number range.
 * Uses Supabase .gte() / .lte() filters on the `sr` column.
 */
async function fetchProductsBySrRange(
  supabase: ReturnType<typeof createAdminClient>,
  srFrom: number,
  srTo: number,
) {
  const allRows: any[] = [];
  let offset = 0;
  const batchSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('products')
      .select('*, product_images(*)')
      .gte('sr', srFrom)
      .lte('sr', srTo)
      .order('sr', { ascending: true, nullsFirst: true })
      .range(offset, offset + batchSize - 1);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allRows.push(...data);
      hasMore = data.length === batchSize;
      offset += batchSize;
    }
  }

  return allRows;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);

    // Check for serial number range parameters
    const srFromParam = searchParams.get('srFrom');
    const srToParam = searchParams.get('srTo');

    let data: any[];

    if (srFromParam !== null && srToParam !== null) {
      // Validate range format
      const srFrom = Number(srFromParam);
      const srTo = Number(srToParam);

      if (isNaN(srFrom) || isNaN(srTo)) {
        return NextResponse.json(
          { error: 'Invalid range format. Sr numbers must be valid integers.' },
          { status: 400 },
        );
      }

      if (srFrom > srTo) {
        return NextResponse.json(
          { error: 'Invalid range: start number cannot be greater than end number.' },
          { status: 400 },
        );
      }

      // Fetch products within the serial number range
      data = await fetchProductsBySrRange(supabase, srFrom, srTo);
    } else {
      // Fetch ALL products using paginated batch fetching (handles >1000 rows)
      data = await fetchAllProducts(supabase);
    }

    // ── Create workbook and worksheet ──
    const workbook = XLSX.utils.book_new();
    const worksheet: XLSX.WorkSheet = {};

    const totalCols = COLUMN_DEFS.length;
    const totalRows = data.length;
    const maxRow = totalRows + 2; // +2 for the two header rows (0-indexed: rows 0,1=headers, 2+=data)

    // ── Write Row 1 (parent headers) and Row 2 (sub-headers) ──
    for (let c = 0; c < totalCols; c++) {
      const col = COLUMN_DEFS[c];
      const cellRef1 = XLSX.utils.encode_cell({ r: 0, c });
      const cellRef2 = XLSX.utils.encode_cell({ r: 1, c });

      if (col.header1) {
        worksheet[cellRef1] = { t: 's', v: col.header1 };
      }
      if (col.header2) {
        worksheet[cellRef2] = { t: 's', v: col.header2 };
      }
    }

    // ── Write data rows starting at row index 2 ──
    for (let r = 0; r < totalRows; r++) {
      const product = data[r];
      for (let c = 0; c < totalCols; c++) {
        const col = COLUMN_DEFS[c];
        const cellRef = XLSX.utils.encode_cell({ r: r + 2, c });

        // Get the value — virtual fields use custom extraction
        let value: any;
        if (col.isVirtual) {
          value = getVirtualFieldValue(product, col.dbField);
        } else {
          value = product[col.dbField] ?? '';
        }

        if (col.isJsonArray) {
          value = jsonArrayToString(value);
        }

        // Determine cell type
        if (value === '' || value === null || value === undefined) {
          worksheet[cellRef] = { t: 's', v: '' };
        } else if (typeof value === 'number') {
          worksheet[cellRef] = { t: 'n', v: value };
        } else {
          worksheet[cellRef] = { t: 's', v: String(value) };
        }
      }
    }

    // ── Set worksheet range ──
    worksheet['!ref'] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: Math.max(maxRow - 1, 1), c: totalCols - 1 },
    });

    // ── Merge "SIZE mm" across 3 columns in Row 1 ──
    const sizeStartCol = COLUMN_DEFS.findIndex(c => c.header1 === 'SIZE mm');
    if (sizeStartCol !== -1) {
      worksheet['!merges'] = [
        {
          s: { r: 0, c: sizeStartCol },
          e: { r: 0, c: sizeStartCol + 2 }, // spans 3 columns (L, W, H)
        },
      ];
    }

    // ── Set column widths ──
    worksheet['!cols'] = [
      { wch: 6 },   // sr
      { wch: 30 },  // English Description
      { wch: 30 },  // Arabic Description
      { wch: 12 },  // ND Number
      { wch: 18 },  // barcode
      { wch: 20 },  // Colour
      { wch: 8 },   // L
      { wch: 8 },   // W
      { wch: 8 },   // H
      { wch: 12 },  // Made
      { wch: 20 },  // Material
      { wch: 25 },  // Additional INFO
      { wch: 10 },  // PRICE
      { wch: 6 },   // Pcs
      { wch: 50 },  // Images (uploaded image URLs)
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="products_export.xlsx"',
      },
    });
  } catch (error) {
    console.error('Error exporting Excel:', error);
    return NextResponse.json({ error: 'Failed to export Excel file' }, { status: 500 });
  }
}
