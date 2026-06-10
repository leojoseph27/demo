'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useInventoryStore, Product, SortBy, SortOrder } from '@/store/inventory-store';
import {
  Search,
  Plus,
  SlidersHorizontal,
  ArrowLeft,
  Image as ImageIcon,
  Download,
  Upload,
  X,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  Layers,
  Coins,
} from 'lucide-react';

/** Format price as KD */
function formatPrice(price: number | null): string {
  if (price == null) return '-';
  return `${price.toFixed(3)} KD`;
}

/** Highlight matching text within a string */
function HighlightedText({ text, highlight }: { text: string; highlight: string }) {
  if (!highlight.trim()) return <>{text}</>;

  const regex = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-amber-200 text-amber-900 rounded px-0.5">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export function ProductTable() {
  const {
    products,
    totalProducts,
    currentPage,
    searchQuery,
    filterMaterial,
    filterColour,
    filterMade,
    filterPriceMin,
    filterPriceMax,
    sortBy,
    sortOrder,
    groupByNd,
    ndGroups,
    expandedGroups,
    selectedNdNumber,
    isLoading,
    setView,
    setProducts,
    setCurrentProduct,
    setSearchQuery,
    setLoading,
    setCurrentPage,
    setSortBy,
    setSortOrder,
    setGroupByNd,
    setNdGroups,
    toggleGroup,
    setSelectedNdNumber,
  } = useInventoryStore();

  const [showFilters, setShowFilters] = useState(false);
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const totalPages = Math.ceil(totalProducts / 50);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // ── Load products (normal / search mode) ──
  useEffect(() => {
    if (groupByNd && selectedNdNumber) {
      loadProductsByNdNumber(selectedNdNumber);
    } else if (!groupByNd) {
      loadProducts();
    }
  }, [currentPage, searchQuery, filterMaterial, filterColour, filterMade, filterPriceMin, filterPriceMax, sortBy, sortOrder, selectedNdNumber, groupByNd]);

  // ── Load ND groups when grouping is enabled ──
  useEffect(() => {
    if (groupByNd) {
      loadNdGroups();
    }
  }, [groupByNd, searchQuery]);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '50',
        sortBy,
        sortOrder,
      });
      if (searchQuery) params.set('search', searchQuery);
      if (filterMaterial) params.set('material', filterMaterial);
      if (filterColour) params.set('colour', filterColour);
      if (filterMade) params.set('made', filterMade);
      if (filterPriceMin) params.set('priceMin', filterPriceMin);
      if (filterPriceMax) params.set('priceMax', filterPriceMax);

      const res = await fetch(`/api/products?${params}`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products, data.total);
      }
    } catch (error) {
      console.error('Error loading products:', error);
    } finally {
      setLoading(false);
    }
  }, [currentPage, searchQuery, filterMaterial, filterColour, filterMade, filterPriceMin, filterPriceMax, sortBy, sortOrder]);

  const loadProductsByNdNumber = useCallback(async (ndNumber: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        ndNumber,
        limit: '500',
        sortBy,
        sortOrder,
      });
      const res = await fetch(`/api/products?${params}`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products, data.total);
      }
    } catch (error) {
      console.error('Error loading products by ND Number:', error);
    } finally {
      setLoading(false);
    }
  }, [sortBy, sortOrder]);

  const loadNdGroups = useCallback(async () => {
    try {
      const params = new URLSearchParams({ mode: 'nd-groups' });
      if (searchQuery) params.set('search', searchQuery);
      const res = await fetch(`/api/products?${params}`);
      if (res.ok) {
        const data = await res.json();
        setNdGroups(data.groups || []);
      }
    } catch (error) {
      console.error('Error loading ND groups:', error);
    }
  }, [searchQuery]);

  // ── Debounced instant search ──
  const handleSearchChange = (value: string) => {
    setLocalSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(value);
      setCurrentPage(1);
    }, 300);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSearchQuery(localSearch);
      setCurrentPage(1);
    }
  };

  const clearSearch = () => {
    setLocalSearch('');
    setSearchQuery('');
    setSelectedNdNumber('');
    setCurrentPage(1);
  };

  const parseJsonArray = (value: string | null): string[] => {
    if (!value) return [];
    try {
      const arr = JSON.parse(value);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  };

  const openProduct = (product: Product) => {
    setCurrentProduct(product);
    setView('product-detail');
  };

  const toggleSortOrder = () => {
    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
  };

  const handleGroupToggle = () => {
    if (groupByNd) {
      // Turning off grouping
      setGroupByNd(false);
      setSelectedNdNumber('');
      setProducts([], 0);
    } else {
      // Turning on grouping
      setGroupByNd(true);
      setSelectedNdNumber('');
    }
  };

  const handleGroupClick = (ndNumber: string) => {
    if (selectedNdNumber === ndNumber) {
      // Deselect — collapse
      setSelectedNdNumber('');
      setProducts([], 0);
    } else {
      // Select — expand and load products
      setSelectedNdNumber(ndNumber);
      toggleGroup(ndNumber);
    }
  };

  // ── Sort options ──
  const sortOptions: { value: SortBy; label: string }[] = [
    { value: 'sr', label: 'Sr Number' },
    { value: 'nd_number', label: 'ND Number' },
    { value: 'english_description', label: 'English Description' },
    { value: 'recently_updated', label: 'Recently Updated' },
    { value: 'recently_added', label: 'Recently Added' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setView('dashboard')} className="h-9 w-9 p-0">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Products</h1>
          <p className="text-sm text-muted-foreground">
            {groupByNd && selectedNdNumber
              ? `${totalProducts} products in ND ${selectedNdNumber}`
              : groupByNd
                ? `${ndGroups.length} ND groups`
                : `${totalProducts} total`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9"
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
          <Download className="h-4 w-4" />
        </Button>
        <Button size="sm" onClick={() => setView('add-product')} className="h-9">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Search Bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={localSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search by ND Number, Barcode, Description..."
            className="h-11 pl-9 pr-9"
          />
          {localSearch && (
            <button
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Search result info */}
      {searchQuery && !groupByNd && totalProducts > 0 && (
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <Badge variant="secondary" className="font-normal">
            <Search className="h-3 w-3 mr-1" />
            {totalProducts} matching product{totalProducts !== 1 ? 's' : ''}
          </Badge>
          {(() => {
            const ndMatches = products.filter(p =>
              p.ndNumber?.toLowerCase().includes(searchQuery.toLowerCase())
            );
            if (ndMatches.length > 0) {
              const uniqueNdNumbers = [...new Set(ndMatches.map(p => p.ndNumber))];
              return (
                <Badge variant="outline" className="font-normal bg-amber-50 border-amber-300 text-amber-800">
                  <Layers className="h-3 w-3 mr-1" />
                  {ndMatches.length} product{ndMatches.length !== 1 ? 's' : ''} in {uniqueNdNumbers.length} ND group{uniqueNdNumbers.length !== 1 ? 's' : ''} (shown first)
                </Badge>
              );
            }
            return null;
          })()}
        </div>
      )}

      {/* Controls row: Sort + Group toggle + Filters toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Sort */}
        <div className="flex items-center gap-1.5">
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
            <SelectTrigger className="h-9 w-[160px] text-xs">
              <ArrowUpDown className="h-3.5 w-3.5 mr-1" />
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map(opt => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleSortOrder}
            className="h-9 w-9 p-0"
          >
            {sortOrder === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
          </Button>
        </div>

        {/* Group by ND Number */}
        <Button
          variant={groupByNd ? 'default' : 'outline'}
          size="sm"
          onClick={handleGroupToggle}
          className="h-9 text-xs"
        >
          <Layers className="h-3.5 w-3.5 mr-1.5" />
          {groupByNd ? 'Grouped by ND' : 'Group by ND'}
        </Button>

        {/* Filters toggle */}
        <Button
          variant={showFilters ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
          className="h-9 text-xs"
        >
          <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
          Filters
        </Button>
      </div>

      {/* Filters */}
      {showFilters && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Filters</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  useInventoryStore.getState().clearFilters();
                  setLocalSearch('');
                  setSearchQuery('');
                  setSelectedNdNumber('');
                  setCurrentPage(1);
                }}
                className="h-7 text-xs"
              >
                Clear All
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                placeholder="Material"
                value={filterMaterial}
                onChange={(e) => useInventoryStore.getState().setFilter('filterMaterial', e.target.value)}
                className="h-10"
              />
              <Input
                placeholder="Colour"
                value={filterColour}
                onChange={(e) => useInventoryStore.getState().setFilter('filterColour', e.target.value)}
                className="h-10"
              />
              <Input
                placeholder="Made In"
                value={filterMade}
                onChange={(e) => useInventoryStore.getState().setFilter('filterMade', e.target.value)}
                className="h-10"
              />
              <div className="flex gap-2">
                <Input
                  placeholder="Min Price (KD)"
                  type="number"
                  value={filterPriceMin}
                  onChange={(e) => useInventoryStore.getState().setFilter('filterPriceMin', e.target.value)}
                  className="h-10"
                />
                <Input
                  placeholder="Max Price (KD)"
                  type="number"
                  value={filterPriceMax}
                  onChange={(e) => useInventoryStore.getState().setFilter('filterPriceMax', e.target.value)}
                  className="h-10"
                />
              </div>
            </div>
            <Button onClick={() => { setCurrentPage(1); }} className="w-full h-10">
              Apply Filters
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Group by ND Number View ── */}
      {groupByNd && !selectedNdNumber ? (
        isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : ndGroups.length === 0 ? (
          <div className="text-center py-12">
            <Layers className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">No ND Number groups found</p>
            {searchQuery && (
              <Button variant="outline" className="mt-4" onClick={clearSearch}>
                Clear Search
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            {ndGroups.map((group) => (
              <Card
                key={group.ndNumber}
                className="cursor-pointer hover:shadow-md transition-shadow active:scale-[0.99]"
                onClick={() => handleGroupClick(group.ndNumber)}
              >
                <CardContent className="p-3">
                  <div className="flex items-center gap-3">
                    {expandedGroups.has(group.ndNumber) ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">
                        {searchQuery ? (
                          <HighlightedText text={group.ndNumber} highlight={searchQuery} />
                        ) : (
                          group.ndNumber
                        )}
                      </p>
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      {group.count} product{group.count !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : null}

      {/* ── Products in selected ND group ── */}
      {groupByNd && selectedNdNumber && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setSelectedNdNumber(''); setProducts([], 0); }}
              className="h-8 px-2"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Groups
            </Button>
            <Badge variant="secondary" className="font-medium">
              ND {selectedNdNumber} — {totalProducts} product{totalProducts !== 1 ? 's' : ''}
            </Badge>
          </div>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full rounded-lg" />
              ))}
            </div>
          ) : (
            products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                searchQuery={searchQuery}
                onClick={() => openProduct(product)}
              />
            ))
          )}
        </div>
      )}

      {/* ── Normal Product List (no grouping) ── */}
      {!groupByNd && (
        isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : products.length === 0 && totalProducts === 0 ? (
          <div className="text-center py-16">
            <ImageIcon className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
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
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-12">
            <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">No products match your search</p>
            <Button variant="outline" className="mt-4" onClick={clearSearch}>
              Clear Search
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                searchQuery={searchQuery}
                onClick={() => openProduct(product)}
              />
            ))}
          </div>
        )
      )}

      {/* Pagination */}
      {!groupByNd && totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage(currentPage - 1)}
              className="h-8"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage(currentPage + 1)}
              className="h-8"
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Reusable Product Card ──
function ProductCard({
  product,
  searchQuery,
  onClick,
}: {
  product: Product;
  searchQuery: string;
  onClick: () => void;
}) {
  const colours = parseJsonArray(product.colours);
  const materials = parseJsonArray(product.materials);
  const primaryImage = product.images.find(img => img.isPrimary) || product.images[0];

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow active:scale-[0.99]"
      onClick={onClick}
    >
      <CardContent className="p-3">
        <div className="flex gap-3">
          {/* Thumbnail */}
          <div className="w-16 h-16 rounded-lg overflow-hidden bg-muted shrink-0">
            {primaryImage ? (
              <img
                src={primaryImage.imageUrl}
                alt="Product"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ImageIcon className="h-6 w-6 text-muted-foreground/50" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm truncate">
                  {product.englishDescription || product.ndNumber || (product.sr != null ? `Item #${product.sr}` : 'Unnamed Product')}
                </p>
                {product.arabicDescription && (
                  <p className="text-xs text-muted-foreground truncate" dir="rtl">
                    {product.arabicDescription}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="font-semibold text-sm">
                  {formatPrice(product.price)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                Sr: {product.sr ?? '-'}
              </Badge>
              {product.ndNumber && (
                <Badge
                  variant="outline"
                  className={`text-[10px] h-5 px-1.5 ${
                    searchQuery && product.ndNumber.toLowerCase().includes(searchQuery.toLowerCase())
                      ? 'bg-amber-50 border-amber-300 text-amber-800'
                      : ''
                  }`}
                >
                  {searchQuery ? (
                    <HighlightedText text={product.ndNumber} highlight={searchQuery} />
                  ) : (
                    product.ndNumber
                  )}
                </Badge>
              )}
              {product.barcode && (
                <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                  {product.barcode}
                </Badge>
              )}
              {product.made && (
                <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                  {product.made}
                </Badge>
              )}
              {(product.length != null || product.width != null || product.height != null) && (
                <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                  {product.length ?? '?'}×{product.width ?? '?'}×{product.height ?? '?'}
                </Badge>
              )}
              {materials.slice(0, 1).map((m, i) => (
                <Badge key={i} variant="secondary" className="text-[10px] h-5 px-1.5">
                  {m}
                </Badge>
              ))}
              {materials.length > 1 && (
                <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                  +{materials.length - 1}
                </Badge>
              )}
              {colours.slice(0, 2).map((c, i) => (
                <Badge key={i} variant="secondary" className="text-[10px] h-5 px-1.5">
                  {c}
                </Badge>
              ))}
              {colours.length > 2 && (
                <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                  +{colours.length - 2}
                </Badge>
              )}
              {product.pcs != null && (
                <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                  {product.pcs} pcs
                </Badge>
              )}
              {product.images.length > 0 && (
                <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                  {product.images.length} img
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
