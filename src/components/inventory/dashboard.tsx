'use client';

import { useEffect, useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useInventoryStore, DashboardStats } from '@/store/inventory-store';
import {
  Package,
  Plus,
  Calendar,
  ImageOff,
  Barcode,
  Ruler,
  Upload,
  Download,
  Search,
  Trash2,
  Loader2,
  FileDown,
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

export function Dashboard() {
  const { setView, stats, setStats, setLoading } = useInventoryStore();
  const [isClearing, setIsClearing] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [srRange, setSrRange] = useState('');
  const [srRangeError, setSrRangeError] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/products/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    {
      title: 'Total Products',
      value: stats?.totalProducts ?? 0,
      icon: Package,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      title: 'Added Today',
      value: stats?.productsAddedToday ?? 0,
      icon: Calendar,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      title: 'Missing Images',
      value: stats?.productsMissingImages ?? 0,
      icon: ImageOff,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
    },
    {
      title: 'Missing Barcode',
      value: stats?.productsMissingBarcode ?? 0,
      icon: Barcode,
      color: 'text-red-600',
      bg: 'bg-red-50',
    },
    {
      title: 'Missing Dimensions',
      value: stats?.productsMissingDimensions ?? 0,
      icon: Ruler,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Product Inventory & Catalog Management</p>
        </div>
        <Button onClick={() => setView('add-product')} className="h-11 px-4">
          <Plus className="h-5 w-5 mr-2" />
          Add Product
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {statCards.map((card) => (
          <Card key={card.title} className="overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={`${card.bg} p-2.5 rounded-lg`}>
                  <card.icon className={`h-5 w-5 ${card.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold">{card.value}</p>
                  <p className="text-xs text-muted-foreground leading-tight">{card.title}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Button
              variant="outline"
              className="h-auto py-4 flex-col gap-2"
              onClick={() => setView('add-product')}
            >
              <Plus className="h-6 w-6 text-emerald-600" />
              <span className="text-xs">Add Product</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto py-4 flex-col gap-2"
              onClick={() => setView('products')}
            >
              <Search className="h-6 w-6 text-blue-600" />
              <span className="text-xs">Browse Products</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto py-4 flex-col gap-2"
              onClick={() => setView('import')}
            >
              <Upload className="h-6 w-6 text-amber-600" />
              <span className="text-xs">Import Excel</span>
            </Button>
            <div className="relative" ref={exportMenuRef}>
              <Button
                variant="outline"
                className="h-auto py-4 flex-col gap-2 w-full"
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={isExporting}
              >
                {isExporting ? (
                  <span className="h-6 w-6 border-2 border-purple-600 border-t-transparent animate-spin rounded-full" />
                ) : (
                  <Download className="h-6 w-6 text-purple-600" />
                )}
                <span className="text-xs">Export Excel</span>
              </Button>

              {showExportMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => { setShowExportMenu(false); setSrRangeError(''); }} />
                  <div className="absolute left-0 top-full mt-1 z-50 w-72 bg-popover border rounded-lg shadow-lg p-3 space-y-3">
                    <p className="text-sm font-medium">Export Excel</p>

                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start h-9"
                      onClick={async () => {
                        setIsExporting(true);
                        setShowExportMenu(false);
                        try {
                          const res = await fetch('/api/products/export');
                          if (!res.ok) throw new Error('Export failed');
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = 'products_export.xlsx';
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch { toast.error('Export failed'); }
                        finally { setIsExporting(false); }
                      }}
                      disabled={isExporting}
                    >
                      <FileDown className="h-4 w-4 mr-2" />
                      Export All Products
                    </Button>

                    <div className="border-t" />

                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">Export by Serial Number Range</p>
                      <Input
                        placeholder="e.g. 1-7, 25-40, 100-150"
                        value={srRange}
                        onChange={(e) => { setSrRange(e.target.value); setSrRangeError(''); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            setSrRangeError('');
                            const trimmed = srRange.trim();
                            const m = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
                            if (!m) { setSrRangeError('Invalid format. Use: 1-7, 25-40, 100-150'); return; }
                            const from = parseInt(m[1], 10), to = parseInt(m[2], 10);
                            if (from > to) { setSrRangeError('Start number cannot be greater than end number.'); return; }
                            setIsExporting(true);
                            fetch(`/api/products/export?srFrom=${from}&srTo=${to}`)
                              .then(res => { if (!res.ok) return res.json().then(b => { throw new Error(b.error || 'Export failed'); }); return res.blob(); })
                              .then(blob => {
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a'); a.href = url; a.download = `products_sr_${from}_${to}.xlsx`; a.click(); URL.revokeObjectURL(url);
                                setShowExportMenu(false); setSrRange('');
                              })
                              .catch(err => toast.error(err.message || 'Export failed'))
                              .finally(() => setIsExporting(false));
                          }
                        }}
                        className="h-9 text-sm"
                        disabled={isExporting}
                      />
                      {srRangeError && <p className="text-xs text-destructive">{srRangeError}</p>}
                      <Button
                        size="sm"
                        className="w-full h-9"
                        disabled={isExporting || !srRange.trim()}
                        onClick={() => {
                          setSrRangeError('');
                          const trimmed = srRange.trim();
                          const m = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
                          if (!m) { setSrRangeError('Invalid format. Use: 1-7, 25-40, 100-150'); return; }
                          const from = parseInt(m[1], 10), to = parseInt(m[2], 10);
                          if (from > to) { setSrRangeError('Start number cannot be greater than end number.'); return; }
                          setIsExporting(true);
                          fetch(`/api/products/export?srFrom=${from}&srTo=${to}`)
                            .then(res => { if (!res.ok) return res.json().then(b => { throw new Error(b.error || 'Export failed'); }); return res.blob(); })
                            .then(blob => {
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a'); a.href = url; a.download = `products_sr_${from}_${to}.xlsx`; a.click(); URL.revokeObjectURL(url);
                              setShowExportMenu(false); setSrRange('');
                            })
                            .catch(err => toast.error(err.message || 'Export failed'))
                            .finally(() => setIsExporting(false));
                        }}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Export Range
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Empty State or Browse Products */}
      {(stats?.totalProducts ?? 0) === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Package className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
            <p className="text-lg font-medium text-muted-foreground">No products found</p>
            <p className="text-sm text-muted-foreground mt-1">Import an Excel file to begin.</p>
            <div className="flex gap-3 justify-center mt-6">
              <Button onClick={() => setView('import')}>
                <Upload className="h-4 w-4 mr-2" />
                Import Excel
              </Button>
              <Button variant="outline" onClick={() => setView('add-product')}>
                <Plus className="h-4 w-4 mr-2" />
                Add Product
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <Button
            variant="outline"
            className="w-full h-14 text-base"
            onClick={() => setView('products')}
          >
            <Package className="h-5 w-5 mr-2" />
            Browse All Products ({stats?.totalProducts ?? 0})
          </Button>

          {/* Clear All Data */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 h-10 text-sm"
                disabled={isClearing}
              >
                {isClearing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Clearing all data...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Clear All Products & Start Over
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete all products?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete <strong>all {stats?.totalProducts ?? 0} products</strong>,
                  all product images from the database, and all image files from storage.
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={async () => {
                    setIsClearing(true);
                    try {
                      const res = await fetch('/api/products/cleanup?mode=all', { method: 'DELETE' });
                      if (res.ok) {
                        const data = await res.json();
                        toast.success(data.message || 'All data cleared');
                        // Refresh stats to show zeros
                        await loadStats();
                      } else {
                        toast.error('Failed to clear data');
                      }
                    } catch {
                      toast.error('Failed to clear data');
                    } finally {
                      setIsClearing(false);
                    }
                  }}
                >
                  Yes, delete everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}
