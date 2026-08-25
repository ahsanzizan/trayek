import { evaluateCaptureQuality, type QualityReport } from "~/lib/pod-quality";

/**
 * Decodes a photograph and measures it (TRK-031).
 *
 * The only part of the quality guard that touches the browser. It exists to
 * hand `evaluateCaptureQuality` a plain pixel buffer, which is what keeps the
 * arithmetic in `~/lib/pod-quality` free of the DOM and testable without one.
 *
 * The original `File` is never touched. Pixels are read into a canvas for
 * measurement and the canvas is discarded — nothing is re-encoded, and the
 * bytes that reach storage are the bytes the camera produced. That matters
 * beyond fidelity: TRK-061 reads EXIF off the original for fraud forensics,
 * and a canvas round-trip strips it.
 */

/**
 * Long edge to measure at. The analysis is O(pixels) and runs on a cheap
 * Android phone, so a 12 MP photograph is downsampled first. Sharpness and
 * brightness survive the reduction; measuring the full frame would cost
 * seconds of a driver's time to reach the same verdict.
 *
 * Only the measurement is downsampled. The upload is not.
 */
const MEASURE_LONG_EDGE = 1024;

function scaledSize(width: number, height: number) {
  const longEdge = Math.max(width, height);

  if (longEdge <= MEASURE_LONG_EDGE) {
    return { width, height };
  }

  const scale = MEASURE_LONG_EDGE / longEdge;

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Measures a photograph, or returns null when the browser cannot decode it.
 *
 * Null is a real outcome, not an error: an unmeasurable photograph must still
 * be uploadable, because refusing it would turn an advisory check into a gate.
 */
export async function measurePhoto(file: File): Promise<QualityReport | null> {
  let bitmap: ImageBitmap | null = null;

  try {
    bitmap = await createImageBitmap(file);

    const { width, height } = scaledSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (!context) {
      return null;
    }

    context.drawImage(bitmap, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);

    // Measured small, reported true: the driver's photograph is what has to
    // clear the resolution floor, not the copy we measured it from.
    return evaluateCaptureQuality(
      { width, height, data: imageData.data },
      { width: bitmap.width, height: bitmap.height },
    );
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}
