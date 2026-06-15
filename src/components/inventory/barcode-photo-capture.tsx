'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { X, Flashlight, FlashlightOff, Camera, RotateCcw, Loader2, Check, AlertCircle } from 'lucide-react';

interface OcrExtractionResult {
  barcodeDigits: string | null;  // e.g. "6901957183343"
  ndNumber: string | null;       // e.g. "ND-5271"
}

interface BarcodePhotoCaptureProps {
  onScan: (barcode: string, ndNumber?: string) => void;
  onClose: () => void;
}

type DetectionConfidence = 'High' | 'Medium' | 'Low';

type SearchSource = 'barcode_decoded' | 'nd_number' | 'barcode_ocr';

// ── Scan zone constants ──
const SCAN_BOX_WIDTH_PCT = 0.85;
const SCAN_BOX_HEIGHT_PCT = 0.28;

/**
 * Text patterns to IGNORE from OCR output.
 */
const IGNORE_PATTERNS = [
  /made\s*in\s*china/i,
  /made\s*in\s*\w+/i,
  /china/i,
  /product\s*of/i,
];

/**
 * Extract barcode digits and ND number from OCR text.
 */
function extractFromOcr(text: string): OcrExtractionResult {
  console.log('[PhotoCapture] extractFromOcr raw input:', JSON.stringify(text));

  const result: OcrExtractionResult = { barcodeDigits: null, ndNumber: null };

  const lines = text
    .split(/[\n\r]+/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  // ── Step 1: Extract ND Number ──
  const ndRegex = /(?:ND|nd|Nd|nD)\s*[-–—]?\s*(\d{3,6})/g;
  for (const line of lines) {
    if (IGNORE_PATTERNS.some(p => p.test(line))) continue;
    const ndMatch = ndRegex.exec(line);
    if (ndMatch) {
      result.ndNumber = `ND-${ndMatch[1]}`;
      console.log('[PhotoCapture] Found ND Number:', result.ndNumber);
      break;
    }
  }
  if (!result.ndNumber) {
    const fullMatch = ndRegex.exec(text);
    if (fullMatch) {
      result.ndNumber = `ND-${fullMatch[1]}`;
    }
  }

  // ── Step 2: Extract barcode digits ──
  let bestDigitLine: string | null = null;
  let bestDigitLen = 0;

  for (const line of lines) {
    if (IGNORE_PATTERNS.some(p => p.test(line))) continue;
    if (/^(?:ND|nd|Nd|nD)/i.test(line)) continue;
    const digitsOnly = line.replace(/[^0-9]/g, '');
    if (digitsOnly.length >= 8 && digitsOnly.length <= 14 && digitsOnly.length > bestDigitLen) {
      bestDigitLine = digitsOnly;
      bestDigitLen = digitsOnly.length;
    }
  }

  if (bestDigitLine) {
    result.barcodeDigits = bestDigitLine;
  } else {
    const allDigits = text.replace(/[^0-9]/g, '');
    if (allDigits.length >= 8 && allDigits.length <= 20) {
      result.barcodeDigits = allDigits;
    } else if (allDigits.length >= 4) {
      result.barcodeDigits = allDigits;
    }
  }

  return result;
}

/**
 * Scale up a small canvas. Uses nearest-neighbor interpolation to keep
 * sharp edges, which is critical for barcode line detection.
 */
function scaleCanvas(sourceCanvas: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = sourceCanvas.width * scale;
  out.height = sourceCanvas.height * scale;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);
  return out;
}

/**
 * Pre-process a canvas: greyscale → contrast boost → binarize.
 * Used for OCR fallback.
 */
function preprocessCanvas(sourceCanvas: HTMLCanvasElement, threshold: number = 128): HTMLCanvasElement {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(sourceCanvas, 0, 0);

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    let grey = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    grey = Math.min(255, Math.max(0, (grey - 128) * 1.5 + 128));
    const final = grey > threshold ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = final;
  }
  ctx.putImageData(imageData, 0, 0);
  return out;
}

/**
 * Heavy-duty image enhancement for barcode decoding.
 * Pipeline: greyscale → percentile contrast stretch + S-curve →
 *           unsharp mask sharpen → median filter denoise →
 *           adaptive threshold binarize
 */
