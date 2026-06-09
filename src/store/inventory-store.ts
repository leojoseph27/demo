import { create } from 'zustand';

export type ViewMode = 'dashboard' | 'products' | 'add-product' | 'edit-product' | 'product-detail' | 'import' | 'filters';

export interface ProductImage {
  id: string;
  productId: string;
  imageUrl: string;
  displayOrder: number;
  isPrimary: boolean;
  createdAt: string;
}

export interface Product {
  id: string;
  sr: number | null;
  englishDescription: string | null;
  arabicDescription: string | null;
  ndNumber: string | null;
  barcode: string | null;
  colours: string | null;
  length: number | null;
  width: number | null;
  height: number | null;
  made: string | null;
  materials: string | null;
  additionalInfo: string | null;
  price: number | null;
  pcs: number | null;
  createdAt: string;
  updatedAt: string;
  images: ProductImage[];
}

export interface DashboardStats {
  totalProducts: number;
  productsAddedToday: number;
  productsMissingImages: number;
  productsMissingBarcode: number;
  productsMissingDimensions: number;
}

export interface DuplicateCheck {
  ndNumber?: { id: string; sr: number | null; englishDescription: string | null; ndNumber: string };
  barcode?: { id: string; sr: number | null; englishDescription: string | null; barcode: string };
}

interface InventoryState {
  // Auth
  isAuthenticated: boolean;
  user: { id: string; email: string; name: string | null } | null;

  // Navigation
  currentView: ViewMode;
  previousView: ViewMode | null;

  // Products
  products: Product[];
  totalProducts: number;
  currentPage: number;
  currentProduct: Product | null;

  // Stats
  stats: DashboardStats | null;

  // Search & Filters
  searchQuery: string;
  filterMaterial: string;
  filterColour: string;
  filterMade: string;
  filterPriceMin: string;
  filterPriceMax: string;

  // Loading states
  isLoading: boolean;
  isSaving: boolean;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';

  // Duplicates
  duplicates: DuplicateCheck | null;

  // Actions
  setAuthenticated: (auth: boolean, user?: any) => void;
  setView: (view: ViewMode) => void;
  goBack: () => void;
  setProducts: (products: Product[], total: number) => void;
  setCurrentProduct: (product: Product | null) => void;
  setStats: (stats: DashboardStats) => void;
  setSearchQuery: (query: string) => void;
  setFilter: (key: string, value: string) => void;
  clearFilters: () => void;
  setLoading: (loading: boolean) => void;
  setSaving: (saving: boolean) => void;
  setSaveStatus: (status: 'idle' | 'saving' | 'saved' | 'error') => void;
  setDuplicates: (duplicates: DuplicateCheck | null) => void;
  setCurrentPage: (page: number) => void;
}

export const useInventoryStore = create<InventoryState>((set, get) => ({
  // Auth
  isAuthenticated: false,
  user: null,

  // Navigation
  currentView: 'dashboard',
  previousView: null,

  // Products
  products: [],
  totalProducts: 0,
  currentPage: 1,
  currentProduct: null,

  // Stats
  stats: null,

  // Search & Filters
  searchQuery: '',
  filterMaterial: '',
  filterColour: '',
  filterMade: '',
  filterPriceMin: '',
  filterPriceMax: '',

  // Loading states
  isLoading: false,
  isSaving: false,
  saveStatus: 'idle',

  // Duplicates
  duplicates: null,

  // Actions
  setAuthenticated: (auth, user) => set({ isAuthenticated: auth, user: user || null }),
  setView: (view) => set((state) => ({ previousView: state.currentView, currentView: view })),
  goBack: () => set((state) => ({ currentView: state.previousView || 'dashboard', previousView: null })),
  setProducts: (products, total) => set({ products, totalProducts: total }),
  setCurrentProduct: (product) => set({ currentProduct: product }),
  setStats: (stats) => set({ stats }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setFilter: (key, value) => set((state) => ({ ...state, [key]: value })),
  clearFilters: () => set({
    filterMaterial: '',
    filterColour: '',
    filterMade: '',
    filterPriceMin: '',
    filterPriceMax: '',
  }),
  setLoading: (loading) => set({ isLoading: loading }),
  setSaving: (saving) => set({ isSaving: saving }),
  setSaveStatus: (status) => set({ saveStatus: status }),
  setDuplicates: (duplicates) => set({ duplicates }),
  setCurrentPage: (page) => set({ currentPage: page }),
}));
