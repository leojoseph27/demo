---
Task ID: 1
Agent: Main
Task: Add "Capture Barcode Photo" feature alongside existing live barcode scanner

Work Log:
- Explored existing barcode scanner implementation (barcode-scanner-modal.tsx uses html5-qrcode)
- Explored product-table.tsx to understand the search bar + ScanBarcode button flow
- Created new component: src/components/inventory/barcode-photo-capture.tsx
- Modified product-table.tsx to add Camera button + showPhotoCapture state + BarcodePhotoCapture modal
- Build succeeded with no errors
- Verified server starts correctly

Stage Summary:
- New feature added: "Capture Barcode Photo" button appears next to existing "Scan Barcode" button
- The existing live barcode scanner is completely untouched
- New component uses getUserMedia directly (for autofocus/torch control) + html5-qrcode scanFileV2 for barcode extraction
- Workflow: Open camera → Click Capture → Image freezes → Auto-process with scanFileV2 → If barcode found: populate search + auto-search → If not found: "No barcode detected. Please try again."
- Camera improvements: rear camera preference, continuous autofocus, autofocus, torch toggle
- Supported barcode formats: EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39
