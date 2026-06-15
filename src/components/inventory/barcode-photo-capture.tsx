'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { X, Flashlight, FlashlightOff, Camera, RotateCcw, Loader2, Check, AlertCircle } from 'lucide-react';

interface BarcodePhotoCaptureProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
}

// ── Scan zone constants ──
const CROP_HEIGHT_PCT = 0.18;
const SCAN_ZONE_WIDTH_PCT = 0.85;

/**
 * Extract ALL digits from OCR text and join them into one continuous number.
 *
 * The scan area is treated as a barcode-number capture zone.
 * All detected digits are merged regardless of spacing, line breaks,
 * or formatting gaps.
 *
 * Examples:
 *   "1020 0000 1249"  →  "102000001249"
 *   "1020    00001249" →  "102000001249"
 *   "1 0200 0001 249"  →  "102000001249"
 *   "1020\n0000\n1249" →  "102000001249"
 */
function extractNumberFromOcr(text: string): string | null {
  console.log('[BarcodeCapture] extractNumberFromOcr raw input:', JSON.stringify(text));

  // Strip everything that is not a digit — spaces, line breaks, letters, symbols
  const allDigits = text.replace(/[^0-9]/g, '');

  console.log('[BarcodeCapture] All digits joined:', allDigits, `(length: ${allDigits.length})`);

  // Need at least 4 digits to be meaningful
  if (allDigits.length < 4) {
    console.log('[BarcodeCapture] Too few digits (<4), rejecting');
    return null;
  }

  // Return the full continuous digit string
  // The scan zone is a barcode capture zone — all digits belong together
  return allDigits;
}

