'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { X, Flashlight, FlashlightOff } from 'lucide-react';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
}

/**
 * Full-screen barcode scanner component.
 * Opens the device camera, scans barcodes, and calls onScan with the result.
 *
 * Supported formats (via html5-qrcode):
 * EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, and more.
 */
export function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrCodeRef = useRef<any>(null);
  const [isStarting, setIsStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const hasScannedRef = useRef(false);

  // Start scanner on mount
  useEffect(() => {
    let cancelled = false;

    const startScanner = async () => {
      try {
        // Dynamic import to avoid SSR issues
        const { Html5Qrcode } = await import('html5-qrcode');

        if (cancelled || !scannerRef.current) return;

        const scannerId = 'barcode-scanner-element';
        // Ensure the div has the correct id
        scannerRef.current.id = scannerId;

        const html5QrCode = new Html5Qrcode(scannerId);
        html5QrCodeRef.current = html5QrCode;

        // Check if torch is supported
        const devices = await Html5Qrcode.getCameras();
        if (devices && devices.length > 0) {
          // We'll check torch support after starting the camera
        }

        await html5QrCode.start(
          { facingMode: 'environment' }, // Back camera
          {
            fps: 15,
            qrbox: { width: 280, height: 160 },
            aspectRatio: 1.0,
            // Disable beep by providing empty string or using a data URL
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
            const track = html5QrCode.getRunningTrackCameraCapabilities?.();
            if (track?.torchFeature?.()) {
              setTorchSupported(true);
            }
          } catch {
            // Torch not supported on this device
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error('Scanner error:', err);
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

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 text-white z-10">
        <h2 className="text-lg font-semibold">Scan Barcode</h2>
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
      <div className="flex items-center justify-center gap-4 px-4 py-4 bg-black/80">
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

      {/* Instructions */}
      <div className="text-center pb-6 px-4 bg-black/80">
        <p className="text-white/70 text-xs">
          Point your camera at a barcode. Supported: EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39
        </p>
      </div>
    </div>
  );
}
