/**
 * Capture quality checks for a POD photograph (TRK-031).
 *
 * Extraction accuracy has a ceiling set by image quality, so a blurred or
 * half-dark photograph is worth catching at the warehouse gate, where the
 * driver can simply take another one — not three weeks later when a packet
 * comes back rejected.
 *
 * Everything here is a pure function over pixel data. No canvas, no DOM, no
 * `Image`: the browser hands in the pixels it already decoded, which keeps
 * every threshold testable in the unit runner without a headless browser, and
 * keeps the whole file free of anything that would pull weight into the 150 KB
 * driver budget (TRK-030).
 *
 * These checks advise. They never block: the driver can always override, and
 * a blurry POD beats no POD.
 */

/** Decoded pixels, in the RGBA layout a canvas returns. */
export type Bitmap = {
  width: number;
  height: number;
  /** Length must be `width * height * 4`. */
  data: Uint8ClampedArray;
};

export type QualityCheckId =
  "RESOLUTION" | "BLUR" | "BRIGHTNESS" | "DOCUMENT_COVERAGE";

export type QualityCheck = {
  id: QualityCheckId;
  passed: boolean;
  /** The measured value, kept so thresholds can be retuned against real data. */
  value: number;
  /** What the driver is told. Empty when the check passed. */
  message: string;
};

export type QualityReport = {
  /** 0–100. Not a probability — a comparable number for TRK-044 correlation. */
  score: number;
  checks: QualityCheck[];
  /** Checks that failed, worst first. */
  failures: QualityCheck[];
};

/**
 * Thresholds, deliberately in one place.
 *
 * They are first guesses against synthetic fixtures, not values earned from
 * real PODs — the golden set that would earn them is TRK-044, gated on a
 * data-use agreement. Retune them there, against the correlation report, not
 * by eye.
 */
export const QUALITY_THRESHOLDS = {
  /** Below roughly this, `nomor surat jalan` stops being legible at all. */
  minimumPixels: 1_000_000,
  minimumEdge: 640,
  /** Variance of the Laplacian. Lower is blurrier. */
  minimumSharpness: 100,
  /** Mean luma, 0–255. A carbon copy photographed in a dark bay lands here. */
  minimumBrightness: 45,
  maximumBrightness: 235,
  /**
   * Share of the frame carrying document-like edge activity.
   *
   * Calibrated against the synthetic fixtures: a printed page filling the
   * frame measures around 0.069, and the same page reduced to a patch in a
   * wide shot measures 0.011. Sitting between them at roughly three times
   * margin either way separates the two without punishing a sparse page —
   * printed text only produces edges at glyph boundaries, so even a good
   * capture is mostly blank paper.
   */
  minimumCoverage: 0.03,
} as const;

const MESSAGES: Record<QualityCheckId, string> = {
  RESOLUTION: "Foto terlalu kecil. Coba foto lagi lebih dekat.",
  BLUR: "Foto buram. Tahan HP lebih stabil, lalu coba lagi.",
  BRIGHTNESS: "Cahaya kurang bagus. Cari tempat lebih terang, lalu coba lagi.",
  DOCUMENT_COVERAGE:
    "Dokumen kurang terlihat penuh. Pastikan seluruh surat jalan masuk dalam foto.",
};

/**
 * Luma, at the coefficients the eye actually weights colour by.
 *
 * Averaging the channels instead would call a saturated blue as bright as a
 * white page, and a POD photographed under a loading-bay lamp is exactly where
 * that goes wrong.
 */
export function toGrayscale(bitmap: Bitmap): Uint8ClampedArray {
  const { width, height, data } = bitmap;
  const gray = new Uint8ClampedArray(width * height);

  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? 0;
    const b = data[offset + 2] ?? 0;

    gray[index] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  return gray;
}

/**
 * Variance of the Laplacian: the standard sharpness measure.
 *
 * The Laplacian responds to second-order intensity change, which is what an
 * edge is. A sharp photograph has many strong responses and therefore a wide
 * spread; blur smears the same edges into gradients and collapses the
 * variance. It is the spread that matters, not the mean — a uniformly bright
 * image and a uniformly dark one both average to nearly zero response.
 */
export function varianceOfLaplacian(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  if (width < 3 || height < 3) {
    return 0;
  }

  let sum = 0;
  let sumOfSquares = 0;
  let count = 0;

  // The border is skipped rather than padded: a padded edge invents a
  // discontinuity that reads as detail, which would make a blurry photograph
  // score better simply for being large.
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const response =
        -4 * (gray[index] ?? 0) +
        (gray[index - 1] ?? 0) +
        (gray[index + 1] ?? 0) +
        (gray[index - width] ?? 0) +
        (gray[index + width] ?? 0);

      sum += response;
      sumOfSquares += response * response;
      count += 1;
    }
  }

  if (count === 0) {
    return 0;
  }

  const mean = sum / count;

  return sumOfSquares / count - mean * mean;
}

