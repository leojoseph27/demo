import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/utils/supabase/server';
import * as XLSX from 'xlsx';

/**
 * Excel Import Route — Two-Row Header Support
 *
 * Supports Excel files with a two-row header structure:
 *   Row 1: sr | English Description | Arabic Description | ND Number | barcode | Colour | SIZE mm | Made | Material | Additional INFO | PRICE | Pcs | Photo
 *   Row 2: (empty cells matching Row 1)                              | L      | W      | H      | (empty cells matching Row 1)
 *
 * "SIZE mm" is a merged parent header spanning 3 columns (L, W, H).
 * After resolving, the effective column headers become:
 *   sr, English Description, Arabic Description, ND Number, barcode,
 *   Colour, L, W, H, Made, Material, Additional INFO, PRICE, Pcs, Photo
 *
 * Column mapping (Excel Header → Supabase column):
 *   sr                  → sr
 *   English Description → english_description
 *   Arabic Description  → arabic_description
 *   ND Number           → nd_number
 *   barcode             → barcode
 *   Colour              → colours  (comma/semicolon-separated → JSON array)
 *   L                   → length
 *   W                   → width
 *   H                   → height
 *   Made                → made
 *   Material            → materials (comma/semicolon-separated → JSON array)
 *   Additional INFO     → additional_info (comma/semicolon-separated → JSON array)
 *   PRICE               → price
 *   Pcs                 → pcs
 *   Photo               → photo
 *
 * Import behavior:
 *   - Import every product row, even partially completed ones.
 *   - Empty cells become null in Supabase.
 *   - Only skip rows where ALL mapped fields are null.
 *   - Unknown columns are ignored.
 *   - Arabic text is supported natively (UTF-8).
 *   - Barcode values stored as text, number, or scientific notation are all handled.
 *   - Multi-value fields (Colour, Material, Additional INFO) are parsed into JSON arrays.
 */

// ────────────────────────────────────────────────────────────────────────────────
// Column mapping config: Excel header patterns → JS field name + value type
// ────────────────────────────────────────────────────────────────────────────────
const COLUMN_MAPPINGS: {
  patterns: string[];
  field: string;
  type: 'number' | 'string' | 'array';
}[] = [
  { patterns: ['sr', 'Sr', 'SR', 's.r', 'S.R', 'serial', 'Serial', 'no', 'No', '#'], field: 'sr', type: 'number' },
  { patterns: ['english description', 'englishdescription', 'english_description', 'english desc', 'description', 'desc', 'english_desc', 'product description', 'name'], field: 'englishDescription', type: 'string' },
  { patterns: ['arabic description', 'arabicdescription', 'arabic_description', 'arabic desc', 'arabic_desc', 'arabic', 'arab description'], field: 'arabicDescription', type: 'string' },
  { patterns: ['nd number', 'ndnumber', 'nd_number', 'nd no', 'ndno', 'nd_no', 'nd', 'ND Number', 'ND'], field: 'ndNumber', type: 'string' },
  { patterns: ['barcode', 'Barcode', 'BARCODE', 'bar code', 'bar_code', 'ean', 'upc', 'code', 'Code'], field: 'barcode', type: 'string' },
  { patterns: ['colour', 'color', 'Colour', 'Color', 'COLOUR', 'COLOR', 'colours', 'colors'], field: 'colours', type: 'array' },
  { patterns: ['l', 'L', 'length', 'Length', 'LENGTH', 'len', 'Lng', 'long', 'dimension l'], field: 'length', type: 'number' },
  { patterns: ['w', 'W', 'width', 'Width', 'WIDTH', 'wid', 'dimension w'], field: 'width', type: 'number' },
  { patterns: ['h', 'H', 'height', 'Height', 'HEIGHT', 'ht', 'dimension h'], field: 'height', type: 'number' },
  { patterns: ['made', 'Made', 'MADE', 'made in', 'Made In', 'made_in', 'origin', 'country', 'country of origin'], field: 'made', type: 'string' },
  { patterns: ['material', 'Material', 'MATERIAL', 'materials', 'Materials', 'MATERIALS', 'mat'], field: 'materials', type: 'array' },
  { patterns: ['additional info', 'additionalinfo', 'additional_info', 'additional information', 'add info', 'add_info', 'additional', 'extra info', 'extra_info', 'info', 'notes', 'extra'], field: 'additionalInfo', type: 'array' },
  { patterns: ['price', 'Price', 'PRICE', 'unit price', 'unitprice', 'unit_price', 'cost', 'amount', 'rate'], field: 'price', type: 'number' },
  { patterns: ['pcs', 'Pcs', 'PCS', 'pieces', 'Pieces', 'PIECES', 'piece', 'qty', 'quantity', 'Quantity', 'QTY', 'units', 'stock'], field: 'pcs', type: 'number' },
  { patterns: ['photo', 'Photo', 'PHOTO', 'image', 'Image', 'picture', 'Picture', 'img'], field: 'photo', type: 'string' },
];