function enhanceForBarcode(sourceCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;

  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = w;
  tmpCanvas.height = h;
  const tmpCtx = tmpCanvas.getContext('2d')!;
  tmpCtx.drawImage(sourceCanvas, 0, 0);
  const imgData = tmpCtx.getImageData(0, 0, w, h);
  const src = imgData.data;

  // Greyscale
  const grey = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    grey[i] = 0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2];
  }

  // Percentile contrast stretch + S-curve
  const sorted = Array.from(grey).sort((a, b) => a - b);
  const pLow = sorted[Math.floor(sorted.length * 0.05)];
  const pHigh = sorted[Math.floor(sorted.length * 0.95)];
  const range = Math.max(pHigh - pLow, 1);

  for (let i = 0; i < grey.length; i++) {
    let v = (grey[i] - pLow) / range;
    v = Math.min(1, Math.max(0, v));
    v = v < 0.5 ? 2 * v * v : 1 - 2 * (1 - v) * (1 - v);
    grey[i] = v * 255;
  }

  // Unsharp mask sharpening
  const sharpened = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      let sum = 0, count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            sum += grey[ny * w + nx];
            count++;
          }
        }
      }
      sharpened[idx] = Math.min(255, Math.max(0, grey[idx] + 1.5 * (grey[idx] - sum / count)));
    }
  }

  // Median filter denoise
  const denoised = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const neighbors: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            neighbors.push(sharpened[ny * w + nx]);
          }
        }
      }
      neighbors.sort((a, b) => a - b);
      denoised[idx] = neighbors[Math.floor(neighbors.length / 2)];
    }
  }

  // Adaptive threshold binarization
  const blockSize = Math.max(3, Math.min(31, Math.floor(Math.min(w, h) / 10) | 1));
  const c = 10;
  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  const outCtx = outCanvas.getContext('2d')!;
  const outData = outCtx.createImageData(w, h);
  const outPixels = outData.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let localSum = 0, localCount = 0;
      const halfBlock = Math.floor(blockSize / 2);
      for (let dy = -halfBlock; dy <= halfBlock; dy++) {
        for (let dx = -halfBlock; dx <= halfBlock; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            localSum += denoised[ny * w + nx];
            localCount++;
          }
        }
      }
      const val = denoised[y * w + x] > (localSum / localCount - c) ? 255 : 0;
      const outIdx = (y * w + x) * 4;
      outPixels[outIdx] = val;
      outPixels[outIdx + 1] = val;
      outPixels[outIdx + 2] = val;
      outPixels[outIdx + 3] = 255;
    }
  }

  outCtx.putImageData(outData, 0, 0);
  return outCanvas;
}

/**
 * Barcode Photo Capture component.
 *
 * Uses the SAME html5-qrcode camera engine as the Scan feature,
 * but adds a manual Capture step with auto-enlarge before decoding.
 *
 * Workflow:
 * 1. Open camera via html5-qrcode (same as Scan: rear camera, autofocus, continuous stream)
 * 2. Live camera with rectangular scan box overlay
 * 3. User presses Capture → freeze frame → crop scan area
 * 4. Auto-enlarge barcode region: 4x → 6x → 8x with enhancement
 * 5. Decode using html5-qrcode scanFileV2 (same decoder as Scan)
 * 6. If decoded → search immediately
 * 7. If not decoded → OCR fallback (ND Number + barcode digits)
 */
