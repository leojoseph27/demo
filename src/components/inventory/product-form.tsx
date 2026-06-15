'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MultiValueInput, MultiValueInputHandle } from './multi-value-input';
import { SearchableMultiSelect } from './searchable-multi-select';
import { SearchableSingleSelect } from './searchable-single-select';
import { ImageGallery } from './image-gallery';
import { BarcodeScanner } from './barcode-scanner';
import { useInventoryStore, Product, DuplicateCheck } from '@/store/inventory-store';
import { ArrowLeft, Save, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface ProductFormProps {
  mode: 'add' | 'edit';
}

export function ProductForm({ mode }: ProductFormProps) {
  const {
    currentProduct,
    setView,
    goBack,
    isSaving,
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

  // ── Dinar / Fils split for Price (KD) ────────────────────────────────
  const [priceDinar, setPriceDinar] = useState('');
  const [priceFils, setPriceFils] = useState('');

  // ── Duplicate check ──────
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

  // ── Generic field change handler ──
  const handleFieldChange = useCallback((field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));

    if (field === 'ndNumber' || field === 'barcode') {
      checkDuplicates(
        field === 'ndNumber' ? value : formData.ndNumber,
        field === 'barcode' ? value : formData.barcode
      );
    }
  }, [checkDuplicates, formData.ndNumber, formData.barcode]);

  // Helper: parse a numeric price string into Dinar + Fils components
  const parsePriceToDinarFils = (priceStr: string): { dinar: string; fils: string } => {
    if (!priceStr) return { dinar: '', fils: '' };
    const num = parseFloat(priceStr);
    if (isNaN(num)) return { dinar: '', fils: '' };
    const dinar = Math.floor(num);
    const fils = Math.round((num - dinar) * 1000);
    return { dinar: String(dinar), fils: String(fils).padStart(3, '0') };
  };

  // Compute the combined price string from Dinar + Fils
  const combinedPrice = useMemo(() => {
    const dinar = priceDinar.trim() || '0';
    const filsRaw = priceFils.trim();
    const fils = filsRaw ? filsRaw.padStart(3, '0') : '000';
    const dinarNum = parseInt(dinar) || 0;
    const filsNum = parseInt(fils) || 0;
    if (dinarNum === 0 && filsNum === 0) return '';
    return `${dinarNum}.${fils}`;
  }, [priceDinar, priceFils]);

  const handlePriceDinarChange = useCallback((value: string) => {
    const clean = value.replace(/[^0-9]/g, '');
    setPriceDinar(clean);
    const dinar = clean || '0';
    const filsRaw = priceFils.trim();
    const fils = filsRaw ? filsRaw.padStart(3, '0') : '000';
    const dinarNum = parseInt(dinar) || 0;
    const filsNum = parseInt(fils) || 0;
    if (dinarNum === 0 && filsNum === 0) {
      handleFieldChange('price', '');
    } else {
      handleFieldChange('price', `${dinarNum}.${fils}`);
    }
  }, [priceFils, handleFieldChange]);

  const handlePriceFilsChange = useCallback((value: string) => {
    let clean = value.replace(/[^0-9]/g, '');
    if (clean.length > 3) clean = clean.slice(0, 3);
    if (clean && parseInt(clean) > 999) clean = '999';
    setPriceFils(clean);
    const dinar = priceDinar.trim() || '0';
    const fils = clean ? clean.padStart(3, '0') : '000';
    const dinarNum = parseInt(dinar) || 0;
    const filsNum = parseInt(fils) || 0;
    if (dinarNum === 0 && filsNum === 0) {
      handleFieldChange('price', '');
    } else {
      handleFieldChange('price', `${dinarNum}.${fils}`);
    }
  }, [priceDinar, handleFieldChange]);

  const [colourSuggestions, setColourSuggestions] = useState<string[]>([]);
  const [materialSuggestions, setMaterialSuggestions] = useState<string[]>([]);
  const [madeSuggestions, setMadeSuggestions] = useState<string[]>([]);
  const [customColours, setCustomColours] = useState<string[]>([]);
  const [customMaterials, setCustomMaterials] = useState<string[]>([]);
  const [customCountries, setCustomCountries] = useState<string[]>([]);

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

  const DEFAULT_COUNTRIES = [
    'Turkey', 'Germany', 'China', 'Italy', 'Poland', 'Hungary',
    'Netherlands', 'India', 'Ukraine', 'Slovakia', 'Spain',
    'Kuwait', 'UAE', 'Saudi Arabia',
  ];

  const mergedColourSuggestions = useMemo(() => {
    const set = new Set([...DEFAULT_COLOURS, ...colourSuggestions, ...customColours, ...formData.colours]);
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [colourSuggestions, customColours, formData.colours]);

  const mergedMaterialSuggestions = useMemo(() => {
    const set = new Set([...DEFAULT_MATERIALS, ...materialSuggestions, ...customMaterials, ...formData.materials]);
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [materialSuggestions, customMaterials, formData.materials]);

  const mergedCountrySuggestions = useMemo(() => {
    const set = new Set([...DEFAULT_COUNTRIES, ...customCountries, ...madeSuggestions, formData.made].filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [customCountries, madeSuggestions, formData.made]);

  // ── Ref for MultiValueInput to flush pending values before save ──
  const additionalInfoInputRef = useRef<MultiValueInputHandle>(null);

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

  // Load custom colours/materials/countries from localStorage on mount
  useEffect(() => {
    try {
      const storedColours = localStorage.getItem('customColours');
      if (storedColours) {
        try { setCustomColours(JSON.parse(storedColours)); } catch { /* ignore bad data */ }
      }
      const storedMaterials = localStorage.getItem('customMaterials');
      if (storedMaterials) {
        try { setCustomMaterials(JSON.parse(storedMaterials)); } catch { /* ignore bad data */ }
      }
      const storedCountries = localStorage.getItem('customCountries');
      if (storedCountries) {
        try { setCustomCountries(JSON.parse(storedCountries)); } catch { /* ignore bad data */ }
      }
    } catch { /* localStorage may not be available */ }
  }, []);

  // Fetch colour and material suggestions from the database
  useEffect(() => {
    const fetchSuggestions = async () => {
      try {
        const res = await fetch('/api/products?mode=suggestions');
        if (res.ok) {
          const data = await res.json();
          setColourSuggestions(data.colours || []);
          setMaterialSuggestions(data.materials || []);
          setMadeSuggestions(data.made || []);
        }
      } catch (error) {
        console.error('Error fetching suggestions:', error);
      }
    };
    fetchSuggestions();
  }, []);

  // ── Persist new custom colour to localStorage ──
  const handleNewColourPersist = useCallback((value: string) => {
    setCustomColours(prev => {
      if (prev.some(v => v.toLowerCase() === value.toLowerCase())) return prev;
      const updated = [...prev, value];
      try { localStorage.setItem('customColours', JSON.stringify(updated)); } catch { /* */ }
      return updated;
    });
  }, []);

  // ── Persist new custom material to localStorage ──
  const handleNewMaterialPersist = useCallback((value: string) => {
    setCustomMaterials(prev => {
      if (prev.some(v => v.toLowerCase() === value.toLowerCase())) return prev;
      const updated = [...prev, value];
      try { localStorage.setItem('customMaterials', JSON.stringify(updated)); } catch { /* */ }
      return updated;
    });
  }, []);

  // ── Persist new custom country to localStorage ──
  const handleNewCountryPersist = useCallback((value: string) => {
    setCustomCountries(prev => {
      if (prev.some(v => v.toLowerCase() === value.toLowerCase())) return prev;
      const updated = [...prev, value];
      try { localStorage.setItem('customCountries', JSON.stringify(updated)); } catch { /* */ }
      return updated;
    });
  }, []);

  // ── Load form data from currentProduct when entering edit mode ──
  // This runs ONCE when the component mounts or when the product changes.
  // No auto-save, no auto-refresh — form state is stable while editing.
  useEffect(() => {
    if (mode === 'edit' && currentProduct) {
      const colours = safeParseArray(currentProduct.colours);
      const materials = safeParseArray(currentProduct.materials);
      const additionalInfo = safeParseArray(currentProduct.additionalInfo);
      const priceStr = currentProduct.price?.toString() || '';

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
        price: priceStr,
        pcs: currentProduct.pcs?.toString() || '',
      });

      // Parse price into Dinar + Fils directly here (not in a separate effect)
      // to avoid the race condition where the separate effect reads stale formData.price.
      const { dinar, fils } = parsePriceToDinarFils(priceStr);
      setPriceDinar(dinar);
      setPriceFils(fils);
    }
  }, [mode, currentProduct]);

  // ── Manual save only — NO auto-save ──
  const handleSave = async () => {
    setSaving(true);

    // Flush any pending MultiValueInput values before building payload
    additionalInfoInputRef.current?.flush();

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
        toast.success(mode === 'add' ? 'Product created successfully!' : 'Product updated successfully!');
        setView('products');
      } else {
        toast.error('Failed to save product');
      }
    } catch (error) {
      console.error('Error saving product:', error);
      toast.error('Failed to save product');
    } finally {
      setSaving(false);
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
      toast.success('Image uploaded successfully');
    } else {
      let errorMsg = 'Upload failed';
      try {
        const errData = await res.json();
        errorMsg = errData.error || errorMsg;
      } catch {}
      toast.error(errorMsg);
      throw new Error(errorMsg);
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
        <Button
          onClick={handleSave}
          disabled={hasDuplicates || isSaving}
          className="h-10"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {mode === 'add' ? 'Create' : 'Save'}
        </Button>
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
              <Label>Price (KD)</Label>
              <div className="grid grid-cols-2 gap-0">
                <div className="space-y-0.5">
                  <span className="text-[10px] text-muted-foreground pl-1">Dinar</span>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={priceDinar}
                    onChange={(e) => handlePriceDinarChange(e.target.value)}
                    placeholder="0"
                    className="h-11 rounded-r-none text-right font-mono text-base"
                    aria-label="Dinar"
                  />
                </div>
                <div className="space-y-0.5">
                  <span className="text-[10px] text-muted-foreground pl-1">Fils</span>
                  <div className="flex items-center">
                    <span className="flex h-11 items-center justify-center border-y border-input bg-muted px-1.5 text-lg font-bold text-muted-foreground select-none">
                      .
                    </span>
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={priceFils}
                      onChange={(e) => handlePriceFilsChange(e.target.value)}
                      placeholder="000"
                      maxLength={3}
                      className="h-11 rounded-l-none font-mono text-base"
                      aria-label="Fils"
                    />
                  </div>
                </div>
              </div>
              {combinedPrice && (
                <p className="text-xs text-muted-foreground font-mono">
                  {combinedPrice} KD
                </p>
              )}
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

          <SearchableSingleSelect
            label="Made In"
            value={formData.made}
            onChange={(value) => handleFieldChange('made', value)}
            suggestions={mergedCountrySuggestions}
            placeholder="Search country..."
            emptyMessage="No country found."
            allowAddNew
            onNewValuePersist={handleNewCountryPersist}
          />
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
            allowAddNew
            onNewValuePersist={handleNewColourPersist}
          />
          <SearchableMultiSelect
            label="Material"
            values={formData.materials}
            onChange={(values) => handleFieldChange('materials', values)}
            suggestions={mergedMaterialSuggestions}
            placeholder="Search materials..."
            emptyMessage="No material found."
            allowAddNew
            onNewValuePersist={handleNewMaterialPersist}
          />
          <MultiValueInput
            ref={additionalInfoInputRef}
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