// JS camelCase field → Supabase snake_case column
const FIELD_TO_DB: Record<string, string> = {
  sr: 'sr',
  englishDescription: 'english_description',
  arabicDescription: 'arabic_description',
  ndNumber: 'nd_number',
  barcode: 'barcode',
  colours: 'colours',
  length: 'length',
  width: 'width',
  height: 'height',
  made: 'made',
  materials: 'materials',
  additionalInfo: 'additional_info',
  price: 'price',
  pcs: 'pcs',
  photo: 'photo',
};

// Headers from Row 1 that are parent/group headers spanning multiple columns
// These get replaced by the child headers in Row 2.
// Stored pre-normalised so that .includes() comparison works correctly.
const PARENT_HEADERS_NORMALIZED = [
  'sizemm', 'size', 'dimensions', 'dimension', 'sizemm',
];

// ────────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────────

/**
 * Normalise a header string for comparison (lowercase, strip spaces/underscores/hyphens).
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s_-]/g, '').trim();
}

/**
 * Build the effective single-row header from a 2-row header Excel sheet.
 *
 * Row 1 may contain a merged/grouped parent header like "SIZE mm" spanning
 * 3 columns. Row 2 contains the child headers L, W, H under it.
 *
 * Strategy:
 *  1. Read both rows as arrays of cell values.
 *  2. For each column position, prefer the Row 2 value if Row 1 is a known
 *     parent header or if Row 1 is empty and Row 2 has content.
 *  3. If Row 2 is empty for that column, keep Row 1's header.
 *  4. Return the resolved header array and the data-start row index.
 */
function resolveTwoRowHeaders(
  worksheet: XLSX.WorkSheet,
): { headers: string[]; dataStartRow: number } {
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  const maxCol = range.e.c;
  const headers: string[] = [];

  // Read Row 1 (index 0) and Row 2 (index 1)
  const row1: string[] = [];
  const row2: string[] = [];

  for (let c = 0; c <= maxCol; c++) {
    const cell1 = worksheet[XLSX.utils.encode_cell({ r: 0, c })];
    const cell2 = worksheet[XLSX.utils.encode_cell({ r: 1, c })];
    row1.push(cell1 ? String(cell1.v ?? '').trim() : '');
    row2.push(cell2 ? String(cell2.v ?? '').trim() : '');
  }

  console.log(`[IMPORT] Raw Row 1 headers: ${JSON.stringify(row1)}`);
  console.log(`[IMPORT] Raw Row 2 headers: ${JSON.stringify(row2)}`);

  // Detect if Row 2 is a sub-header row:
  // - Row 2 has at least one non-empty value
  // - Row 2 is not a data row (e.g., doesn't start with a number for sr)
  const row2HasContent = row2.some(v => v !== '');
  const row2LooksLikeSubHeaders = row2HasContent && (
    // Row 2 values are short labels (L, W, H, etc.) not product data
    row2.every(v => v === '' || v.length <= 20)
  );

  // Also check: if Row 1 contains a known parent header, it's definitely 2-row
  const row1HasParentHeader = row1.some(v => PARENT_HEADERS_NORMALIZED.includes(normalize(v)));

  if (row2HasContent && (row2LooksLikeSubHeaders || row1HasParentHeader)) {
    // Two-row header mode
    for (let c = 0; c <= maxCol; c++) {
      const r1 = row1[c];
      const r2 = row2[c];
      const r1Norm = normalize(r1);
      const r2Norm = normalize(r2);

      // If Row 1 is a known parent header (e.g., "SIZE mm"),
      // always use Row 2 value (e.g., "L", "W", "H")
      if (PARENT_HEADERS_NORMALIZED.includes(r1Norm) && r2 !== '') {
        headers.push(r2);
      }
      // If Row 1 is empty and Row 2 has content, use Row 2
      else if (r1 === '' && r2 !== '') {
        headers.push(r2);
      }
      // If Row 2 is empty, use Row 1
      else if (r2 === '') {
        headers.push(r1);
      }
      // Both have content: prefer Row 2 if Row 1 is a parent header,
      // otherwise prefer Row 1 (top-level header takes precedence)
      else if (PARENT_HEADERS_NORMALIZED.includes(r1Norm)) {
        headers.push(r2);
      }
      else {
        headers.push(r1);
      }
    }
    console.log(`[IMPORT] Detected 2-row header structure. Resolved headers: ${JSON.stringify(headers)}`);
    return { headers, dataStartRow: 2 }; // Data starts at Row 3 (0-indexed row 2)
  }

  // Single-row header mode — use Row 1 only
  for (let c = 0; c <= maxCol; c++) {
    headers.push(row1[c]);
  }
  console.log(`[IMPORT] Single-row header detected: ${JSON.stringify(headers)}`);
  return { headers, dataStartRow: 1 }; // Data starts at Row 2 (0-indexed row 1)
}

