---
Task ID: 1
Agent: Main Agent
Task: Replace Color and Material fields with searchable autocomplete multi-select component

Work Log:
- Created SearchableMultiSelect component using shadcn Command (cmdk) + Popover
- Created /api/products?mode=suggestions endpoint (added as mode to existing route to avoid [id] route conflict)
- Updated product-form.tsx to use SearchableMultiSelect for Colour and Material fields
- Added useMemo merged suggestions that include DB-fetched values + locally-added values
- Kept MultiValueInput for Additional Info field (only Colour and Material need autocomplete per requirements)
- Component features: type-to-filter, multi-select with removable chips, "Add X" for new values, keyboard support
- Built and tested successfully - suggestions API returns colours and materials from DB

Stage Summary:
- SearchableMultiSelect component created at src/components/inventory/searchable-multi-select.tsx
- Suggestions API added as ?mode=suggestions to src/app/api/products/route.ts
- Product form updated at src/components/inventory/product-form.tsx
- Data flow preserved: form sends string arrays, API normalizes to JSONB, export converts to comma-separated
- Import from Excel already handles comma-separated → array conversion via parseArrayField()
