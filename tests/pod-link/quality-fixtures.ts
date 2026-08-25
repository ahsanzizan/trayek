import { type Bitmap } from "~/lib/pod-quality";

/**
 * Synthetic capture fixtures for the quality guard (TRK-031).
 *
 * Generated rather than photographed, deliberately. A real POD carries a
 * signature and a company stamp, which is personal data under UU PDP — putting
 * real captures in the repository would be a compliance problem, not merely an
 * awkward binary blob. Real-photograph validation belongs with the TRK-044
 * golden set, which has a data-use agreement precisely because of this.
 *
 * Generated fixtures also make the thresholds honest: each one has a known
 * defect of a known magnitude, so a test can say *why* it should fail rather
 * than pinning whatever number today's code happens to produce.
 */

const DEFAULT_WIDTH = 1400;
const DEFAULT_HEIGHT = 1000;

type Painter = (x: number, y: number) => number;

function render(
  paint: Painter,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const luma = paint(x, y);
      const offset = (y * width + x) * 4;

      data[offset] = luma;
      data[offset + 1] = luma;
      data[offset + 2] = luma;
      data[offset + 3] = 255;
    }
  }

  return { width, height, data };
}

/**
 * Stands in for printed text: hard-edged dark bars on a light page, which is
 * what the Laplacian actually responds to on a `surat jalan`.
 */
function printedPage(x: number, y: number): number {
  const inMargin = x < 80 || x > DEFAULT_WIDTH - 80 || y < 60;

  if (inMargin) {
    return 236;
  }

  const lineHeight = 28;
  const isTextRow = y % lineHeight < 11;
  const isInk = isTextRow && (x + Math.floor(y / lineHeight) * 13) % 17 < 9;

  return isInk ? 26 : 236;
}

/** A clean, well-lit, in-focus capture. Every check should pass. */
export function sharpCapture(): Bitmap {
  return render(printedPage);
}

/**
 * Blurred by a box average over the sharp page.
 *
 * A real out-of-focus photograph is a convolution, so blurring the same source
 * is what makes the comparison meaningful: brightness and resolution are held
 * constant and only the sharpness moves.
 */
export function blurredCapture(radius = 6): Bitmap {
  const sharp = sharpCapture();
  const { width, height } = sharp;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      let count = 0;

      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const sx = x + dx;
          const sy = y + dy;

          if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
            continue;
          }

          total += sharp.data[(sy * width + sx) * 4] ?? 0;
          count += 1;
        }
      }

      const luma = count === 0 ? 0 : total / count;
      const offset = (y * width + x) * 4;

      data[offset] = luma;
      data[offset + 1] = luma;
      data[offset + 2] = luma;
      data[offset + 3] = 255;
    }
  }

  return { width, height, data };
}

/** Photographed in an unlit loading bay: correct focus, far too dark. */
export function darkCapture(): Bitmap {
  return render((x, y) => printedPage(x, y) * 0.11);
}

/** Direct sun or flash on a white page: detail washed out at the top end. */
export function glaredCapture(): Bitmap {
  return render((x, y) => 244 + (printedPage(x, y) > 128 ? 8 : 2));
}

/**
 * The document is a small patch in a wide shot of the pallet — the failure
 * `DOCUMENT_COVERAGE` exists to catch.
 */
export function croppedCapture(): Bitmap {
  const patchWidth = DEFAULT_WIDTH / 6;
  const patchHeight = DEFAULT_HEIGHT / 6;

  return render((x, y) => {
    const inPatch = x < patchWidth && y < patchHeight;

    // Flat concrete everywhere else: plausible, and carrying no edges.
    return inPatch ? printedPage(x * 6, y * 6) : 150;
  });
}

/**
 * Skewed by a horizontal shear, as a POD photographed at an angle would be.
 *
 * Sharpness survives a shear, so this one is expected to *pass*: it is here to
 * prove the guard does not punish a legible photograph merely for being
 * crooked. Deskewing is TRK-042's job, on the server, after upload.
 */
export function skewedCapture(): Bitmap {
  return render((x, y) => {
    const shifted = x + Math.round((y / DEFAULT_HEIGHT) * 160);

    return printedPage(Math.min(shifted, DEFAULT_WIDTH - 1), y);
  });
}

/** Below the resolution floor: in focus and well lit, simply too small. */
export function lowResolutionCapture(): Bitmap {
  return render((x, y) => printedPage(x * 4, y * 4), 400, 300);
}