/**
 * Match a header string against a list of patterns.
 * Tries exact → case-insensitive → normalised.
 */
function matchHeader(header: string, patterns: string[]): boolean {
  if (!header) return false;
  const headerLower = header.toLowerCase();
  const headerNorm = normalize(header);
  return patterns.some(p => {
    if (header === p) return true;
    if (headerLower === p.toLowerCase()) return true;
    if (headerNorm === normalize(p)) return true;
    return false;
  });
}

/**
 * Build the column mapping: for each column position, determine which
 * JS field it maps to and what type it is.
 */
function buildColumnMapping(
  headers: string[],
): { mapping: Map<number, { field: string; type: string }>; unmapped: string[] } {
  const mapping = new Map<number, { field: string; type: string }>();
  const mappedIndices = new Set<number>();

  for (const colMapping of COLUMN_MAPPINGS) {
    for (let c = 0; c < headers.length; c++) {
      if (mappedIndices.has(c)) continue;
      if (matchHeader(headers[c], colMapping.patterns)) {
        mapping.set(c, { field: colMapping.field, type: colMapping.type });
        mappedIndices.add(c);
        break; // Use the first matching column for this field
      }
    }
  }

  const unmapped = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => h && !mappedIndices.has(i))
    .map(({ h }) => h);

  return { mapping, unmapped };
}

/**
 * Parse a multi-value field into a JSON array string.
 * "Red, Blue, Green" → '["Red","Blue","Green"]'
 * Returns null for empty/missing values.
 */
function parseArrayField(value: any): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) {
    const filtered = value.filter(v => String(v).trim());
    return filtered.length > 0 ? JSON.stringify(filtered) : null;
  }
  const str = String(value).trim();
  if (!str) return null;
  // Already a JSON array string? Validate and pass through
  if (str.startsWith('[')) {
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed) && parsed.length > 0) return JSON.stringify(parsed);
      if (Array.isArray(parsed) && parsed.length === 0) return null;
    } catch { /* fall through to comma-split */ }
  }
  // Split by comma, semicolon, or pipe
  const items = str.split(/[,;|]/).map(v => v.trim()).filter(Boolean);
  return items.length > 0 ? JSON.stringify(items) : null;
}

function toNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return isNaN(num) ? null : num;
}

function toString(value: any): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim() || null;
}

/**
 * Convert a barcode value to string, handling scientific notation.
 * E.g., 6.90123E+12 → "6901230000000"
 */
function toBarcode(value: any): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    // Format number without scientific notation
    return value.toLocaleString('fullwide', { useGrouping: false });
  }
  const str = String(value).trim();
  if (!str) return null;
  // Handle scientific notation in string form
  if (/^\d+\.?\d*e[+-]?\d+$/i.test(str)) {
    const num = Number(str);
    if (!isNaN(num)) {
      return num.toLocaleString('fullwide', { useGrouping: false });
    }
  }
  return str;
}

/**
 * Read a single cell value from a worksheet at the given row/column.
 */
function getCellValue(worksheet: XLSX.WorkSheet, r: number, c: number): any {
  const cell = worksheet[XLSX.utils.encode_cell({ r, c })];
  return cell ? cell.v : '';
}

/**
 * Cached table columns — fetched once, reused across all import requests.
 * Avoids the slow OpenAPI call on every import.
 */
