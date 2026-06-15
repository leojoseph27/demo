'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { X, Flashlight, FlashlightOff, Camera, RotateCcw, Loader2 } from 'lucide-react';

interface BarcodePhotoCaptureProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
}

/**
 * Barcode photo capture component.
 * Opens the device camera in a preview window, lets the user capture a photo,
 * then automatically extracts the barcode from the captured image using
 * html5-qrcode's scanFileV2 method.
 *
 * This is designed for situations where the live barcode scanner cannot focus
 * properly — the user can take a still photo and the system will attempt to
 * extract the barcode from it.
 *
 * Workflow:
 * 1. Open camera preview (rear camera, autofocus, torch toggle)
 * 2. User clicks Capture → image freezes
 * 3. Automatically process image → extract barcode via scanFileV2
 * 4. If found: populate search + auto-search
 * 5. If not found: show "No barcode detected. Please try again."
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

        // Check torch support
        try {
          const capabilities = videoTrack.getCapabilities?.();
          if (capabilities?.torch) {
            setTorchSupported(true);
          }
        } catch {
          // Torch not supported
        }

        // Try to apply continuous autofocus if supported
        try {
          const capabilities = videoTrack.getCapabilities?.();
          if (capabilities?.focusMode?.includes('continuous')) {
            await videoTrack.applyConstraints({
              advanced: [{ focusMode: 'continuous' } as any],
            });
          } else if (capabilities?.focusMode?.includes('auto')) {
            await videoTrack.applyConstraints({
              advanced: [{ focusMode: 'auto' } as any],
            });
          }
        } catch {
          // Focus mode not supported
        }

        if (!cancelled) {
          setIsStarting(false);
        }
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
        await trackRef.current.applyConstraints({
          advanced: [{ torch: newState } as any],
        });
        setTorchOn(newState);
      }
    } catch (err) {
      console.error('Torch toggle error:', err);
    }
  }, [torchOn]);

  // ── Capture + Process in one flow ──
  const captureAndProcess = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    // Freeze video
    video.pause();

    // Draw frame to canvas
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Get data URL for display
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    setCapturedImage(dataUrl);
    setIsProcessing(true);
    setNoBarcodeFound(false);

    // Convert canvas to blob for barcode scanning
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.92);
    });

    if (!blob) {
      setIsProcessing(false);
      setNoBarcodeFound(true);
      return;
    }

    const file = new File([blob], 'capture.jpg', { type: 'image/jpeg' });

    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const scanner = new Html5Qrcode('barcode-photo-scan-element');

      try {
        const result = await scanner.scanFileV2(file, false);
        const decodedText = result.decodedText;

        if (decodedText) {
          // Barcode found — stop camera and callback
          if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
          }
          onScan(decodedText);
          return;
        }
      } catch (scanErr: any) {
        // scanFileV2 throws when no barcode is found — this is expected
        console.log('No barcode detected in captured image:', scanErr?.message || scanErr);
      } finally {
        try { scanner.clear(); } catch {}
      }
    } catch (err: any) {
      console.error('Barcode processing error:', err);
    }

    // No barcode found
    setIsProcessing(false);
    setNoBarcodeFound(true);
  }, [onScan]);

  // ── Retry: go back to live camera ──
  const retry = useCallback(() => {
    setCapturedImage(null);
    setNoBarcodeFound(false);
    setIsProcessing(false);

    // Resume video
    if (videoRef.current && streamRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* Hidden element for html5-qrcode scanFileV2 */}
      <div id="barcode-photo-scan-element" style={{ display: 'none' }} />

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 text-white z-10">
        <h2 className="text-lg font-semibold">
          {capturedImage
            ? isProcessing
              ? 'Processing...'
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

        {/* Captured image (frozen frame) */}
        {capturedImage && (
          <img
            src={capturedImage}
            alt="Captured barcode"
            className="w-full h-full object-contain"
          />
        )}

        {/* Scanning overlay — guide when camera is live */}
        {!capturedImage && !error && !isStarting && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-[280px] h-[160px]">
              {/* Corner markers */}
              <div className="absolute top-0 left-0 w-8 h-8 border-t-3 border-l-3 border-white rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-3 border-r-3 border-white rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-3 border-l-3 border-white rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-3 border-r-3 border-white rounded-br-lg" />
              {/* Center hint */}
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-white/60 text-xs bg-black/30 px-2 py-1 rounded">
                  Point at barcode &amp; capture
                </p>
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

        {/* Processing overlay — extracting barcode */}
        {isProcessing && capturedImage && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
            <Loader2 className="h-10 w-10 text-white animate-spin mb-4" />
            <p className="text-white text-sm">Extracting barcode...</p>
          </div>
        )}

        {/* No barcode found overlay */}
        {noBarcodeFound && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 px-6">
            <div className="text-center mb-6">
              <p className="text-amber-400 text-lg font-medium mb-2">No barcode detected</p>
              <p className="text-white/70 text-sm">Please try again with a clearer view of the barcode.</p>
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
        {/* Flashlight toggle (only when camera is live) */}
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

        {/* Capture button (when camera is live) */}
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

        {/* Try Again button (after no barcode found) */}
        {noBarcodeFound && (
          <Button
            variant="outline"
            onClick={retry}
            className="text-white border-white/30 hover:bg-white/10 gap-2 h-11"
          >
            <RotateCcw className="h-5 w-5" />
            Try Again
          </Button>
        )}

        {/* Manual entry fallback (only when camera is live) */}
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
            Point your camera at a barcode and press Capture. Supported: EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39
          </p>
        </div>
      )}
    </div>
  );
}
