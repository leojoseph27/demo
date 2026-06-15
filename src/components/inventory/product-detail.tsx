'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ImageGallery } from './image-gallery';
import { useInventoryStore } from '@/store/inventory-store';
import {
  ArrowLeft,
  Edit,
  Trash2,
  Package,
  Ruler,
  Tag,
  MapPin,
  Coins,
  Hash,
  Info,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

export function ProductDetail() {
  const { currentProduct, setView, goBack, setCurrentProduct } = useInventoryStore();
  const [product, setProduct] = useState(currentProduct);

  useEffect(() => {
    if (currentProduct?.id) {
      // Refresh product data
      fetch(`/api/products/${currentProduct.id}`)
        .then(res => res.json())
        .then(data => {
          setProduct(data);
          setCurrentProduct(data);
        })
        .catch(console.error);
    }
  }, [currentProduct?.id]);

  if (!product) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-muted-foreground">Product not found</p>
      </div>
    );
  }

  const parseJsonArray = (value: string | null | any[]): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
      const arr = JSON.parse(value);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  };

  const colours = parseJsonArray(product.colours);
  const materials = parseJsonArray(product.materials);
  const additionalInfo = parseJsonArray(product.additionalInfo);

  const handleDelete = async () => {
    try {
      const res = await fetch(`/api/products/${product.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Product deleted successfully');
        setCurrentProduct(null);
        setView('products');
      } else {
        toast.error('Failed to delete product');
      }
    } catch (error) {
      toast.error('Failed to delete product');
    }
  };

  const handleImageUpload = async (file: File, isPrimary?: boolean) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('productId', product.id);
    if (isPrimary) formData.append('isPrimary', 'true');

    const res = await fetch('/api/images/upload', {
      method: 'POST',
      body: formData,
    });

    if (res.ok) {
      const newImage = await res.json();
      const updatedProduct = {
        ...product,
        images: [...product.images, newImage],
      };
      setProduct(updatedProduct);
      setCurrentProduct(updatedProduct);
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
    if (res.ok) {
      const updatedProduct = {
        ...product,
        images: product.images.filter(img => img.id !== imageId),
      };
      setProduct(updatedProduct);
      setCurrentProduct(updatedProduct);
    }
  };

  const handleSetPrimary = async (imageId: string) => {
    const res = await fetch(`/api/images/${imageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPrimary: true }),
    });
    if (res.ok) {
      const updatedProduct = {
        ...product,
        images: product.images.map(img => ({
          ...img,
          isPrimary: img.id === imageId,
        })),
      };
      setProduct(updatedProduct);
      setCurrentProduct(updatedProduct);
    }
  };

  return (
    <div className="space-y-4 pb-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setView('products')} className="h-9 w-9 p-0">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{product.englishDescription || product.ndNumber || (product.sr != null ? `Item #${product.sr}` : 'Product Details')}</h1>
          <p className="text-sm text-muted-foreground">
            {product.ndNumber && `ND: ${product.ndNumber}`}
            {product.barcode && ` | Barcode: ${product.barcode}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setView('edit-product')}
            className="h-9"
          >
            <Edit className="h-4 w-4 mr-1" />
            Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" className="h-9">
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Product</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete &ldquo;{product.englishDescription}&rdquo;? This action cannot be undone and will also delete all associated images.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Images */}
      <Card>
        <CardContent className="pt-4">
          <ImageGallery
            images={product.images}
            productId={product.id}
            onUpload={handleImageUpload}
            onDelete={handleImageDelete}
            onSetPrimary={handleSetPrimary}
          />
        </CardContent>
      </Card>

      {/* Basic Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" />
            Product Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <InfoRow icon={Hash} label="Sr No." value={product.sr?.toString()} />
            <InfoRow icon={Coins} label="Price (KD)" value={product.price != null ? `${product.price.toFixed(3)} KD` : null} />
            <InfoRow icon={Tag} label="ND Number" value={product.ndNumber} />
            <InfoRow icon={Tag} label="Barcode" value={product.barcode} />
            <InfoRow icon={MapPin} label="Made In" value={product.made} />
            <InfoRow icon={Package} label="Pieces" value={product.pcs?.toString()} />
          </div>

          {product.englishDescription && (
            <div className="pt-2">
              <p className="text-xs text-muted-foreground">English Description</p>
              <p className="text-sm font-medium">{product.englishDescription}</p>
            </div>
          )}

          {product.arabicDescription && (
            <div className="pt-1" dir="rtl">
              <p className="text-xs text-muted-foreground" dir="ltr">Arabic Description</p>
              <p className="text-sm font-medium">{product.arabicDescription}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dimensions */}
      {(product.length || product.width || product.height) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Ruler className="h-4 w-4" />
              Dimensions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-xs text-muted-foreground">Length</p>
                <p className="text-lg font-semibold">{product.length ?? '-'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Width</p>
                <p className="text-lg font-semibold">{product.width ?? '-'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Height</p>
                <p className="text-lg font-semibold">{product.height ?? '-'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Properties */}
      {(colours.length > 0 || materials.length > 0 || additionalInfo.length > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Info className="h-4 w-4" />
              Properties
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {colours.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Colour</p>
                <div className="flex flex-wrap gap-1.5">
                  {colours.map((c, i) => (
                    <Badge key={i} variant="secondary">{c}</Badge>
                  ))}
                </div>
              </div>
            )}
            {materials.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Material</p>
                <div className="flex flex-wrap gap-1.5">
                  {materials.map((m, i) => (
                    <Badge key={i} variant="outline">{m}</Badge>
                  ))}
                </div>
              </div>
            )}
            {additionalInfo.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Additional Info</p>
                <div className="flex flex-wrap gap-1.5">
                  {additionalInfo.map((info, i) => (
                    <Badge key={i} variant="secondary" className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100">{info}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value || '-'}</p>
      </div>
    </div>
  );
}
