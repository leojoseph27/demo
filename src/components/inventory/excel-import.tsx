'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useInventoryStore } from '@/store/inventory-store';
import { ArrowLeft, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, AlertTriangle, Info } from 'lucide-react';
import { toast } from 'sonner';

interface ImportResult {
  imported: number;
  errors: number;
  skipped: number;
  total: number;
  elapsedMs?: number;
  detectedHeaders?: string[];
  columnMapping?: Record<string, string>;
  unmappedColumns?: string[];
  successDetails?: { row: number; sr: number | null; description: string | null; ndNumber: string | null }[];
  errorDetails?: { row: number; error: string; data?: string }[];
}

export function ExcelImport() {
  const { setView, goBack } = useInventoryStore();
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => {
    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv')) {
      setSelectedFile(file);
      setResult(null);
    } else {
      toast.error('Please select an Excel file (.xlsx, .xls, or .csv)');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) return;

    setImporting(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await fetch('/api/products/import', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        setResult(data);
        if (data.imported > 0 && data.errors === 0) {
          toast.success(`Successfully imported ${data.imported} products`);
        } else if (data.imported > 0 && data.errors > 0) {
          toast.warning(`Imported ${data.imported} products with ${data.errors} errors`);
        } else if (data.imported === 0) {
          toast.error('No products were imported');
        }
        if (data.imported > 0) {
          setSelectedFile(null);
        }
      } else {
        toast.error(data.error || 'Failed to import Excel file');
        if (data.detectedHeaders) {
          setResult(data);
        }
      }
    } catch (error) {
      console.error('Error importing:', error);
      toast.error('Failed to import Excel file');
    } finally {
      setImporting(false);
    }
  };

  const fieldLabelMap: Record<string, string> = {
    sr: 'Sr No.',
    englishDescription: 'English Description',
    arabicDescription: 'Arabic Description',
    ndNumber: 'ND Number',
    barcode: 'Barcode',
    colours: 'Colour',
    length: 'Length (L)',
    width: 'Width (W)',
    height: 'Height (H)',
    made: 'Made',
    materials: 'Material',
    additionalInfo: 'Additional Info',
    price: 'Price',
    pcs: 'Pcs',
  };

  return (
    <div className="space-y-4 pb-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={goBack} className="h-9 w-9 p-0">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Import from Excel</h1>
          <p className="text-sm text-muted-foreground">Upload an Excel file to import products</p>
        </div>
      </div>

      {/* Expected Format */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Supported Column Headers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>The importer will automatically match your column headers (case-insensitive):</p>
            <div className="flex flex-wrap gap-1 mt-2">
              {['sr', 'English Description', 'Arabic Description', 'ND Number', 'barcode', 'Colour', 'L', 'W', 'H', 'Made', 'Material', 'Additional INFO', 'PRICE', 'Pcs'].map((col) => (
                <span key={col} className="bg-muted px-2 py-0.5 rounded text-[10px] font-mono">
                  {col}
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs">
              Multi-value fields (Colour, Material, Additional Info) can be comma-separated: <code className="bg-muted px-1 rounded">Silver, Black, Gold</code>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* File Upload Area */}
      <Card>
        <CardContent className="pt-4">
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
          >
            <FileSpreadsheet className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
            {selectedFile ? (
              <div>
                <p className="font-medium text-sm">{selectedFile.name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => { setSelectedFile(null); setResult(null); }}
                >
                  Remove
                </Button>
              </div>
            ) : (
              <div>
                <p className="text-sm text-muted-foreground mb-2">
                  Drag and drop your Excel file here
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Select File
                </Button>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                if (e.target.files?.[0]) handleFileSelect(e.target.files[0]);
              }}
              className="hidden"
            />
          </div>

          <Button
            className="w-full mt-4 h-11"
            disabled={!selectedFile || importing}
            onClick={handleImport}
          >
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Import Products
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Import Result */}
      {result && (
        <div className="space-y-3">
          {/* Summary */}
          <Card>
            <CardContent className="pt-4">
              {result.imported > 0 ? (
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-6 w-6 text-emerald-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium">Import Complete</p>
                    <div className="text-sm text-muted-foreground mt-1 space-y-0.5">
                      <p>Total rows in file: {result.total}</p>
                      <p className="text-emerald-600">Successfully inserted: {result.imported}</p>
                      {result.skipped > 0 && (
                        <p className="text-muted-foreground">Skipped (empty rows): {result.skipped}</p>
                      )}
                      {result.errors > 0 && (
                        <p className="text-amber-600 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          Failed: {result.errors}
                        </p>
                      )}
                      {result.elapsedMs != null && (
                        <p className="text-xs text-muted-foreground">Duration: {result.elapsedMs < 1000 ? `${result.elapsedMs}ms` : `${(result.elapsedMs / 1000).toFixed(1)}s`}</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-6 w-6 text-amber-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium">Import Issues</p>
                    <div className="text-sm text-muted-foreground mt-1 space-y-0.5">
                      <p>Total rows in file: {result.total}</p>
                      <p>Inserted: {result.imported}</p>
                      {result.skipped > 0 && <p>Skipped (empty): {result.skipped}</p>}
                      {result.errors > 0 && <p>Failed: {result.errors}</p>}
                      {result.elapsedMs != null && (
                        <p className="text-xs">Duration: {result.elapsedMs < 1000 ? `${result.elapsedMs}ms` : `${(result.elapsedMs / 1000).toFixed(1)}s`}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Column Mapping Detected */}
          {result.detectedHeaders && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Info className="h-4 w-4 text-blue-500" />
                  Column Mapping
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Detected headers in your file:</p>
                  <div className="flex flex-wrap gap-1">
                    {result.detectedHeaders.map((h) => (
                      <Badge key={h} variant="outline" className="text-[10px] font-mono">
                        {h}
                      </Badge>
                    ))}
                  </div>
                </div>

                {result.columnMapping && Object.keys(result.columnMapping).length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Matched columns:</p>
                    <div className="space-y-1">
                      {Object.entries(result.columnMapping).map(([dbField, excelHeader]) => (
                        <div key={dbField} className="flex items-center gap-2 text-xs">
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            {excelHeader}
                          </Badge>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-foreground">{fieldLabelMap[dbField] || dbField}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {result.unmappedColumns && result.unmappedColumns.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Unmapped columns (ignored):</p>
                    <div className="flex flex-wrap gap-1">
                      {result.unmappedColumns.map((col) => (
                        <Badge key={col} variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                          {col}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Error Details */}
          {result.errorDetails && result.errorDetails.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 text-amber-600">
                  <AlertCircle className="h-4 w-4" />
                  Error Details ({result.errorDetails.length}{result.errorDetails.length >= 20 ? '+' : ''})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {result.errorDetails.map((err, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="text-muted-foreground shrink-0">Row {err.row}:</span>
                      <span className="text-amber-600">{err.error}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Action buttons after import */}
          {result.imported > 0 && (
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 h-11"
                onClick={() => setView('products')}
              >
                View Products
              </Button>
              <Button
                className="flex-1 h-11"
                onClick={() => { setResult(null); }}
              >
                Import More
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
