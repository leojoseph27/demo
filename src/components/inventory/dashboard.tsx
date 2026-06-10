'use client';

import { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
} from 'lucide-react';

export function Dashboard() {
  const { setView, stats, setStats, setLoading } = useInventoryStore();

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
            <Button
              variant="outline"
              className="h-auto py-4 flex-col gap-2"
              onClick={async () => {
                const res = await fetch('/api/products/export');
                if (res.ok) {
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'products_export.xlsx';
                  a.click();
                  URL.revokeObjectURL(url);
                }
              }}
            >
              <Download className="h-6 w-6 text-purple-600" />
              <span className="text-xs">Export Excel</span>
            </Button>
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
        <Button
          variant="outline"
          className="w-full h-14 text-base"
          onClick={() => setView('products')}
        >
          <Package className="h-5 w-5 mr-2" />
          Browse All Products ({stats?.totalProducts ?? 0})
        </Button>
      )}
    </div>
  );
}