/**
 * Pre-process a canvas for better OCR: greyscale + contrast + binarize.
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
    const grey = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const final = grey > threshold ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = final;
  }
  ctx.putImageData(imageData, 0, 0);

  return out;
}

/**
 * Scale up a small canvas for better OCR accuracy.
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
 * Detection flow (optimised for printed numbers, not barcode lines):
 * 1. OCR on cropped scan region (multiple configs)
 * 2. OCR on full image (wider search)
 * 3. OCR with image enhancement (contrast boost + scale up)
 * 4. Barcode line detection as last resort
 * 5. Show detected number with Confirm/Retake
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
  const [processingStep, setProcessingStep] = useState<string>('');

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

  // ── Crop the scan zone from a full canvas ──
  const cropScanZone = useCallback((fullCanvas: HTMLCanvasElement): HTMLCanvasElement => {
    const imgW = fullCanvas.width;
    const imgH = fullCanvas.height;

    const bandHeight = Math.round(imgH * CROP_HEIGHT_PCT);
    const bandTop = Math.round(imgH * 0.5 - bandHeight / 2);
    const bandWidth = Math.round(imgW * SCAN_ZONE_WIDTH_PCT);
    const bandLeft = Math.round((imgW - bandWidth) / 2);

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = bandWidth;
    cropCanvas.height = bandHeight;
    const ctx = cropCanvas.getContext('2d')!;
    ctx.drawImage(fullCanvas, bandLeft, bandTop, bandWidth, bandHeight, 0, 0, bandWidth, bandHeight);

    console.log('[BarcodeCapture] Crop region:', {
      original: `${imgW}x${imgH}`,
      cropRegion: `left=${bandLeft} top=${bandTop} w=${bandWidth} h=${bandHeight}`,
      cropped: `${bandWidth}x${bandHeight}`,
    });

    return cropCanvas;
  }, []);

  // ── Run OCR with different configs and return best number found ──
  const runOcrWithConfigs = useCallback(async (canvas: HTMLCanvasElement, label: string): Promise<string | null> => {
    console.log(`[BarcodeCapture] Running OCR on: ${label} (${canvas.width}x${canvas.height})`);

    try {
      const Tesseract = await import('tesseract.js');

      // Try multiple PSM modes (page segmentation modes)
      const configs = [
        { psm: '7', desc: 'single uniform text line' },
        { psm: '6', desc: 'uniform block of text' },
        { psm: '13', desc: 'raw line (no OSD)' },
        { psm: '8', desc: 'single word' },
        { psm: '3', desc: 'fully automatic' },
      ];

      let bestResult: string | null = null;

      for (const config of configs) {
        try {
          const worker = await Tesseract.createWorker('eng', 1);

          await worker.setParameters({
            tessedit_pageseg_mode: config.psm,
            // No whitelist — let Tesseract see all characters, we filter after
          });

          const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
          const { data } = await worker.recognize(dataUrl);
          await worker.terminate();

          const ocrText = data.text || '';
          console.log(`[BarcodeCapture] OCR PSM=${config.psm} (${config.desc}):`, JSON.stringify(ocrText));

          const extracted = extractNumberFromOcr(ocrText);
          if (extracted) {
            console.log(`[BarcodeCapture] PSM=${config.psm} extracted:`, extracted);
            if (!bestResult || extracted.length > bestResult.length) {
              bestResult = extracted;
            }
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

  // ── Capture + Process ──
  const captureAndProcess = useCallback(async () => {
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
    setIsProcessing(true);
    setNoBarcodeFound(false);
    setDetectedBarcode(null);
    setCroppedPreview(null);

    console.log('[BarcodeCapture] Original image size:', `${fullCanvas.width}x${fullCanvas.height}`);

    // ── Step 1: OCR on cropped scan region (primary — these are printed numbers) ──
    setProcessingStep('Reading numbers from scan area...');
    const croppedCanvas = cropScanZone(fullCanvas);
    const croppedDataUrl = croppedCanvas.toDataURL('image/jpeg', 0.92);
    setCroppedPreview(croppedDataUrl);

    console.log('[BarcodeCapture] Cropped image size:', `${croppedCanvas.width}x${croppedCanvas.height}`);

    let ocrResult: string | null = await runOcrWithConfigs(croppedCanvas, 'cropped region');

    // ── Step 2: OCR on full image (in case the number is outside the crop) ──
    if (!ocrResult) {
      setProcessingStep('Scanning full image...');
      ocrResult = await runOcrWithConfigs(fullCanvas, 'full image');
    }

    // ── Step 3: OCR on enhanced + scaled-up cropped region ──
    if (!ocrResult) {
      setProcessingStep('Enhancing image and retrying...');
      console.log('[BarcodeCapture] Trying enhanced + scaled OCR');

      const scaled = scaleCanvas(croppedCanvas, 2);
      const enhanced = preprocessCanvas(scaled, 120);
      ocrResult = await runOcrWithConfigs(enhanced, 'enhanced + scaled cropped');
    }

    // ── Step 4: OCR on enhanced + scaled full image ──
    if (!ocrResult) {
      setProcessingStep('Trying enhanced full image...');
      const scaledFull = scaleCanvas(fullCanvas, 2);
      const enhancedFull = preprocessCanvas(scaledFull, 130);
      ocrResult = await runOcrWithConfigs(enhancedFull, 'enhanced + scaled full');
    }

    // ── Step 5: Barcode line detection as last resort ──
    let barcodeResult: string | null = null;
    if (!ocrResult) {
      setProcessingStep('Trying barcode line detection...');
      try {
        const { Html5Qrcode } = await import('html5-qrcode');

        // Try cropped first
        const blob = await new Promise<Blob | null>((resolve) => {
          croppedCanvas.toBlob(resolve, 'image/jpeg', 0.92);
        });
        if (blob) {
          const scanner = new Html5Qrcode('barcode-photo-scan-element');
          try {
            const file = new File([blob], 'cropped.jpg', { type: 'image/jpeg' });
            const result = await scanner.scanFileV2(file, false);
            barcodeResult = result.decodedText;
            console.log('[BarcodeCapture] Barcode line detection (cropped):', barcodeResult);
          } catch {
            console.log('[BarcodeCapture] Barcode line detection failed on cropped');
          } finally {
            try { scanner.clear(); } catch {}
          }
        }

        // Try full image
        if (!barcodeResult) {
          const fullBlob = await new Promise<Blob | null>((resolve) => {
            fullCanvas.toBlob(resolve, 'image/jpeg', 0.92);
          });
          if (fullBlob) {
            const scanner2 = new Html5Qrcode('barcode-photo-scan-element-2');
            try {
              const fullFile = new File([fullBlob], 'full.jpg', { type: 'image/jpeg' });
              const result = await scanner2.scanFileV2(fullFile, false);
              barcodeResult = result.decodedText;
              console.log('[BarcodeCapture] Barcode line detection (full):', barcodeResult);
            } catch {
              console.log('[BarcodeCapture] Barcode line detection failed on full');
            } finally {
              try { scanner2.clear(); } catch {}
            }
          }
        }
      } catch (err) {
        console.error('[BarcodeCapture] Barcode library error:', err);
      }
    }

    // ── Final result ──
    const finalBarcode = ocrResult || barcodeResult;

    console.log('[BarcodeCapture] ── Results summary ──');
    console.log('[BarcodeCapture]   OCR result:', ocrResult || '(none)');
    console.log('[BarcodeCapture]   Barcode line detection:', barcodeResult || '(none)');
    console.log('[BarcodeCapture]   Final selected:', finalBarcode || '(none)');

    setIsProcessing(false);
    setProcessingStep('');

    if (finalBarcode) {
      setDetectedBarcode(finalBarcode);
    } else {
      setNoBarcodeFound(true);
    }
  }, [onScan, cropScanZone, runOcrWithConfigs]);

  // ── Confirm detected barcode → search ──
  const confirmBarcode = useCallback(() => {
    if (!detectedBarcode) return;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    onScan(detectedBarcode);
  }, [detectedBarcode, onScan]);

  // ── Retry ──
  const retry = useCallback(() => {
    setCapturedImage(null);
    setNoBarcodeFound(false);
    setIsProcessing(false);
    setCroppedPreview(null);
    setDetectedBarcode(null);
    setProcessingStep('');

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
          {detectedBarcode
            ? 'Number Detected'
            : capturedImage
              ? isProcessing
                ? processingStep || 'Processing...'
                : noBarcodeFound
                  ? 'No Number Found'
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

        {/* Captured image (frozen frame) */}
        {capturedImage && !detectedBarcode && !noBarcodeFound && (
          <img
            src={capturedImage}
            alt="Captured barcode"
            className="w-full h-full object-contain"
          />
        )}

        {/* ── RED SCAN LINE OVERLAY (camera live) ── */}
        {!capturedImage && !error && !isStarting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div
              className="relative border-2 border-red-500/80 rounded-lg"
              style={{
                width: `${SCAN_ZONE_WIDTH_PCT * 100}%`,
                height: `${CROP_HEIGHT_PCT * 100}%`,
              }}
            >
              <div className="absolute top-0 left-0 w-5 h-5 border-t-3 border-l-3 border-red-400 rounded-tl-md" />
              <div className="absolute top-0 right-0 w-5 h-5 border-t-3 border-r-3 border-red-400 rounded-tr-md" />
              <div className="absolute bottom-0 left-0 w-5 h-5 border-b-3 border-l-3 border-red-400 rounded-bl-md" />
              <div className="absolute bottom-0 right-0 w-5 h-5 border-b-3 border-r-3 border-red-400 rounded-br-md" />

              <div className="absolute top-1/2 left-2 right-2 h-[3px] bg-red-500 -translate-y-1/2 shadow-[0_0_8px_rgba(239,68,68,0.6)]" />

              <div className="absolute -top-7 left-0 right-0 text-center">
                <span className="text-white text-xs bg-red-600/80 px-3 py-1 rounded-full font-medium">
                  Align number here
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

        {/* Processing overlay */}
        {isProcessing && capturedImage && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70">
            <Loader2 className="h-10 w-10 text-white animate-spin mb-4" />
            <p className="text-white text-sm mb-2">{processingStep || 'Extracting number...'}</p>
            <div className="w-48 h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-red-500 rounded-full animate-pulse" style={{ width: '60%' }} />
            </div>
          </div>
        )}

        {/* ── DETECTED NUMBER: cropped preview + confirm/retake ── */}
        {detectedBarcode && croppedPreview && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 px-6 py-4">
            <div className="w-full max-w-xs mb-4">
              <p className="text-white/60 text-xs text-center mb-2">Scanned region:</p>
              <div className="border-2 border-green-500/50 rounded-lg overflow-hidden">
                <img src={croppedPreview} alt="Scanned region" className="w-full h-auto" />
              </div>
            </div>

            <div className="bg-green-900/40 border border-green-500/50 rounded-xl px-6 py-4 mb-6 text-center">
              <p className="text-green-400 text-xs mb-1">Detected Number</p>
              <p className="text-white text-2xl font-mono font-bold tracking-widest">{detectedBarcode}</p>
            </div>

            <div className="flex gap-3 w-full max-w-xs">
              <Button
                variant="outline"
                onClick={retry}
                className="flex-1 h-12 text-white border-white/30 hover:bg-white/10 gap-2"
              >
                <RotateCcw className="h-5 w-5" />
                Retake Photo
              </Button>
              <Button
                onClick={confirmBarcode}
                className="flex-1 h-12 bg-green-600 hover:bg-green-700 text-white gap-2"
              >
                <Check className="h-5 w-5" />
                Search Product
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
              <p className="text-amber-400 text-lg font-medium mb-2">No number detected</p>
              <p className="text-white/70 text-sm">Align the product number so it crosses the red line and try again.</p>
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
            onClick={captureAndProcess}
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
            Align the product number so it crosses the red line, then press Capture.
          </p>
          <p className="text-white/40 text-[10px] mt-1">
            Works with printed numbers, product codes, and barcode lines
          </p>
        </div>
      )}
    </div>
  );
}
