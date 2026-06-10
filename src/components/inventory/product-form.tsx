'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MultiValueInput } from './multi-value-input';
import { SearchableMultiSelect } from './searchable-multi-select';
import { ImageGallery } from './image-gallery';
import { BarcodeScanner } from './barcode-scanner';
import { useInventoryStore, Product, DuplicateCheck } from '@/store/inventory-store';
import { ArrowLeft, Save, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface ProductFormProps {
  mode: 'add' | 'edit';
}

export function ProductForm({ mode }: ProductFormProps) {
  const {
    currentProduct,
    setView,
    goBack,
    saveStatus,
    setSaveStatus,
    setSaving,
    duplicates,
    setDuplicates,
    setCurrentProduct,
  } = useInventoryStore();

  const [formData, setFormData] = useState({
    sr: '',
    englishDescription: '',
    arabicDescription: '',
    ndNumber: '',
    barcode: '',
    colours: [] as string[],
    length: '',
    width: '',
    height: '',
    made: '',
    materials: [] as string[],
    additionalInfo: [] as string[],
    price: '',
    pcs: '',
  });

  const [colourSuggestions, setColourSuggestions] = useState<string[]>([]);
  const [materialSuggestions, setMaterialSuggestions] = useState<string[]>([]);
  // ── Predefined common values (always available in the dropdown) ──────
  // These merge with whatever values exist in the database.
  const DEFAULT_COLOURS = [
    'Beige', 'Black', 'Blue', 'Brown', 'Gold', 'Green', 'Grey',
    'Multicolor', 'Orange', 'Pink', 'Purple', 'Red', 'Silver',
    'Transparent', 'White', 'Yellow',
  ];

  const DEFAULT_MATERIALS = [
    'Aluminium', 'Bamboo', 'Ceramic', 'Copper', 'Cotton', 'Glass',
    'Granite', 'Iron', 'Marble', 'Melamine', 'Nylon', 'Paper',
    'Plastic', 'Porcelain', 'Rubber', 'Silicone', 'Stainless Steel',
    'Steel', 'Stone', 'Wood',
  ];

  // Merge: DB values ∪ predefined defaults ∪ locally-selected values
  const mergedColourSuggestions = useMemo(() => {
    const set = new Set([...DEFAULT_COLOURS, ...colourSuggestions, ...formData.colours]);
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [colourSuggestions, formData.colours]);

  const mergedMaterialSuggestions = useMemo(() => {
    const set = new Set([...DEFAULT_MATERIALS, ...materialSuggestions, ...formData.materials]);
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [materialSuggestions, formData.materials]);

  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedDataRef = useRef<string>('');

  // Helper: safely parse a value that might be a JSON string, an array, or null
  const safeParseArray = (value: string | null | any[]): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
      const arr = JSON.parse(value);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  };

  // Fetch colour and material suggestions from the database
  useEffect(() => {
    const fetchSuggestions = async () => {
      try {
        const res = await fetch('/api/products?mode=suggestions');
        if (res.ok) {
          const data = await res.json();
          setColourSuggestions(data.colours || []);
          setMaterialSuggestions(data.materials || []);
        }
      } catch (error) {
        console.error('Error fetching suggestions:', error);
      }
    };
    fetchSuggestions();
  }, []);

  useEffect(() => {
    if (mode === 'edit' && currentProduct) {
      const colours = safeParseArray(currentProduct.colours);
      const materials = safeParseArray(currentProduct.materials);
      const additionalInfo = safeParseArray(currentProduct.additionalInfo);

      setFormData({
        sr: currentProduct.sr?.toString() || '',
        englishDescription: currentProduct.englishDescription || '',
        arabicDescription: currentProduct.arabicDescription || '',
        ndNumber: currentProduct.ndNumber || '',
        barcode: currentProduct.barcode || '',
        colours,
        length: currentProduct.length?.toString() || '',
        width: currentProduct.width?.toString() || '',
        height: currentProduct.height?.toString() || '',
        made: currentProduct.made || '',
        materials,
        additionalInfo,
        price: currentProduct.price?.toString() || '',
        pcs: currentProduct.pcs?.toString() || '',
      });
    }
  }, [mode, currentProduct]);

  // Auto-save for edit mode
  useEffect(() => {
    if (mode !== 'edit' || !currentProduct) return;

    const currentData = JSON.stringify(formData);
    if (currentData === lastSavedDataRef.current) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(async () => {
      await handleSave(true);
      lastSavedDataRef.current = currentData;
    }, 2000);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [formData, mode, currentProduct]);

  const checkDuplicates = useCallback(async (ndNumber: string, barcode: string) => {
    if (!ndNumber && !barcode) {
      setDuplicates(null);
      return;
    }
    try {
      const params = new URLSearchParams();
      if (ndNumber) params.set('ndNumber', ndNumber);
      if (barcode) params.set('barcode', barcode);
      if (mode === 'edit' && currentProduct) params.set('excludeId', currentProduct.id);

      const res = await fetch(`/api/products/check-duplicate?${params}`);
      if (res.ok) {
        const data = await res.json();
        setDuplicates(data.duplicates);
      }
    } catch (error) {
      console.error('Error checking duplicates:', error);
    }
  }, [mode, currentProduct, setDuplicates]);

  const handleFieldChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setSaveStatus('idle');

    if (field === 'ndNumber' || field === 'barcode') {
      checkDuplicates(
        field === 'ndNumber' ? value : formData.ndNumber,
        field === 'barcode' ? value : formData.barcode
      );
    }
  };

  const handleSave = async (isAutoSave = false) => {
    if (!isAutoSave) setSaving(true);
    setSaveStatus('saving');

    try {
      const payload = {
        sr: formData.sr ? parseFloat(formData.sr) : null,
        englishDescription: formData.englishDescription || null,
        arabicDescription: formData.arabicDescription || null,
        ndNumber: formData.ndNumber || null,
        barcode: formData.barcode || null,
        colours: formData.colours,
        length: formData.length ? parseFloat(formData.length) : null,
        width: formData.width ? parseFloat(formData.width) : null,
        height: formData.height ? parseFloat(formData.height) : null,
        made: formData.made || null,
        materials: formData.materials,
        additionalInfo: formData.additionalInfo,
        price: formData.price ? parseFloat(formData.price) : null,
        pcs: formData.pcs ? parseInt(formData.pcs) : null,
      };

      let res;
      if (mode === 'add') {
        res = await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else if (currentProduct) {
        res = await fetch(`/api/products/${currentProduct.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (res?.ok) {
        const savedProduct = await res.json();
        setCurrentProduct(savedProduct);
        setSaveStatus('saved');

        if (!isAutoSave) {
          toast.success(mode === 'add' ? 'Product created successfully!' : 'Product updated successfully!');
          setView('products');
        }
      } else {
        setSaveStatus('error');
        if (!isAutoSave) toast.error('Failed to save product');
      }
    } catch (error) {
      console.error('Error saving product:', error);
      setSaveStatus('error');
      if (!isAutoSave) toast.error('Failed to save product');
    } finally {
      if (!isAutoSave) setSaving(false);
    }
  };

  const handleImageUpload = async (file: File, isPrimary?: boolean) => {
    if (!currentProduct) return;

    const formDataToSend = new FormData();
    formDataToSend.append('file', file);
    formDataToSend.append('productId', currentProduct.id);
    if (isPrimary) formDataToSend.append('isPrimary', 'true');

    const res = await fetch('/api/images/upload', {
      method: 'POST',
      body: formDataToSend,
    });

    if (res.ok) {
      const newImage = await res.json();
      setCurrentProduct({
        ...currentProduct,
        images: [...currentProduct.images, newImage].sort((a, b) => a.displayOrder - b.displayOrder),
      });
    }
  };

  const handleImageDelete = async (imageId: string) => {
    const res = await fetch(`/api/images/${imageId}`, { method: 'DELETE' });
    if (res.ok && currentProduct) {
      setCurrentProduct({
        ...currentProduct,
        images: currentProduct.images.filter(img => img.id !== imageId),
      });
    }
  };

  const handleSetPrimary = async (imageId: string) => {
    const res = await fetch(`/api/images/${imageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPrimary: true }),
    });
    if (res.ok && currentProduct) {
      setCurrentProduct({
        ...currentProduct,
        images: currentProduct.images.map(img => ({
          ...img,
          isPrimary: img.id === imageId,
        })),
      });
    }
  };

  const hasDuplicates = duplicates && (duplicates.ndNumber || duplicates.barcode);

  return (
    <div className="space-y-4 pb-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={goBack} className="h-9 w-9 p-0">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">
            {mode === 'add' ? 'Add New Product' : 'Edit Product'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {saveStatus === 'saving' && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving...
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="text-xs text-emerald-600 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Saved
            </span>
          )}
          <Button
            onClick={() => handleSave(false)}
            disabled={hasDuplicates || saveStatus === 'saving'}
            className="h-10"
          >
            <Save className="h-4 w-4 mr-2" />
            {mode === 'add' ? 'Create' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Duplicate Warnings */}
      {hasDuplicates && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {duplicates.ndNumber && (
              <div>ND Number &ldquo;{duplicates.ndNumber.ndNumber}&rdquo; already exists (SR: {duplicates.ndNumber.sr})</div>
            )}
            {duplicates.barcode && (
              <div>Barcode &ldquo;{duplicates.barcode.barcode}&rdquo; already exists (SR: {duplicates.barcode.sr})</div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Product Images (edit mode only) */}
      {mode === 'edit' && currentProduct && (
        <Card>
          <CardContent className="pt-4">
            <ImageGallery
              images={currentProduct.images}
              productId={currentProduct.id}
              onUpload={handleImageUpload}
              onDelete={handleImageDelete}
              onSetPrimary={handleSetPrimary}
            />
          </CardContent>
        </Card>
      )}

      {/* Basic Information */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Basic Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="sr">Sr No.</Label>
              <Input
                id="sr"
                type="number"
                step="0.1"
                value={formData.sr}
                onChange={(e) => handleFieldChange('sr', e.target.value)}
                placeholder="1"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">Price (KD)</Label>
              <Input
                id="price"
                type="number"
                step="0.001"
                value={formData.price}
                onChange={(e) => handleFieldChange('price', e.target.value)}
                placeholder="0.000 KD"
                className="h-11"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="englishDesc">English Description</Label>
            <Input
              id="englishDesc"
              value={formData.englishDescription}
              onChange={(e) => handleFieldChange('englishDescription', e.target.value)}
              placeholder="Product description in English"
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="arabicDesc">Arabic Description</Label>
            <Input
              id="arabicDesc"
              value={formData.arabicDescription}
              onChange={(e) => handleFieldChange('arabicDescription', e.target.value)}
              placeholder="وصف المنتج بالعربية"
              className="h-11"
              dir="rtl"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ndNumber">ND Number</Label>
              <Input
                id="ndNumber"
                value={formData.ndNumber}
                onChange={(e) => handleFieldChange('ndNumber', e.target.value)}
                placeholder="ND-1000"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label>Barcode</Label>
              <div className="flex gap-2">
                <Input
                  value={formData.barcode}
                  onChange={(e) => handleFieldChange('barcode', e.target.value)}
                  placeholder="102000001249"
                  className="h-11 flex-1"
                />
                <BarcodeScanner
                  onScan={(barcode) => handleFieldChange('barcode', barcode)}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="made">Made In</Label>
            <Input
              id="made"
              value={formData.made}
              onChange={(e) => handleFieldChange('made', e.target.value)}
              placeholder="China"
              className="h-11"
            />
          </div>
        </CardContent>
      </Card>

      {/* Dimensions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Dimensions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="length">Length (L)</Label>
              <Input
                id="length"
                type="number"
                step="0.1"
                value={formData.length}
                onChange={(e) => handleFieldChange('length', e.target.value)}
                placeholder="0"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="width">Width (W)</Label>
              <Input
                id="width"
                type="number"
                step="0.1"
                value={formData.width}
                onChange={(e) => handleFieldChange('width', e.target.value)}
                placeholder="0"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="height">Height (H)</Label>
              <Input
                id="height"
                type="number"
                step="0.1"
                value={formData.height}
                onChange={(e) => handleFieldChange('height', e.target.value)}
                placeholder="0"
                className="h-11"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Multi-value fields */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Properties</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <SearchableMultiSelect
            label="Colour"
            values={formData.colours}
            onChange={(values) => handleFieldChange('colours', values)}
            suggestions={mergedColourSuggestions}
            placeholder="Search colours..."
            emptyMessage="No colour found."
          />
          <SearchableMultiSelect
            label="Material"
            values={formData.materials}
            onChange={(values) => handleFieldChange('materials', values)}
            suggestions={mergedMaterialSuggestions}
            placeholder="Search materials..."
            emptyMessage="No material found."
          />
          <MultiValueInput
            label="Additional Info"
            values={formData.additionalInfo}
            onChange={(values) => handleFieldChange('additionalInfo', values)}
            placeholder="e.g. Food Grade, Dishwasher Safe"
          />
        </CardContent>
      </Card>

      {/* Stock */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Stock</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="pcs">Pieces (Pcs)</Label>
            <Input
              id="pcs"
              type="number"
              value={formData.pcs}
              onChange={(e) => handleFieldChange('pcs', e.target.value)}
              placeholder="0"
              className="h-11"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