export function BarcodePhotoCapture({ onScan, onClose }: BarcodePhotoCaptureProps) {
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrCodeRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isStarting, setIsStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [croppedPreview, setCroppedPreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [noBarcodeFound, setNoBarcodeFound] = useState(false);
  const [processingStep, setProcessingStep] = useState<string>('');

  const [detectedBarcode, setDetectedBarcode] = useState<string | null>(null);
  const [detectedNdNumber, setDetectedNdNumber] = useState<string | null>(null);
  const [detectionConfidence, setDetectionConfidence] = useState<DetectionConfidence | null>(null);
  const [searchSource, setSearchSource] = useState<SearchSource | null>(null);

  // ── Start camera using html5-qrcode (same as Scan feature) ──
  useEffect(() => {
    let cancelled = false;

    const startCamera = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled || !scannerRef.current) return;

        const scannerId = 'photo-capture-scanner-element';
        scannerRef.current.id = scannerId;

        const html5QrCode = new Html5Qrcode(scannerId);
        html5QrCodeRef.current = html5QrCode;

        // Same camera config as Scan feature
        await html5QrCode.start(
          { facingMode: 'environment' },
          {
            fps: 15,
            qrbox: { width: 280, height: 160 },
            aspectRatio: 1.0,
          },
          // Success callback — we do NOT auto-search (that's the Scan feature)
          // We just let the camera run for the live preview
          () => {},
          // Failure callback — ignore
          () => {}
        );

        if (!cancelled) {
          setIsStarting(false);

          // Check torch support (same as Scan)
          try {
            const capabilities = html5QrCode.getRunningTrackCameraCapabilities?.();
            if (capabilities?.torchFeature?.()) {
              setTorchSupported(true);
            }
          } catch {}
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error('[PhotoCapture] Camera start error:', err);
          const msg = err?.message || err?.toString() || '';
          if (msg.includes('Permission') || msg.includes('NotAllowed')) {
            setError('Camera permission denied. Please allow camera access and try again.');
          } else if (msg.includes('NotFound') || msg.includes('Requested device not found')) {
            setError('No camera found. Please connect a camera and try again.');
          } else {
            setError(`Could not start camera: ${msg || 'Unknown error'}`);
          }
          setIsStarting(false);
        }
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      if (html5QrCodeRef.current) {
        html5QrCodeRef.current
          .stop()
          .then(() => { html5QrCodeRef.current?.clear(); })
          .catch(() => {});
      }
    };
  }, []);

  // ── Toggle flashlight/torch (same API as Scan) ──
  const toggleTorch = useCallback(async () => {
    if (!html5QrCodeRef.current) return;
    try {
      const capabilities = html5QrCodeRef.current.getRunningTrackCameraCapabilities?.();
      if (capabilities?.torchFeature?.()) {
        const newState = !torchOn;
        await capabilities.torch(newState);
        setTorchOn(newState);
      }
    } catch (err) {
      console.error('[PhotoCapture] Torch toggle error:', err);
    }
  }, [torchOn]);

  // ── Capture: freeze the current camera frame ──
  const captureImage = useCallback(async () => {
    if (!html5QrCodeRef.current) return;

    try {
      // Pause the scanner — this freezes the video element
      await html5QrCodeRef.current.pause(true); // keep the camera track alive

      // Get the video element that html5-qrcode created
      const videoEl = document.querySelector('#photo-capture-scanner-element video') as HTMLVideoElement;
      if (!videoEl) {
        console.error('[PhotoCapture] Could not find video element');
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) return;

      // Draw the current frame at full video resolution
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

      const fullDataUrl = canvas.toDataURL('image/jpeg', 0.95);
      setCapturedImage(fullDataUrl);

      // Crop the scan box region
      const croppedCanvas = cropScanBox(canvas);
      const croppedDataUrl = croppedCanvas.toDataURL('image/jpeg', 0.92);
      setCroppedPreview(croppedDataUrl);

      setNoBarcodeFound(false);
      setDetectedBarcode(null);
      setDetectedNdNumber(null);
      setDetectionConfidence(null);
      setSearchSource(null);
    } catch (err) {
      console.error('[PhotoCapture] Capture error:', err);
    }
  }, []);

  // ── Crop the rectangular scan box from a full canvas ──
  const cropScanBox = useCallback((fullCanvas: HTMLCanvasElement): HTMLCanvasElement => {
    const imgW = fullCanvas.width;
    const imgH = fullCanvas.height;

    const boxHeight = Math.round(imgH * SCAN_BOX_HEIGHT_PCT);
    const boxTop = Math.round(imgH * 0.5 - boxHeight / 2);
    const boxWidth = Math.round(imgW * SCAN_BOX_WIDTH_PCT);
    const boxLeft = Math.round((imgW - boxWidth) / 2);

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = boxWidth;
    cropCanvas.height = boxHeight;
    const ctx = cropCanvas.getContext('2d')!;
    ctx.drawImage(fullCanvas, boxLeft, boxTop, boxWidth, boxHeight, 0, 0, boxWidth, boxHeight);

    console.log('[PhotoCapture] Crop region:', `${boxWidth}x${boxHeight}`, `from ${imgW}x${imgH}`);
    return cropCanvas;
  }, []);

  // ── Decode barcode from canvas using html5-qrcode scanFileV2 ──
  // This is the SAME decoder that works in the Scan feature
  const decodeWithHtml5Qrcode = useCallback(async (
    canvas: HTMLCanvasElement,
    label: string,
  ): Promise<string | null> => {
    try {
      const { Html5Qrcode } = await import('html5-qrcode');

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', 0.95);
      });
      if (!blob) return null;

      // Use a unique element ID for each scan to avoid conflicts
      const elemId = `photo-decode-${Date.now()}`;
      const scanner = new Html5Qrcode(elemId);
      try {
        const file = new File([blob], `${label}.jpg`, { type: 'image/jpeg' });
        const result = await scanner.scanFileV2(file, false);
        console.log(`[PhotoCapture] html5-qrcode decoded (${label}):`, result.decodedText);
        return result.decodedText;
      } catch {
        console.log(`[PhotoCapture] html5-qrcode failed (${label})`);
        return null;
      } finally {
        try { scanner.clear(); } catch {}
      }
    } catch (err) {
      console.error('[PhotoCapture] html5-qrcode library error:', err);
      return null;
    }
  }, []);

  // ── Run OCR with different configs ──
  const runOcrWithConfigs = useCallback(async (canvas: HTMLCanvasElement, label: string): Promise<OcrExtractionResult | null> => {
    console.log(`[PhotoCapture] Running OCR on: ${label} (${canvas.width}x${canvas.height})`);

    try {
      const Tesseract = await import('tesseract.js');

      const configs = [
        { psm: '6', desc: 'uniform block of text' },
        { psm: '4', desc: 'single column of text' },
        { psm: '3', desc: 'fully automatic' },
        { psm: '7', desc: 'single uniform text line' },
        { psm: '13', desc: 'raw line (no OSD)' },
      ];

      let bestResult: OcrExtractionResult | null = null;
      let bestScore = 0;

      for (const config of configs) {
        try {
          const worker = await Tesseract.createWorker('eng', 1);
          await worker.setParameters({ tessedit_pageseg_mode: config.psm });

          const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
          const { data } = await worker.recognize(dataUrl);
          await worker.terminate();

          const ocrText = data.text || '';
          console.log(`[PhotoCapture] OCR PSM=${config.psm}:`, JSON.stringify(ocrText));

          const extracted = extractFromOcr(ocrText);
          const score = (extracted.barcodeDigits ? extracted.barcodeDigits.length : 0)
                     + (extracted.ndNumber ? 20 : 0);

          if (score > bestScore) {
            bestResult = extracted;
            bestScore = score;
          }
        } catch (err) {
          console.log(`[PhotoCapture] PSM=${config.psm} failed:`, err);
        }
      }

      return bestResult;
    } catch (err) {
      console.error('[PhotoCapture] OCR error:', err);
      return null;
    }
  }, []);

  // ── Start processing: enlarge + decode + search ──
  const startProcessing = useCallback(async () => {
    const fullCanvas = canvasRef.current;
    if (!fullCanvas) return;

    setIsProcessing(true);
    setNoBarcodeFound(false);
    setDetectedBarcode(null);
    setDetectedNdNumber(null);
    setDetectionConfidence(null);
    setSearchSource(null);

    console.log('[PhotoCapture] Captured image size:', `${fullCanvas.width}x${fullCanvas.height}`);

    // Crop the scan box region
    const croppedCanvas = cropScanBox(fullCanvas);
    console.log('[PhotoCapture] Cropped size:', `${croppedCanvas.width}x${croppedCanvas.height}`);

    // ══════════════════════════════════════════════════════════
    // PHASE 1: BARCODE DECODING (High Confidence)
    // Use html5-qrcode scanFileV2 — the SAME decoder that works in Scan
    // Try multiple scales: 4x → 6x → 8x, stop on first success
    // ══════════════════════════════════════════════════════════
    let barcodeResult: string | null = null;
    let usedScale = 0;

    const scales = [4, 6, 8];

    for (const scale of scales) {
      if (barcodeResult) break;

      const label = `cropped ${scale}x`;
      setProcessingStep(`Decoding ${label}...`);

      // Scale up using nearest-neighbor (sharp edges for barcodes)
      const scaled = scaleCanvas(croppedCanvas, scale);
      console.log(`[PhotoCapture] Trying ${label}: ${scaled.width}x${scaled.height}`);

      // Apply heavy enhancement
      const enhanced = enhanceForBarcode(scaled);

      // Try the SAME html5-qrcode decoder that works in Scan
      const result = await decodeWithHtml5Qrcode(enhanced, label);
      if (result) {
        barcodeResult = result;
        usedScale = scale;
        break;
      }

      // Also try on the raw (non-enhanced) scaled version
      const rawResult = await decodeWithHtml5Qrcode(scaled, `${label} raw`);
      if (rawResult) {
        barcodeResult = rawResult;
        usedScale = scale;
        break;
      }
    }

    // Also try the raw cropped image without scaling (sometimes works for large labels)
    if (!barcodeResult) {
      setProcessingStep('Trying raw crop...');
      barcodeResult = await decodeWithHtml5Qrcode(croppedCanvas, 'cropped raw');
      if (barcodeResult) usedScale = 1;
    }

    // Also try the full captured image
    if (!barcodeResult) {
      setProcessingStep('Trying full image...');
      barcodeResult = await decodeWithHtml5Qrcode(fullCanvas, 'full image');
      if (barcodeResult) usedScale = 1;
    }

    // If barcode decoded, also run OCR for ND number
    let ocrNdNumber: string | null = null;
    if (barcodeResult) {
      console.log(`[PhotoCapture] Barcode decoded at ${usedScale}x:`, barcodeResult);
      setProcessingStep('Checking for ND number...');
      const quickOcr = await runOcrWithConfigs(croppedCanvas, 'ND number extraction');
      if (quickOcr?.ndNumber) {
        ocrNdNumber = quickOcr.ndNumber;
      }
    }

    if (barcodeResult) {
      console.log('[PhotoCapture] ── Results ──');
      console.log('[PhotoCapture]   Barcode:', barcodeResult);
      console.log('[PhotoCapture]   ND Number:', ocrNdNumber || '(none)');
      console.log('[PhotoCapture]   Scale used:', usedScale + 'x');
      console.log('[PhotoCapture]   Confidence: High');

      setIsProcessing(false);
      setProcessingStep('');
      setDetectedBarcode(barcodeResult);
      setDetectedNdNumber(ocrNdNumber);
      setDetectionConfidence('High');
      setSearchSource('barcode_decoded');

      // Search immediately on successful decode
      onScan(barcodeResult, ocrNdNumber || undefined);
      return;
    }

    // ══════════════════════════════════════════════════════════
    // PHASE 2: OCR FALLBACK (Medium/Low Confidence)
    // ══════════════════════════════════════════════════════════
    console.log('[PhotoCapture] Barcode decoding failed, falling back to OCR...');

    const targetWidth = 800;
    const autoScale = Math.max(2, Math.min(4, Math.ceil(targetWidth / croppedCanvas.width)));
    const scaledCanvas = scaleCanvas(croppedCanvas, autoScale);
    const enhancedCanvas = preprocessCanvas(scaledCanvas, 120);

    let ocrResult: OcrExtractionResult | null = null;

    setProcessingStep('Reading label text...');
    ocrResult = await runOcrWithConfigs(croppedCanvas, 'cropped region');

    if (!ocrResult?.barcodeDigits && !ocrResult?.ndNumber) {
      setProcessingStep('Enhancing image and retrying...');
      ocrResult = await runOcrWithConfigs(enhancedCanvas, 'enhanced cropped');
    }

    if (!ocrResult?.barcodeDigits && !ocrResult?.ndNumber) {
      setProcessingStep('Scanning full image...');
      ocrResult = await runOcrWithConfigs(fullCanvas, 'full image');
    }

    if (!ocrResult?.barcodeDigits && !ocrResult?.ndNumber) {
      setProcessingStep('Enhancing full image...');
      const scaledFull = scaleCanvas(fullCanvas, 2);
      const enhancedFull = preprocessCanvas(scaledFull, 130);
      ocrResult = await runOcrWithConfigs(enhancedFull, 'enhanced + scaled full');
    }

    // ── Final result ──
    const finalNdNumber = ocrResult?.ndNumber || null;
    const finalBarcode = ocrResult?.barcodeDigits || null;

    setIsProcessing(false);
    setProcessingStep('');

    if (finalNdNumber) {
      setDetectedNdNumber(finalNdNumber);
      setDetectedBarcode(finalBarcode);
      setDetectionConfidence('Medium');
      setSearchSource('nd_number');
      console.log('[PhotoCapture] ── Results ──');
      console.log('[PhotoCapture]   ND Number:', finalNdNumber);
      console.log('[PhotoCapture]   Barcode (OCR):', finalBarcode || '(none)');
    } else if (finalBarcode) {
      setDetectedBarcode(finalBarcode);
      setDetectionConfidence('Low');
      setSearchSource('barcode_ocr');
      console.log('[PhotoCapture] ── Results ──');
      console.log('[PhotoCapture]   Barcode (OCR):', finalBarcode);
    } else {
      setNoBarcodeFound(true);
    }
  }, [cropScanBox, decodeWithHtml5Qrcode, runOcrWithConfigs, onScan]);

  // ── Confirm detected value → search ──
  const confirmBarcode = useCallback(() => {
    if (!detectedBarcode && !detectedNdNumber) return;

    // Stop camera
    if (html5QrCodeRef.current) {
      html5QrCodeRef.current.stop().catch(() => {});
    }

    if (searchSource === 'nd_number') {
      onScan(detectedNdNumber || '', detectedBarcode || undefined);
    } else {
      onScan(detectedBarcode || '', detectedNdNumber || undefined);
    }
  }, [detectedBarcode, detectedNdNumber, searchSource, onScan]);

  // ── Retry: resume camera and reset state ──
  const retry = useCallback(async () => {
    setCapturedImage(null);
    setCroppedPreview(null);
    setNoBarcodeFound(false);
    setIsProcessing(false);
    setDetectedBarcode(null);
    setDetectedNdNumber(null);
    setDetectionConfidence(null);
    setSearchSource(null);
    setProcessingStep('');

    // Resume the html5-qrcode camera
    if (html5QrCodeRef.current) {
      try {
        const state = html5QrCodeRef.current.getState?.();
        // 2 = PAUSED, 1 = RUNNING
        if (state === 2) {
          await html5QrCodeRef.current.resume();
        } else if (state !== 1) {
          // Not running — restart
          await html5QrCodeRef.current.start(
            { facingMode: 'environment' },
            { fps: 15, qrbox: { width: 280, height: 160 }, aspectRatio: 1.0 },
            () => {},
            () => {}
          );
        }
      } catch (err) {
        console.error('[PhotoCapture] Resume error:', err);
      }
    }
  }, []);

  // ── Handle close: clean up camera ──
  const handleClose = useCallback(() => {
    if (html5QrCodeRef.current) {
      html5QrCodeRef.current.stop().catch(() => {});
    }
    onClose();
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 text-white z-10">
        <h2 className="text-lg font-semibold">
          {(detectedBarcode || detectedNdNumber)
            ? searchSource === 'barcode_decoded'
              ? 'Barcode Decoded'
              : searchSource === 'nd_number'
                ? 'ND Number Detected'
                : 'Barcode Detected (OCR)'
            : capturedImage
              ? isProcessing
                ? processingStep || 'Processing...'
                : noBarcodeFound
                  ? 'No Barcode Found'
                  : 'Analyzing...'
              : 'Capture Barcode Photo'}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClose}
          className="text-white hover:bg-white/20 h-9 w-9 p-0"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Camera / Captured image viewport */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        {/* Live camera feed via html5-qrcode (same as Scan) */}
        {!capturedImage && (
          <div
            ref={scannerRef}
            className="w-full h-full"
            style={{ minHeight: '300px' }}
          />
        )}

        {/* Captured frozen frame — shown during processing */}
        {capturedImage && !detectedBarcode && !detectedNdNumber && !noBarcodeFound && (
          <img
            src={capturedImage}
            alt="Captured barcode"
            className="w-full h-full object-contain"
          />
        )}

        {/* ── RECTANGULAR SCAN BOX OVERLAY (camera live) ── */}
        {!capturedImage && !error && !isStarting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div
              className="relative rounded-lg overflow-hidden"
              style={{
                width: `${SCAN_BOX_WIDTH_PCT * 100}%`,
                height: `${SCAN_BOX_HEIGHT_PCT * 100}%`,
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.45)',
                border: '2px solid rgba(239, 68, 68, 0.8)',
              }}
            >
              {/* Corner brackets */}
              <div className="absolute top-0 left-0 w-6 h-6 border-t-3 border-l-3 border-red-400 rounded-tl-md" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-3 border-r-3 border-red-400 rounded-tr-md" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-3 border-l-3 border-red-400 rounded-bl-md" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-3 border-r-3 border-red-400 rounded-br-md" />

              {/* Center crosshair */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                <div className="w-8 h-[2px] bg-red-500/70 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                <div className="h-8 w-[2px] bg-red-500/70 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>

              {/* Instruction label */}
              <div className="absolute -top-8 left-0 right-0 text-center">
                <span className="text-white text-xs bg-red-600/80 px-3 py-1 rounded-full font-medium">
                  Place the entire barcode inside the box
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Loading overlay — camera starting */}
        {isStarting && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
            <div className="h-10 w-10 border-3 border-white border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-white text-sm">Starting camera...</p>
          </div>
        )}

        {/* Cropped preview + Decode button */}
        {capturedImage && croppedPreview && !isProcessing && !detectedBarcode && !detectedNdNumber && !noBarcodeFound && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 px-6 py-4">
            <div className="w-full max-w-sm mb-4">
              <p className="text-white/70 text-sm text-center mb-3 font-medium">
                Verify the barcode is fully inside the scan area
              </p>
              <div className="border-2 border-white/30 rounded-lg overflow-hidden">
                <img src={croppedPreview} alt="Cropped barcode" className="w-full h-auto" />
              </div>
            </div>

            <div className="flex gap-3 w-full max-w-sm">
              <Button
                variant="outline"
                onClick={retry}
                className="flex-1 h-12 text-white border-white/30 hover:bg-white/10 gap-2"
              >
                <RotateCcw className="h-5 w-5" />
                Retake
              </Button>
              <Button
                onClick={startProcessing}
                className="flex-1 h-12 bg-white text-black hover:bg-white/90 gap-2 font-semibold"
              >
                <Check className="h-5 w-5" />
                Decode Barcode
              </Button>
            </div>
          </div>
        )}

        {/* Processing overlay */}
        {isProcessing && capturedImage && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70">
            <Loader2 className="h-10 w-10 text-white animate-spin mb-4" />
            <p className="text-white text-sm mb-2">{processingStep || 'Decoding barcode...'}</p>
            <div className="w-48 h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-red-500 rounded-full animate-pulse" style={{ width: '60%' }} />
            </div>
          </div>
        )}

        {/* ── DETECTED RESULT: barcode + ND number ── */}
        {(detectedBarcode || detectedNdNumber) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 px-6 py-4">
            {croppedPreview && (
              <div className="w-full max-w-xs mb-3">
                <p className="text-white/60 text-xs text-center mb-2">Scanned region:</p>
                <div className={`border-2 rounded-lg overflow-hidden ${
                  searchSource === 'barcode_decoded'
                    ? 'border-green-500/50'
                    : searchSource === 'nd_number'
                      ? 'border-blue-500/50'
                      : 'border-amber-500/50'
                }`}>
                  <img src={croppedPreview} alt="Scanned region" className="w-full h-auto" />
                </div>
              </div>
            )}

            <div className="w-full max-w-xs space-y-3 mb-6">
              {/* Detected Barcode */}
              {detectedBarcode && (
                <div className={`rounded-xl px-5 py-3 text-center ${
                  searchSource === 'barcode_decoded'
                    ? 'bg-green-900/40 border border-green-500/50'
                    : searchSource === 'barcode_ocr'
                      ? 'bg-amber-900/40 border border-amber-500/50'
                      : 'bg-white/5 border border-white/20'
                }`}>
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <p className={`text-xs font-medium ${
                      searchSource === 'barcode_decoded'
                        ? 'text-green-400'
                        : searchSource === 'barcode_ocr'
                          ? 'text-amber-400'
                          : 'text-white/50'
                    }`}>
                      Detected Barcode
                      {searchSource === 'barcode_decoded' ? '' : searchSource === 'barcode_ocr' ? ' (OCR)' : ''}
                    </p>
                    {searchSource === 'barcode_decoded' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-green-500/20 text-green-400">
                        High
                      </span>
                    )}
                    {searchSource === 'barcode_ocr' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-500/20 text-amber-400">
                        Low
                      </span>
                    )}
                    {(searchSource === 'barcode_decoded' || searchSource === 'barcode_ocr') && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-white/20 text-white animate-pulse">
                        → Search
                      </span>
                    )}
                    {searchSource === 'nd_number' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-white/10 text-white/40">
                        supplementary
                      </span>
                    )}
                  </div>
                  <p className="text-white text-2xl font-mono font-bold tracking-widest">{detectedBarcode}</p>
                </div>
              )}

              {/* Detected ND Number */}
              {detectedNdNumber && (
                <div className={`rounded-xl px-5 py-3 text-center ${
                  searchSource === 'nd_number'
                    ? 'bg-blue-900/40 border border-blue-500/50'
                    : 'bg-white/5 border border-white/20'
                }`}>
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <p className={`text-xs font-medium ${
                      searchSource === 'nd_number' ? 'text-blue-400' : 'text-white/50'
                    }`}>
                      Detected ND Number
                    </p>
                    {searchSource === 'nd_number' && (
                      <>
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-500/20 text-blue-400">
                          Medium
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-white/20 text-white animate-pulse">
                          → Search
                        </span>
                      </>
                    )}
                    {searchSource === 'barcode_decoded' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-white/10 text-white/40">
                        supplementary
                      </span>
                    )}
                  </div>
                  <p className="text-white text-xl font-mono font-bold tracking-wider">{detectedNdNumber}</p>
                </div>
              )}
            </div>

            {/* Search priority info */}
            {searchSource && (
              <p className="text-white/40 text-[10px] mb-4 text-center max-w-xs">
                Search priority: Barcode bars → ND Number → Barcode OCR
              </p>
            )}

            <div className="flex gap-3 w-full max-w-xs">
              <Button
                variant="outline"
                onClick={retry}
                className="flex-1 h-12 text-white border-white/30 hover:bg-white/10 gap-2"
              >
                <RotateCcw className="h-5 w-5" />
                Retake
              </Button>
              <Button
                onClick={confirmBarcode}
                className={`flex-1 h-12 gap-2 font-semibold ${
                  searchSource === 'barcode_decoded'
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : searchSource === 'nd_number'
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'bg-amber-600 hover:bg-amber-700 text-white'
                }`}
              >
                <Check className="h-5 w-5" />
                {searchSource === 'barcode_decoded'
                  ? 'Search by Barcode'
                  : searchSource === 'nd_number'
                    ? 'Search by ND Number'
                    : 'Search by Barcode (OCR)'
                }
              </Button>
            </div>
          </div>
        )}

        {/* No number found overlay */}
        {noBarcodeFound && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 px-6">
            {croppedPreview && (
              <div className="w-full max-w-xs mb-4">
                <p className="text-white/40 text-xs text-center mb-2">Scanned region:</p>
                <div className="border border-amber-500/30 rounded-lg overflow-hidden opacity-60">
                  <img src={croppedPreview} alt="Scanned region" className="w-full h-auto" />
                </div>
              </div>
            )}
            <div className="text-center mb-6">
              <AlertCircle className="h-10 w-10 text-amber-400 mx-auto mb-3" />
              <p className="text-amber-400 text-lg font-medium mb-2">No barcode detected</p>
              <p className="text-white/70 text-sm">Move closer and ensure the barcode fills most of the scan box.</p>
              <p className="text-white/50 text-xs mt-1">The barcode, barcode number, or ND number should be visible.</p>
            </div>
            <Button
              variant="outline"
              onClick={retry}
              className="text-white border-white/30 hover:bg-white/10 gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Try Again
            </Button>
          </div>
        )}

        {/* Error overlay */}
        {error && !noBarcodeFound && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 px-6">
            <div className="text-red-400 text-center mb-6">
              <p className="text-lg font-medium mb-2">Camera Error</p>
              <p className="text-sm">{error}</p>
            </div>
            <Button
              variant="outline"
              onClick={handleClose}
              className="text-white border-white/30 hover:bg-white/10"
            >
              Go Back
            </Button>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="flex items-center justify-center gap-4 px-4 py-4 bg-black/80">
        {torchSupported && !capturedImage && !isStarting && (
          <Button
            variant="outline"
            size="sm"
            onClick={toggleTorch}
            className={`h-11 px-4 gap-2 ${
              torchOn
                ? 'bg-yellow-500 text-black border-yellow-500 hover:bg-yellow-400'
                : 'text-white border-white/30 hover:bg-white/10'
            }`}
          >
            {torchOn ? <FlashlightOff className="h-5 w-5" /> : <Flashlight className="h-5 w-5" />}
            {torchOn ? 'Flash On' : 'Flash Off'}
          </Button>
        )}

        {!capturedImage && !error && !isStarting && (
          <Button
            size="lg"
            onClick={captureImage}
            className="h-14 px-8 gap-2 bg-white text-black hover:bg-white/90 font-semibold"
          >
            <Camera className="h-6 w-6" />
            Capture
          </Button>
        )}

        {!capturedImage && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleClose}
            className="text-white border-white/30 hover:bg-white/10 h-11 px-4"
          >
            Type Manually
          </Button>
        )}
      </div>

      {/* Instructions */}
      {!capturedImage && (
        <div className="text-center pb-6 px-4 bg-black/80">
          <p className="text-white/70 text-xs">
            Place the entire barcode inside the box, then press Capture.
          </p>
          <p className="text-white/40 text-[10px] mt-1">
            Supports EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39
          </p>
        </div>
      )}
    </div>
  );
}
