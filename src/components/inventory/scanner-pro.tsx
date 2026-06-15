'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { X, Flashlight, FlashlightOff, ZoomIn, ZoomOut } from 'lucide-react';

interface ScannerProProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
}

// Zoom levels available to the user
const ZOOM_LEVELS = [1, 2, 3, 4, 5];

/**
 * Scanner Pro — Same scanner engine as the working Scan feature,
 * with added camera zoom controls for reading small barcodes.
 *
 * Uses html5-qrcode with:
 * - Rear camera (facingMode: 'environment')
 * - Continuous autofocus
 * - Continuous scanning at 15 FPS
 * - Same instant barcode detection → onScan() → close → search
 *
 * Plus zoom controls:
 * - Zoom In / Zoom Out buttons
 * - Current zoom indicator (1x – 5x)
 * - Zoom applied directly to the camera stream via MediaStreamTrack constraints
 */
export function ScannerPro({ onScan, onClose }: ScannerProProps) {
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrCodeRef = useRef<any>(null);
  const [isStarting, setIsStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const hasScannedRef = useRef(false);

  // Zoom state
  const [zoomIndex, setZoomIndex] = useState(0); // index into ZOOM_LEVELS
  const [zoomSupported, setZoomSupported] = useState(false);
  const [zoomMin, setZoomMin] = useState(1);
  const [zoomMax, setZoomMax] = useState(5);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  // Start scanner on mount
  useEffect(() => {
    let cancelled = false;

    const startScanner = async () => {
      try {
        // Dynamic import to avoid SSR issues
        const { Html5Qrcode } = await import('html5-qrcode');

        if (cancelled || !scannerRef.current) return;

        const scannerId = 'scanner-pro-element';
        // Ensure the div has the correct id
        scannerRef.current.id = scannerId;

        const html5QrCode = new Html5Qrcode(scannerId);
        html5QrCodeRef.current = html5QrCode;

        await html5QrCode.start(
          { facingMode: 'environment' }, // Back camera
          {
            fps: 15,
            qrbox: { width: 280, height: 160 },
            aspectRatio: 1.0,
          },
          (decodedText: string) => {
            // Successful scan — only trigger once
            if (!hasScannedRef.current) {
              hasScannedRef.current = true;
              onScan(decodedText);
            }
          },
          () => {
            // Scan failure — ignore (continuous scanning)
          }
        );

        if (!cancelled) {
          setIsStarting(false);

          // Check torch support after camera is running
          try {
            const capabilities = html5QrCode.getRunningTrackCameraCapabilities?.();
            if (capabilities?.torchFeature?.()) {
              setTorchSupported(true);
            }
          } catch {
            // Torch not supported on this device
          }

          // Check zoom support and get the underlying MediaStreamTrack
          try {
            const videoEl = document.querySelector('#scanner-pro-element video') as HTMLVideoElement;
            if (videoEl && videoEl.srcObject) {
              const stream = videoEl.srcObject as MediaStream;
              const track = stream.getVideoTracks()[0];
              if (track) {
                trackRef.current = track;
                const capabilities = track.getCapabilities?.() as any;
                if (capabilities?.zoom) {
                  setZoomSupported(true);
                  setZoomMin(capabilities.zoom.min ?? 1);
                  setZoomMax(capabilities.zoom.max ?? 5);
                  // Start at 1x
                  setZoomIndex(0);
                }
              }
            }
          } catch {
            // Zoom not supported on this device
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error('Scanner Pro error:', err);
          if (err?.toString?.().includes('Permission')) {
            setError('Camera permission denied. Please allow camera access and try again.');
          } else if (err?.toString?.().includes('NotFound') || err?.toString?.().includes('Requested device not found')) {
            setError('No camera found. Please connect a camera and try again.');
          } else {
            setError(`Could not start camera: ${err?.message || err?.toString() || 'Unknown error'}`);
          }
          setIsStarting(false);
        }
      }
    };

    startScanner();

    // Cleanup on unmount
    return () => {
      cancelled = true;
      if (html5QrCodeRef.current) {
        html5QrCodeRef.current
          .stop()
          .then(() => {
            html5QrCodeRef.current?.clear();
          })
          .catch(() => {
            // Ignore stop errors during cleanup
          });
      }
    };
  }, [onScan]);

  // Toggle flashlight/torch
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
      console.error('Torch toggle error:', err);
    }
  }, [torchOn]);

  // Apply zoom to the camera track
  const applyZoom = useCallback(async (newZoomIndex: number) => {
    const clampedIndex = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, newZoomIndex));
    const targetZoom = ZOOM_LEVELS[clampedIndex];

    // Clamp to device-supported range
    const safeZoom = Math.max(zoomMin, Math.min(zoomMax, targetZoom));

    if (trackRef.current && zoomSupported) {
      try {
        await trackRef.current.applyConstraints({
          advanced: [{ zoom: safeZoom }],
        } as any);
        setZoomIndex(clampedIndex);
      } catch (err) {
        console.warn('Zoom apply failed:', err);
        // Some devices reject zoom values they don't support
      }
    }
  }, [zoomSupported, zoomMin, zoomMax]);

  const zoomIn = useCallback(() => {
    applyZoom(zoomIndex + 1);
  }, [zoomIndex, applyZoom]);

  const zoomOut = useCallback(() => {
    applyZoom(zoomIndex - 1);
  }, [zoomIndex, applyZoom]);

  const currentZoom = ZOOM_LEVELS[zoomIndex];
  const canZoomIn = zoomIndex < ZOOM_LEVELS.length - 1 && zoomSupported;
  const canZoomOut = zoomIndex > 0 && zoomSupported;

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 text-white z-10">
        <h2 className="text-lg font-semibold">Scanner Pro</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="text-white hover:bg-white/20 h-9 w-9 p-0"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Scanner viewport */}
      <div className="flex-1 relative flex items-center justify-center">
        {/* Scanner container — this is where the camera feed renders */}
        <div
          ref={scannerRef}
          className="w-full h-full"
          style={{ minHeight: '300px' }}
        />

        {/* Scanning overlay — crosshair guide */}
        {!error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-[280px] h-[160px]">
              {/* Corner markers */}
              <div className="absolute top-0 left-0 w-8 h-8 border-t-3 border-l-3 border-white rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-3 border-r-3 border-white rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-3 border-l-3 border-white rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-3 border-r-3 border-white rounded-br-lg" />
              {/* Center line */}
              <div className="absolute top-1/2 left-4 right-4 h-0.5 bg-red-500/70" />
            </div>
          </div>
        )}

        {/* Loading overlay */}
        {isStarting && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
            <div className="h-10 w-10 border-3 border-white border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-white text-sm">Starting camera...</p>
          </div>
        )}

        {/* Error overlay */}
        {error && (
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
      <div className="flex flex-col items-center gap-3 px-4 py-4 bg-black/80">
        {/* Zoom controls */}
        {zoomSupported && !isStarting && (
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={zoomOut}
              disabled={!canZoomOut}
              className="h-11 w-11 p-0 text-white border-white/30 hover:bg-white/10 disabled:opacity-30"
            >
              <ZoomOut className="h-5 w-5" />
            </Button>

            {/* Zoom level indicator */}
            <div className="flex items-center gap-1.5 min-w-[120px] justify-center">
              {ZOOM_LEVELS.map((level, idx) => (
                <button
                  key={level}
                  onClick={() => applyZoom(idx)}
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                    idx === zoomIndex
                      ? 'bg-white text-black scale-110 shadow-lg shadow-white/30'
                      : idx <= zoomIndex
                        ? 'bg-white/30 text-white'
                        : 'bg-white/10 text-white/40'
                  }`}
                >
                  {level}x
                </button>
              ))}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={zoomIn}
              disabled={!canZoomIn}
              className="h-11 w-11 p-0 text-white border-white/30 hover:bg-white/10 disabled:opacity-30"
            >
              <ZoomIn className="h-5 w-5" />
            </Button>
          </div>
        )}

        {/* Zoom not supported hint */}
        {!zoomSupported && !isStarting && !error && (
          <p className="text-white/40 text-xs">Zoom not supported on this device</p>
        )}

        {/* Other controls row */}
        <div className="flex items-center justify-center gap-4">
          {/* Flashlight toggle */}
          {torchSupported && (
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

          {/* Manual entry fallback */}
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="text-white border-white/30 hover:bg-white/10 h-11 px-4"
          >
            Type Manually
          </Button>
        </div>
      </div>

      {/* Instructions */}
      <div className="text-center pb-6 px-4 bg-black/80">
        <p className="text-white/70 text-xs">
          Point your camera at a barcode. Use zoom for small labels.
        </p>
        <p className="text-white/40 text-[10px] mt-1">
          Supported: EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39
        </p>
      </div>
    </div>
  );
}
