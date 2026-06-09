import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/utils/supabase/server';
import * as XLSX from 'xlsx';

/**
 * Excel Import Route
 *
 * Imports ALL rows from an Excel file into the Supabase products table.
 * - Every row is inserted, even partially completed ones.
 * - Empty cells become null in the database.
 * - Multi-value fields (Colour, Material, Additional Info) are parsed from
 *   comma/semicolon-separated strings into JSON arrays.
 * - Detailed logging for every row.
 *
 * Column mapping (Excel Header → Supabase column):
 *   sr               → sr
 *   English Description → english_description
 *   Arabic Description  → arabic_description
 *   ND Number        → nd_number
 *   barcode          → barcode
 *   Colour           → colours  (comma-separated → JSON array)
 *   L                → length
 *   W                → width
 *   H                → height
 *   Made             → made
 *   Material         → materials (comma-separated → JSON array)
 *   Additional INFO  → additional_info (comma-separated → JSON array)
 *   PRICE            → price
 *   Pcs              → pcs
 */

// Column mapping config: Excel header patterns → our field name + value type
const COLUMN_MAPPINGS: { patterns: string[]; field: string; type: 'number' | 'string' | 'array' }[] = [
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
];

// CamelCase → snake_case mapping for Supabase columns
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
};

/**
 * Finds the Excel column that matches one of the given patterns.
 * Tries exact match → case-insensitive → normalised (no spaces/underscores/hyphens).
 */
function findFieldValue(row: Record<string, any>, patterns: string[]): { key: string; value: any } | null {
  const rowKeys = Object.keys(row);

  // Exact match
  for (const pattern of patterns) {
    if (row[pattern] !== undefined) return { key: pattern, value: row[pattern] };
  }
  // Case-insensitive match
  for (const pattern of patterns) {
    const patternLower = pattern.toLowerCase();
    for (const key of rowKeys) {
      if (key.toLowerCase() === patternLower && row[key] !== undefined) {
        return { key, value: row[key] };
      }
    }
  }
  // Normalised match (strip spaces, underscores, hyphens)
  const normalizedPatterns = patterns.map(p => p.toLowerCase().replace(/[\s_-]/g, ''));
  for (const key of rowKeys) {
    const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, '');
    const matchIndex = normalizedPatterns.indexOf(normalizedKey);
    if (matchIndex !== -1 && row[key] !== undefined) {
      return { key, value: row[key] };
    }
  }
  return null;
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

export async function POST(request: NextRequest) {
  const importStartTime = Date.now();

  try {
    const supabase = createAdminClient();
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    if (!workbook.SheetNames.length) {
      return NextResponse.json({ error: 'Excel file has no sheets' }, { status: 400 });
    }

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    // Use defval: '' so that empty cells become '' rather than being omitted
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });

    if (rows.length === 0) {
      return NextResponse.json({
        error: 'Excel file has no data rows',
        imported: 0, errors: 0, total: 0, skipped: 0,
      }, { status: 400 });
    }

    const detectedHeaders = Object.keys(rows[0]);
    console.log(`[IMPORT] File: ${file.name}, Rows: ${rows.length}, Headers: ${JSON.stringify(detectedHeaders)}`);

    // Build column mapping for this file
    const mappingResult: Record<string, { field: string; type: string; excelKey: string }> = {};
    for (const mapping of COLUMN_MAPPINGS) {
      const found = findFieldValue(rows[0], mapping.patterns);
      if (found) {
        mappingResult[mapping.field] = { field: mapping.field, type: mapping.type, excelKey: found.key };
      }
    }

    console.log(`[IMPORT] Column mapping: ${JSON.stringify(Object.fromEntries(
      Object.entries(mappingResult).map(([f, i]) => [f, i.excelKey])
    ))}`);

    const mappedExcelKeys = new Set(Object.values(mappingResult).map(m => m.excelKey));
    const unmappedColumns = detectedHeaders.filter(h => !mappedExcelKeys.has(h) && h.trim() !== '');

    if (Object.keys(mappingResult).length === 0) {
      return NextResponse.json({
        error: 'No recognizable column headers found in Excel file.',
        detectedHeaders,
        imported: 0, errors: 0, total: rows.length, skipped: 0,
      }, { status: 400 });
    }

    let imported = 0;
    let errors = 0;
    let skipped = 0;
    const errorDetails: { row: number; error: string; data?: string }[] = [];
    const successDetails: { row: number; sr: number | null; description: string | null; ndNumber: string | null }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Excel row number (1-based + header)

      try {
        // Parse all mapped fields from the row
        const record: Record<string, any> = {};

        for (const [dbField, mapInfo] of Object.entries(mappingResult)) {
          const rawValue = row[mapInfo.excelKey];
          switch (mapInfo.type) {
            case 'number':
              record[dbField] = toNumber(rawValue);
              break;
            case 'string':
              record[dbField] = toString(rawValue);
              break;
            case 'array': {
              record[dbField] = parseArrayField(rawValue);
              break;
            }
          }
        }

        // Skip completely empty rows (ALL fields are null)
        const allFieldsNull = Object.values(record).every(v => v === null || v === undefined);
        if (allFieldsNull) {
          skipped++;
          console.log(`[IMPORT] Row ${rowNum}: Skipped (all fields empty)`);
          continue;
        }

        // IMPORTANT: Import ALL rows, even partially completed ones.
        // We only skip if the row is truly empty (all nulls).
        // Rows with just an sr, or just an ND number, etc. are still inserted.

        // Convert camelCase field names to snake_case for Supabase
        const dbData: Record<string, any> = {};
        for (const [field, value] of Object.entries(record)) {
          const dbKey = FIELD_TO_DB[field] || field;
          dbData[dbKey] = value;
        }

        const { error: insertError } = await supabase
          .from('products')
          .insert(dbData);

        if (insertError) {
          throw insertError;
        }

        imported++;
        successDetails.push({
          row: rowNum,
          sr: record.sr ?? null,
          description: record.englishDescription ?? null,
          ndNumber: record.ndNumber ?? null,
        });
        console.log(`[IMPORT] Row ${rowNum}: OK - sr=${record.sr ?? '-'}, desc="${record.englishDescription ?? '-'}", nd=${record.ndNumber ?? '-'}`);
      } catch (err: any) {
        errors++;
        const errorMsg = err?.message || String(err);
        const dataPreview = JSON.stringify(row).substring(0, 200);
        errorDetails.push({ row: rowNum, error: errorMsg, data: dataPreview });
        console.error(`[IMPORT] Row ${rowNum}: FAILED - ${errorMsg}`);
      }
    }

    const elapsedMs = Date.now() - importStartTime;
    console.log(`[IMPORT] Complete: ${imported} imported, ${errors} errors, ${skipped} skipped, ${rows.length} total rows (${elapsedMs}ms)`);

    return NextResponse.json({
      imported,
      errors,
      skipped,
      total: rows.length,
      elapsedMs,
      detectedHeaders,
      columnMapping: Object.fromEntries(
        Object.entries(mappingResult).map(([field, info]) => [field, info.excelKey])
      ),
      unmappedColumns,
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
