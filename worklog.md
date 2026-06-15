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
---
Task ID: 1
Agent: main
Task: Refactor barcode-photo-capture to prioritize barcode decoding over OCR

Work Log:
- Read and analyzed the full barcode-photo-capture.tsx component (809 lines)
- Added TypeScript declarations for BarcodeDetector browser API (not in default TS DOM lib)
- Added DetectionConfidence type and PREFERRED_BARCODE_FORMATS constant (EAN-13, EAN-8, UPC-A, UPC-E, Code128, Code39)
- Added detectionConfidence state variable
- Created tryBarcodeDetector() callback: uses native BarcodeDetector API with preferred format filtering
- Created tryHtml5Qrcode() callback: uses html5-qrcode library for barcode decoding (extracted from inline code)
- Reordered captureAndProcess pipeline: Phase 1 (barcode decoding, High confidence) → Phase 2 (OCR fallback, Low confidence)
- If barcode decoded in Phase 1, OCR is completely skipped
- Updated result UI: green styling for High confidence (barcode), amber styling for Low confidence (OCR fallback)
- Shows "Confidence: High" or "Confidence: Low" badge
- Shows "OCR fallback" label when detected via OCR
- Changed button labels: "Search Product" → "Search", "Retake Photo" → "Retake"
- Updated all UI text: "Number Detected" → "Barcode Detected", "No Number Found" → "No Barcode Found", etc.
- Updated scan zone overlay label: "Align number here" → "Align barcode here"
- Updated bottom instruction text to mention supported barcode formats
- Made croppedPreview conditional in detected result view (handles edge case)
- Build verification passed: `npx next build` succeeds

Stage Summary:
- Pipeline now: BarcodeDetector (cropped) → BarcodeDetector (full) → html5-qrcode (cropped) → html5-qrcode (full) → OCR fallback
- Barcode decoding = High confidence, OCR = Low confidence
- UI clearly communicates detection method and confidence level
- Preferred barcode formats prioritized: EAN-13, EAN-8, UPC-A, UPC-E, Code128, Code39
