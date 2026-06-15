'use client';

// ── BarcodeDetector type declarations (browser API, not yet in default TS DOM lib) ──
interface BarcodeDetector {
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

interface DetectedBarcode {
  format: string;
  rawValue: string;
  boundingBox: DOMRectReadOnly;
  cornerPoints: { x: number; y: number }[];
}

declare const BarcodeDetector: {
  prototype: BarcodeDetector;
  new (options?: { formats?: string[] }): BarcodeDetector;
  getSupportedFormats(): Promise<string[]>;
};

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

// Preferred barcode formats commonly found on products
const PREFERRED_BARCODE_FORMATS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
];

// ── Scan zone constants ──
// Rectangular scan box — tall enough to capture entire barcode including quiet zones
const SCAN_BOX_WIDTH_PCT = 0.85;
const SCAN_BOX_HEIGHT_PCT = 0.28;

/**
 * Text patterns to IGNORE from OCR output.
 * These are common label noise that should not be treated as barcode or ND data.
 */
const IGNORE_PATTERNS = [
  /made\s*in\s*china/i,
  /made\s*in\s*\w+/i,
  /china/i,
  /product\s*of/i,
];

/**
 * Extract barcode digits and ND number from OCR text.
 *
 * Label structure example:
 *   ND-5271
 *   [BARCODE IMAGE]
 *   6901957183343
 *   MADE IN CHINA
 *
 * Extraction logic:
 *   1. Find ND number: pattern "ND-XXXX" or "ND XXXX" (letters + digits with separator)
 *   2. Find barcode digits: longest continuous digit sequence (8-14 digits)
 *   3. Filter out noise like "MADE IN CHINA"
 *
 * Normalization:
 *   "6901 9571 8334 3" → "6901957183343"
 *   "ND - 5271" → "ND-5271"
 */