let _cachedColumns: Set<string> | null = null;
let _cacheTime = 0;
const SCHEMA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch the list of columns that exist in the Supabase products table.
 * Results are cached for 5 minutes to avoid repeated OpenAPI calls.
 */
async function getTableColumns(): Promise<Set<string>> {
  // Return cached if still valid
  if (_cachedColumns && (Date.now() - _cacheTime) < SCHEMA_CACHE_TTL) {
    return _cachedColumns;
  }

  try {
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch(`${baseUrl}/rest/v1/?apikey=${apiKey}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      const schema = await response.json();
      const props = schema?.definitions?.products?.properties;
      if (props) {
        _cachedColumns = new Set(Object.keys(props));
        _cacheTime = Date.now();
        return _cachedColumns;
      }
    }
  } catch (e) {
    console.warn('[IMPORT] Could not fetch table schema (will use fallback):', (e as Error).message);
  }
  // Fallback: assume all mapped columns exist
  const fallback = new Set(Object.values(FIELD_TO_DB));
  _cachedColumns = fallback;
  _cacheTime = Date.now();
  return fallback;
}

// ────────────────────────────────────────────────────────────────────────────────
// POST handler
// ────────────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const importStartTime = Date.now();

  try {
    const supabase = createAdminClient();
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // ── Detect available columns in Supabase (cached) ──
    const tableColumns = await getTableColumns();
    console.log(`[IMPORT] Supabase products table columns: ${JSON.stringify([...tableColumns].sort())}`);

    // Pre-compute which DB columns are missing so we can skip them in the loop
    const missingDbColumns = new Set<string>();
    for (const dbCol of Object.values(FIELD_TO_DB)) {
      if (!tableColumns.has(dbCol)) {
        missingDbColumns.add(dbCol);
      }
    }
    if (missingDbColumns.size > 0) {
      console.log(`[IMPORT] Columns not in Supabase (will be skipped): ${JSON.stringify([...missingDbColumns])}`);
    }

    // ── Read Excel file ──
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    if (!workbook.SheetNames.length) {
      return NextResponse.json({ error: 'Excel file has no sheets' }, { status: 400 });
    }

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    if (!worksheet['!ref']) {
      return NextResponse.json({ error: 'Excel sheet is empty' }, { status: 400 });
    }

    // ── Resolve headers (supports 2-row header structure) ──
    const { headers, dataStartRow } = resolveTwoRowHeaders(worksheet);

    // ── Build column mapping ──
    const { mapping, unmapped } = buildColumnMapping(headers);

    // Log the resolved mapping
    const mappedHeaders: Record<string, string> = {};
    for (const [colIdx, mapInfo] of mapping) {
      mappedHeaders[mapInfo.field] = headers[colIdx];
    }
    console.log(`[IMPORT] Final mapped headers: ${JSON.stringify(mappedHeaders)}`);
    if (unmapped.length > 0) {
      console.log(`[IMPORT] Unmapped columns (ignored): ${JSON.stringify(unmapped)}`);
    }

    if (mapping.size === 0) {
      return NextResponse.json({
        error: 'No recognizable column headers found in Excel file.',
        rawHeaders: headers,
        imported: 0, errors: 0, total: 0, skipped: 0,
      }, { status: 400 });
    }

    // ── Parse data rows ──
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    const totalDataRows = range.e.r - dataStartRow + 1;

    if (totalDataRows <= 0) {
      return NextResponse.json({
        error: 'Excel file has no data rows after headers',
        imported: 0, errors: 0, total: 0, skipped: 0,
      }, { status: 400 });
    }

    let imported = 0;
    let errors = 0;
    let skipped = 0;
    const errorDetails: { row: number; error: string; data?: string }[] = [];
    const successDetails: { row: number; sr: number | null; description: string | null; ndNumber: string | null }[] = [];

    // Log first 5 parsed rows for debugging
    const previewRows: { row: number; data: Record<string, any> }[] = [];

    // ── Batch insert for performance ──
    // Instead of inserting one row at a time (which is extremely slow over HTTP),
    // we collect rows into batches and insert them in chunks.
    const BATCH_SIZE = 100;
    const batchRows: { rowNum: number; dbData: Record<string, any>; record: Record<string, any> }[] = [];

    // First pass: parse all rows into DB-ready objects
    for (let r = dataStartRow; r <= range.e.r; r++) {
      const rowNum = r + 1; // 1-based Excel row number

      // Read cell values for this row
      const record: Record<string, any> = {};

      for (const [colIdx, mapInfo] of mapping) {
        const rawValue = getCellValue(worksheet, r, colIdx);

        switch (mapInfo.type) {
          case 'number':
            record[mapInfo.field] = toNumber(rawValue);
            break;
          case 'string':
            if (mapInfo.field === 'barcode') {
              record[mapInfo.field] = toBarcode(rawValue);
            } else {
              record[mapInfo.field] = toString(rawValue);
            }
            break;
          case 'array':
            record[mapInfo.field] = parseArrayField(rawValue);
            break;
        }
      }

      // Capture preview for first 5 rows
      if (previewRows.length < 5) {
        previewRows.push({ row: rowNum, data: { ...record } });
      }

      // Skip completely empty rows
      const allFieldsNull = Object.values(record).every(v => v === null || v === undefined);
      if (allFieldsNull) {
        skipped++;
        continue;
      }

      // Convert camelCase → snake_case and skip missing DB columns
      const dbData: Record<string, any> = {};
      for (const [field, value] of Object.entries(record)) {
        const dbKey = FIELD_TO_DB[field] || field;
        if (!missingDbColumns.has(dbKey)) {
          dbData[dbKey] = value;
        }
      }

      batchRows.push({ rowNum, dbData, record });
    }

    console.log(`[IMPORT] Parsed ${batchRows.length} data rows (+ ${skipped} empty skipped), inserting in batches of ${BATCH_SIZE}...`);

    // Second pass: insert in batches
    for (let i = 0; i < batchRows.length; i += BATCH_SIZE) {
      const batch = batchRows.slice(i, i + BATCH_SIZE);
      const insertPayload = batch.map(b => b.dbData);

      try {
        const { error: insertError } = await supabase
          .from('products')
          .insert(insertPayload);

        if (insertError) {
          // Batch insert failed — could be a single bad row.
          // Fall back to row-by-row for this batch to isolate the error.
          console.warn(`[IMPORT] Batch ${Math.floor(i / BATCH_SIZE) + 1} failed (${insertError.message}), retrying row-by-row...`);
          for (const { rowNum, dbData, record } of batch) {
            try {
              const { error: singleError } = await supabase
                .from('products')
                .insert(dbData);

              if (singleError) throw singleError;

              imported++;
              successDetails.push({
                row: rowNum,
                sr: record.sr ?? null,
                description: record.englishDescription ?? null,
                ndNumber: record.ndNumber ?? null,
              });
            } catch (err: any) {
              errors++;
              const errorMsg = err?.message || String(err);
              errorDetails.push({ row: rowNum, error: errorMsg });
            }
          }
          continue;
        }

        // All rows in the batch succeeded
        imported += batch.length;
        for (const { rowNum, record } of batch) {
          successDetails.push({
            row: rowNum,
            sr: record.sr ?? null,
            description: record.englishDescription ?? null,
            ndNumber: record.ndNumber ?? null,
          });
        }
      } catch (err: any) {
        // Unexpected error in batch
        errors += batch.length;
        for (const { rowNum } of batch) {
          errorDetails.push({ row: rowNum, error: err?.message || String(err) });
        }
      }
    }

    const elapsedMs = Date.now() - importStartTime;
    const totalProcessed = imported + errors + skipped;

    console.log(`[IMPORT] Complete: ${imported} imported, ${errors} errors, ${skipped} skipped, ${totalProcessed} total rows (${elapsedMs}ms)`);

    return NextResponse.json({
      imported,
      errors,
      skipped,
      total: totalProcessed,
      elapsedMs,
      rawHeaders: headers,
      columnMapping: mappedHeaders,
      unmappedColumns: unmapped,
      previewRows: previewRows.length > 0 ? previewRows : undefined,
      successDetails: successDetails.length > 0 ? successDetails : undefined,
      errorDetails: errorDetails.length > 0 ? errorDetails.slice(0, 50) : undefined,
    });
  } catch (error: any) {
    console.error('[IMPORT] Fatal error:', error);
    return NextResponse.json({
      error: 'Failed to import Excel file: ' + (error?.message || String(error)),
      imported: 0, errors: 0, total: 0, skipped: 0,
    }, { status: 500 });
  }
}