export function meanBrightness(gray: Uint8ClampedArray): number {
  if (gray.length === 0) {
    return 0;
  }

  let total = 0;

  for (const luma of gray) {
    total += luma;
  }

  return total / gray.length;
}

/**
 * How much of the frame carries document-like edge activity.
 *
 * Deliberately not contour detection. Finding the quadrilateral of a page
 * properly means Canny plus a Hough transform, which is both heavy enough to
 * threaten the driver payload budget and unreliable on a `surat jalan` lying
 * on a pallet among other paper. What actually needs catching is cruder: the
 * driver photographed the floor, or the document is a small patch in the
 * corner of a wide shot. A gradient-density measure answers that.
 */
export function documentCoverage(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  if (width < 2 || height < 2) {
    return 0;
  }

  // A step this size is invisible on a flat surface and unmissable at the
  // boundary between print and paper.
  const EDGE_THRESHOLD = 24;
  let active = 0;
  let total = 0;

  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const index = y * width + x;
      const here = gray[index] ?? 0;
      const right = gray[index + 1] ?? 0;
      const below = gray[index + width] ?? 0;

      const gradient = Math.abs(here - right) + Math.abs(here - below);

      if (gradient >= EDGE_THRESHOLD) {
        active += 1;
      }

      total += 1;
    }
  }

  return total === 0 ? 0 : active / total;
}

/** Maps a measurement onto 0–1 by how far past its threshold it reached. */
function ratio(value: number, threshold: number): number {
  if (threshold <= 0) {
    return 1;
  }

  return Math.max(0, Math.min(1, value / threshold));
}

function brightnessRatio(brightness: number): number {
  const { minimumBrightness, maximumBrightness } = QUALITY_THRESHOLDS;

  if (brightness < minimumBrightness) {
    return ratio(brightness, minimumBrightness);
  }

  if (brightness > maximumBrightness) {
    // Symmetric at the bright end: a blown-out photograph of a white page is
    // as unreadable as a dark one, and fails for the same reason.
    return ratio(255 - brightness, 255 - maximumBrightness);
  }

  return 1;
}

/**
 * Runs every check and scores the photograph.
 *
 * The score is the mean of the per-check ratios, so one catastrophic failure
 * cannot hide behind three passes — a pitch-black photograph at high
 * resolution still scores badly.
 */
export function evaluateCaptureQuality(
  bitmap: Bitmap,
  /**
   * The photograph's real dimensions, when `bitmap` is a downsample of it.
   *
   * Sharpness and brightness survive downsampling; the resolution floor does
   * not, and judging a 12 MP photograph by the 1024px copy we measured would
   * fail every capture. The caller measures small and reports true.
   */
  reported?: { width: number; height: number },
): QualityReport {
  const { width, height } = bitmap;
  const gray = toGrayscale(bitmap);

  const reportedWidth = reported?.width ?? width;
  const reportedHeight = reported?.height ?? height;
  const pixels = reportedWidth * reportedHeight;
  const sharpness = varianceOfLaplacian(gray, width, height);
  const brightness = meanBrightness(gray);
  const coverage = documentCoverage(gray, width, height);

  const resolutionOk =
    pixels >= QUALITY_THRESHOLDS.minimumPixels &&
    Math.min(reportedWidth, reportedHeight) >= QUALITY_THRESHOLDS.minimumEdge;

  const measurements: Array<{
    id: QualityCheckId;
    passed: boolean;
    value: number;
    ratio: number;
  }> = [
    {
      id: "RESOLUTION",
      passed: resolutionOk,
      value: pixels,
      ratio: ratio(pixels, QUALITY_THRESHOLDS.minimumPixels),
    },
    {
      id: "BLUR",
      passed: sharpness >= QUALITY_THRESHOLDS.minimumSharpness,
      value: sharpness,
      ratio: ratio(sharpness, QUALITY_THRESHOLDS.minimumSharpness),
    },
    {
      id: "BRIGHTNESS",
      passed:
        brightness >= QUALITY_THRESHOLDS.minimumBrightness &&
        brightness <= QUALITY_THRESHOLDS.maximumBrightness,
      value: brightness,
      ratio: brightnessRatio(brightness),
    },
    {
      id: "DOCUMENT_COVERAGE",
      passed: coverage >= QUALITY_THRESHOLDS.minimumCoverage,
      value: coverage,
      ratio: ratio(coverage, QUALITY_THRESHOLDS.minimumCoverage),
    },
  ];

  const checks: QualityCheck[] = measurements.map(({ id, passed, value }) => ({
    id,
    passed,
    value,
    message: passed ? "" : MESSAGES[id],
  }));

  const score = Math.round(
    (measurements.reduce((total, m) => total + m.ratio, 0) /
      measurements.length) *
      100,
  );

  const failures = checks
    .filter((check) => !check.passed)
    .sort((a, b) => a.value - b.value);

  return { score, checks, failures };
}