function extractFromOcr(text: string): OcrExtractionResult {
  console.log('[BarcodeCapture] extractFromOcr raw input:', JSON.stringify(text));

  const result: OcrExtractionResult = { barcodeDigits: null, ndNumber: null };

  // Split into lines for line-by-line analysis
  const lines = text
    .split(/[\n\r]+/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  console.log('[BarcodeCapture] OCR lines:', lines);

  // ── Step 1: Extract ND Number ──
  // Match patterns: ND-5271, ND - 5271, ND 5271, nd-5271, etc.
  const ndRegex = /(?:ND|nd|Nd|nD)\s*[-–—]?\s*(\d{3,6})/g;
  for (const line of lines) {
    // Skip noise lines
    if (IGNORE_PATTERNS.some(p => p.test(line))) continue;

    const ndMatch = ndRegex.exec(line);
    if (ndMatch) {
      const digits = ndMatch[1];
      result.ndNumber = `ND-${digits}`;
      console.log('[BarcodeCapture] Found ND Number:', result.ndNumber, 'from line:', line);
      break;
    }
  }
  // Also try full-text match if line-by-line didn't find it
  if (!result.ndNumber) {
    const fullMatch = ndRegex.exec(text);
    if (fullMatch) {
      result.ndNumber = `ND-${fullMatch[1]}`;
      console.log('[BarcodeCapture] Found ND Number (full text):', result.ndNumber);
    }
  }

  // ── Step 2: Extract barcode digits ──
  // Strategy: find the longest digit-only sequence of 8-14 digits from a single line.
  // This is likely the barcode number printed below the barcode image.
  // We also check all digits combined across lines as a fallback.

  let bestDigitLine: string | null = null;
  let bestDigitLen = 0;

  for (const line of lines) {
    // Skip noise lines
    if (IGNORE_PATTERNS.some(p => p.test(line))) continue;
    // Skip ND number lines (they contain letters)
    if (/^(?:ND|nd|Nd|nD)/i.test(line)) continue;

    // Extract digits from this line, removing spaces/dashes
    const digitsOnly = line.replace(/[^0-9]/g, '');
    if (digitsOnly.length >= 8 && digitsOnly.length <= 14 && digitsOnly.length > bestDigitLen) {
      bestDigitLine = digitsOnly;
      bestDigitLen = digitsOnly.length;
      console.log('[BarcodeCapture] Candidate barcode line:', line, '→ digits:', digitsOnly);
    }
  }

  if (bestDigitLine) {
    result.barcodeDigits = bestDigitLine;
  } else {
    // Fallback: join ALL digits from the entire text
    const allDigits = text.replace(/[^0-9]/g, '');
    if (allDigits.length >= 8 && allDigits.length <= 20) {
      result.barcodeDigits = allDigits;
      console.log('[BarcodeCapture] Barcode digits (fallback all joined):', allDigits);
    } else if (allDigits.length >= 4) {
      // Last resort: accept shorter sequences
      result.barcodeDigits = allDigits;
      console.log('[BarcodeCapture] Short digit sequence (last resort):', allDigits);
    }
  }

  console.log('[BarcodeCapture] Extraction result:', result);
  return result;
}

/**
 * Pre-process a canvas: greyscale → contrast boost → binarize.
 * Used before both barcode decoding and OCR to improve accuracy.
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
    // Convert to greyscale
    let grey = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

    // Boost contrast: stretch around midpoint 128
    grey = Math.min(255, Math.max(0, (grey - 128) * 1.5 + 128));

    // Binarize
    const final = grey > threshold ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = final;
  }
  ctx.putImageData(imageData, 0, 0);

  return out;
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
  ctx.imageSmoothingEnabled = false; // Keep sharp pixels
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);
  return out;
}

/**
 * Barcode photo capture component.
 *
 * Workflow:
 * 1. Live camera with rectangular scan box overlay
 * 2. User captures photo → show cropped barcode preview for verification
 * 3. Pre-process: crop scan box → scale 2x–4x → greyscale → contrast boost → binarize
 * 4. Barcode decoding first (native BarcodeDetector + html5-qrcode)
 * 5. OCR fallback only if barcode decoding fails
 * 6. Show result with confidence (High=barcode, Low=OCR) + Search/Retake
 */
export function BarcodePhotoCapture({ onScan, onClose }: BarcodePhotoCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  const [isStarting, setIsStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [noBarcodeFound, setNoBarcodeFound] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  const [croppedPreview, setCroppedPreview] = useState<string | null>(null);
  const [detectedBarcode, setDetectedBarcode] = useState<string | null>(null);
  const [detectedNdNumber, setDetectedNdNumber] = useState<string | null>(null);
  const [detectionConfidence, setDetectionConfidence] = useState<DetectionConfidence | null>(null);
  const [searchSource, setSearchSource] = useState<SearchSource | null>(null);
  const [processingStep, setProcessingStep] = useState<string>('');
  const [showPreview, setShowPreview] = useState(false); // show cropped barcode before decoding

  // ── Start camera on mount ──
  useEffect(() => {
    let cancelled = false;

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
        const videoTrack = stream.getVideoTracks()[0];
        trackRef.current = videoTrack;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        try {
          const capabilities = videoTrack.getCapabilities?.();
          if (capabilities?.torch) setTorchSupported(true);
        } catch {}

        try {
          const capabilities = videoTrack.getCapabilities?.();
          if (capabilities?.focusMode?.includes('continuous')) {
            await videoTrack.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] });
          } else if (capabilities?.focusMode?.includes('auto')) {
            await videoTrack.applyConstraints({ advanced: [{ focusMode: 'auto' } as any] });
          }
        } catch {}

        if (!cancelled) setIsStarting(false);
      } catch (err: any) {
        if (!cancelled) {
          console.error('Camera start error:', err);
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
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // ── Toggle flashlight/torch ──
  const toggleTorch = useCallback(async () => {
    if (!trackRef.current) return;
    try {
      const capabilities = trackRef.current.getCapabilities?.();
      if (capabilities?.torch) {
        const newState = !torchOn;
        await trackRef.current.applyConstraints({ advanced: [{ torch: newState } as any] });
        setTorchOn(newState);
      }
    } catch (err) {
      console.error('Torch toggle error:', err);
    }
  }, [torchOn]);

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

    console.log('[BarcodeCapture] Crop region:', {
      original: `${imgW}x${imgH}`,
      cropRegion: `left=${boxLeft} top=${boxTop} w=${boxWidth} h=${boxHeight}`,
      cropped: `${boxWidth}x${boxHeight}`,
    });

    return cropCanvas;
  }, []);

  // ── Run OCR with different configs and return best extraction result ──
  const runOcrWithConfigs = useCallback(async (canvas: HTMLCanvasElement, label: string): Promise<OcrExtractionResult | null> => {
    console.log(`[BarcodeCapture] Running OCR on: ${label} (${canvas.width}x${canvas.height})`);

    try {
      const Tesseract = await import('tesseract.js');

      // Try multiple PSM modes (page segmentation modes)
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

          await worker.setParameters({
            tessedit_pageseg_mode: config.psm,
          });

          const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
          const { data } = await worker.recognize(dataUrl);
          await worker.terminate();

          const ocrText = data.text || '';
          console.log(`[BarcodeCapture] OCR PSM=${config.psm} (${config.desc}):`, JSON.stringify(ocrText));

          const extracted = extractFromOcr(ocrText);
          // Score: ND number gets strong bonus (more reliable than OCR barcode digits)
          // We want the OCR config that finds ND number, even if it misses some barcode digits
          const score = (extracted.barcodeDigits ? extracted.barcodeDigits.length : 0)
                     + (extracted.ndNumber ? 20 : 0);

          if (score > bestScore) {
            bestResult = extracted;
            bestScore = score;
            console.log(`[BarcodeCapture] PSM=${config.psm} new best (score=${score}):`, extracted);
          }
        } catch (err) {
          console.log(`[BarcodeCapture] PSM=${config.psm} failed:`, err);
        }
      }

      return bestResult;
    } catch (err) {
      console.error('[BarcodeCapture] OCR error:', err);
      return null;
    }
  }, []);

  // ── Try barcode decoding via native BarcodeDetector API ──
  const tryBarcodeDetector = useCallback(async (
    canvas: HTMLCanvasElement,
    label: string,
  ): Promise<string | null> => {
    // Check if BarcodeDetector is available
    if (typeof BarcodeDetector === 'undefined') {
      console.log('[BarcodeCapture] BarcodeDetector API not available');
      return null;
    }

    try {
      // Build format list from supported formats, preferring our target formats
      const supportedFormats = await BarcodeDetector.getSupportedFormats();
      const preferredSupported = PREFERRED_BARCODE_FORMATS.filter(
        f => supportedFormats.includes(f as any)
      );
      const formatsToUse = preferredSupported.length > 0
        ? preferredSupported
        : supportedFormats.slice(0, 8); // fallback to whatever is supported

      if (formatsToUse.length === 0) {
        console.log('[BarcodeCapture] No supported barcode formats found');
        return null;
      }

      console.log(`[BarcodeCapture] BarcodeDetector formats:`, formatsToUse);

      const detector = new BarcodeDetector({ formats: formatsToUse as any[] });

      // Convert canvas to ImageBitmap for detection
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/png');
      });
      if (!blob) return null;

      const imageBitmap = await createImageBitmap(blob);
      const results = await detector.detect(imageBitmap);

      if (results.length > 0) {
        // Prefer results from preferred formats
        const preferredResult = results.find(r =>
          PREFERRED_BARCODE_FORMATS.includes(r.format as any)
        );
        const chosen = preferredResult || results[0];
        console.log(`[BarcodeCapture] BarcodeDetector (${label}): format=${chosen.format} value=${chosen.rawValue}`);
        return chosen.rawValue;
      }

      console.log(`[BarcodeCapture] BarcodeDetector (${label}): no barcodes found`);
      return null;
    } catch (err) {
      console.log(`[BarcodeCapture] BarcodeDetector error (${label}):`, err);
      return null;
    }
  }, []);

  // ── Try barcode decoding via html5-qrcode ──
  const tryHtml5Qrcode = useCallback(async (
    canvas: HTMLCanvasElement,
    label: string,
    elementId: string,
  ): Promise<string | null> => {
    try {
      const { Html5Qrcode } = await import('html5-qrcode');

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', 0.92);
      });
      if (!blob) return null;

      const scanner = new Html5Qrcode(elementId);
      try {
        const file = new File([blob], `${label}.jpg`, { type: 'image/jpeg' });
        const result = await scanner.scanFileV2(file, false);
        console.log(`[BarcodeCapture] html5-qrcode (${label}):`, result.decodedText);
        return result.decodedText;
      } catch {
        console.log(`[BarcodeCapture] html5-qrcode failed (${label})`);
        return null;
      } finally {
        try { scanner.clear(); } catch {}
      }
    } catch (err) {
      console.error('[BarcodeCapture] html5-qrcode library error:', err);
      return null;
    }
  }, []);

  // ── Capture only (freeze frame + show preview) ──
  const captureImage = useCallback(() => {
    const video = videoRef.current;
    const fullCanvas = canvasRef.current;
    if (!video || !fullCanvas) return;

    video.pause();

    fullCanvas.width = video.videoWidth;
    fullCanvas.height = video.videoHeight;
    const ctx = fullCanvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, fullCanvas.width, fullCanvas.height);

    const fullDataUrl = fullCanvas.toDataURL('image/jpeg', 0.92);
    setCapturedImage(fullDataUrl);

    // Crop the scan box and show preview
    const croppedCanvas = cropScanBox(fullCanvas);
    const croppedDataUrl = croppedCanvas.toDataURL('image/jpeg', 0.92);
    setCroppedPreview(croppedDataUrl);

    // Show the cropped preview so user can verify barcode is inside
    setShowPreview(true);
    setNoBarcodeFound(false);
    setDetectedBarcode(null);
    setDetectedNdNumber(null);
    setDetectionConfidence(null);
    setSearchSource(null);
  }, [cropScanBox]);

  // ── Start processing after user verifies the preview ──
  const startProcessing = useCallback(async () => {
    const fullCanvas = canvasRef.current;
    if (!fullCanvas) return;

    setShowPreview(false);
    setIsProcessing(true);
    setNoBarcodeFound(false);
    setDetectedBarcode(null);
    setDetectedNdNumber(null);
    setDetectionConfidence(null);
    setSearchSource(null);

    console.log('[BarcodeCapture] Original image size:', `${fullCanvas.width}x${fullCanvas.height}`);

    // ── Crop the scan box ──
    const croppedCanvas = cropScanBox(fullCanvas);
    console.log('[BarcodeCapture] Cropped image size:', `${croppedCanvas.width}x${croppedCanvas.height}`);

    // ── Pre-process: scale up → greyscale → contrast → binarize ──
    const targetWidth = 800;
    const autoScale = Math.max(2, Math.min(4, Math.ceil(targetWidth / croppedCanvas.width)));
    console.log(`[BarcodeCapture] Auto-scaling cropped region ${autoScale}x`);

    const scaledCanvas = scaleCanvas(croppedCanvas, autoScale);
    const enhancedCanvas = preprocessCanvas(scaledCanvas, 120);

    // ══════════════════════════════════════════════════════════
    // PHASE 1: BARCODE DECODING (High Confidence)
    // ══════════════════════════════════════════════════════════
    let barcodeResult: string | null = null;

    setProcessingStep('Decoding barcode...');
    barcodeResult = await tryBarcodeDetector(enhancedCanvas, 'enhanced cropped');

    if (!barcodeResult) {
      setProcessingStep('Trying raw crop...');
      barcodeResult = await tryBarcodeDetector(croppedCanvas, 'cropped');
    }

    if (!barcodeResult) {
      setProcessingStep('Decoding from full image...');
      barcodeResult = await tryBarcodeDetector(fullCanvas, 'full');
    }

    if (!barcodeResult) {
      setProcessingStep('Trying alternative decoder...');
      barcodeResult = await tryHtml5Qrcode(enhancedCanvas, 'enhanced cropped', 'barcode-photo-scan-element');
    }

    if (!barcodeResult) {
      setProcessingStep('Trying decoder on raw crop...');
      barcodeResult = await tryHtml5Qrcode(croppedCanvas, 'cropped', 'barcode-photo-scan-element');
    }

    if (!barcodeResult) {
      setProcessingStep('Trying decoder on full image...');
      barcodeResult = await tryHtml5Qrcode(fullCanvas, 'full', 'barcode-photo-scan-element-2');
    }

    // If barcode decoded, still run OCR briefly on the raw crop to try to get ND number
    // (ND number is never encoded in the barcode bars — it's always printed text)
    let ocrNdNumber: string | null = null;
    if (barcodeResult) {
      console.log('[BarcodeCapture] Barcode decoded, also trying OCR for ND number...');
      setProcessingStep('Checking for ND number...');
      const quickOcr = await runOcrWithConfigs(croppedCanvas, 'ND number extraction');
      if (quickOcr?.ndNumber) {
        ocrNdNumber = quickOcr.ndNumber;
      }
    }

    if (barcodeResult) {
      console.log('[BarcodeCapture] ── Results summary ──');
      console.log('[BarcodeCapture]   Barcode decoded:', barcodeResult);
      console.log('[BarcodeCapture]   ND Number:', ocrNdNumber || '(none)');
      console.log('[BarcodeCapture]   Confidence: High');

      setIsProcessing(false);
      setProcessingStep('');
      setDetectedBarcode(barcodeResult);
      setDetectedNdNumber(ocrNdNumber);
      setDetectionConfidence('High');
      setSearchSource('barcode_decoded');
      return;
    }

    // ══════════════════════════════════════════════════════════
    // PHASE 2: OCR FALLBACK (Low Confidence)
    // ══════════════════════════════════════════════════════════
    console.log('[BarcodeCapture] Barcode decoding failed, falling back to OCR...');

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
    // Priority: ND number > barcode digits OCR
    // ND number is larger, clearer, and more reliable than OCR of 13-digit barcode string
    const finalNdNumber = ocrResult?.ndNumber || null;
    const finalBarcode = ocrResult?.barcodeDigits || null;

    setIsProcessing(false);
    setProcessingStep('');

    if (finalNdNumber) {
      // ND number is the primary search value (more reliable than OCR barcode digits)
      setDetectedNdNumber(finalNdNumber);
      setDetectedBarcode(finalBarcode);
      setDetectionConfidence('Medium');
      setSearchSource('nd_number');
      console.log('[BarcodeCapture] ── Results summary ──');
      console.log('[BarcodeCapture]   ND Number:', finalNdNumber);
      console.log('[BarcodeCapture]   Barcode (OCR):', finalBarcode || '(none)');
      console.log('[BarcodeCapture]   Search by: ND Number (priority over OCR barcode)');
    } else if (finalBarcode) {
      // Last resort: OCR barcode digits only
      setDetectedBarcode(finalBarcode);
      setDetectionConfidence('Low');
      setSearchSource('barcode_ocr');
      console.log('[BarcodeCapture] ── Results summary ──');
      console.log('[BarcodeCapture]   Barcode (OCR):', finalBarcode);
      console.log('[BarcodeCapture]   Search by: Barcode OCR (last resort)');
    } else {
      setNoBarcodeFound(true);
    }
  }, [cropScanBox, runOcrWithConfigs, tryBarcodeDetector, tryHtml5Qrcode]);

  // ── Confirm detected value → search (priority: decoded barcode → ND number → OCR barcode) ──
  const confirmBarcode = useCallback(() => {
    if (!detectedBarcode && !detectedNdNumber) return;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    // Search priority: decoded barcode → ND number → OCR barcode digits
    if (searchSource === 'nd_number') {
      // Search by ND number first, barcode digits as fallback
      onScan(detectedNdNumber || '', detectedBarcode || undefined);
    } else {
      // Search by barcode (decoded or OCR)
      onScan(detectedBarcode || '', detectedNdNumber || undefined);
    }
  }, [detectedBarcode, detectedNdNumber, searchSource, onScan]);

  // ── Retry ──
  const retry = useCallback(() => {
    setCapturedImage(null);
    setNoBarcodeFound(false);
    setIsProcessing(false);
    setCroppedPreview(null);
    setDetectedBarcode(null);
    setDetectedNdNumber(null);
    setDetectionConfidence(null);
    setSearchSource(null);
    setProcessingStep('');
    setShowPreview(false);

    if (videoRef.current && streamRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* Hidden elements for html5-qrcode scanFileV2 */}
      <div id="barcode-photo-scan-element" style={{ display: 'none' }} />
      <div id="barcode-photo-scan-element-2" style={{ display: 'none' }} />

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
          onClick={onClose}
          className="text-white hover:bg-white/20 h-9 w-9 p-0"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Camera / Captured image viewport */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        {/* Live camera feed */}
        {!capturedImage && (
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            playsInline
            muted
            autoPlay
          />
        )}

        {/* Captured image (frozen frame) — shown during processing, not during preview or result */}
        {capturedImage && !showPreview && !detectedBarcode && !detectedNdNumber && !noBarcodeFound && (
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

        {/* ── PREVIEW: cropped barcode image before decoding ── */}
        {showPreview && croppedPreview && !isProcessing && (
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

        {/* ── DETECTED RESULT: barcode + ND number + search source indicator ── */}
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
                      : 'bg-white/5 border border-white/20' // supplementary, not used for search
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
              onClick={onClose}
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
            onClick={onClose}
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
            Supports Code128, Code39, EAN-13, EAN-8, UPC-A, UPC-E
          </p>
        </div>
      )}
    </div>
  );
}
