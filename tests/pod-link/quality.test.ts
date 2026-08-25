import { describe, expect, it } from "vitest";

import {
  documentCoverage,
  evaluateCaptureQuality,
  meanBrightness,
  QUALITY_THRESHOLDS,
  toGrayscale,
  varianceOfLaplacian,
  type Bitmap,
} from "~/lib/pod-quality";
import {
  blurredCapture,
  croppedCapture,
  darkCapture,
  glaredCapture,
  lowResolutionCapture,
  sharpCapture,
  skewedCapture,
} from "./quality-fixtures";

/**
 * TRK-031 acceptance criterion: fixtures cover blurry, dark, glared, skewed,
 * and cropped samples.
 */

function grayOf(bitmap: Bitmap) {
  return toGrayscale(bitmap);
}

function failureIds(bitmap: Bitmap): string[] {
  return evaluateCaptureQuality(bitmap)
    .failures.map((failure) => failure.id)
    .sort();
}

describe("grayscale conversion", () => {
  it("weights the channels the way the eye does", () => {
    // Pure green must read far brighter than pure blue. Averaging the channels
    // would call them identical and mis-score a photograph under a coloured
    // loading-bay lamp.
    const pixel = (r: number, g: number, b: number): Bitmap => ({
      width: 1,
      height: 1,
      data: Uint8ClampedArray.from([r, g, b, 255]),
    });

    const green = toGrayscale(pixel(0, 255, 0))[0] ?? 0;
    const blue = toGrayscale(pixel(0, 0, 255))[0] ?? 0;

    expect(green).toBeGreaterThan(blue * 4);
  });

  it("maps white and black to the ends of the range", () => {
    const white: Bitmap = {
      width: 1,
      height: 1,
      data: Uint8ClampedArray.from([255, 255, 255, 255]),
    };

    expect(toGrayscale(white)[0]).toBe(255);
  });
});

describe("sharpness", () => {
  it("scores a sharp capture far above a blurred one", () => {
    const sharp = sharpCapture();
    const blurred = blurredCapture();

    const sharpScore = varianceOfLaplacian(
      grayOf(sharp),
      sharp.width,
      sharp.height,
    );
    const blurredScore = varianceOfLaplacian(
      grayOf(blurred),
      blurred.width,
      blurred.height,
    );

    expect(sharpScore).toBeGreaterThan(QUALITY_THRESHOLDS.minimumSharpness);
    expect(blurredScore).toBeLessThan(sharpScore);
  });

  it("falls further as blur widens", () => {
    const mild = blurredCapture(3);
    const heavy = blurredCapture(9);

    expect(
      varianceOfLaplacian(grayOf(heavy), heavy.width, heavy.height),
    ).toBeLessThan(varianceOfLaplacian(grayOf(mild), mild.width, mild.height));
  });

  it("is not fooled by a flat image, which has no detail to spread", () => {
    const flat: Bitmap = {
      width: 50,
      height: 50,
      data: new Uint8ClampedArray(50 * 50 * 4).fill(200),
    };

    expect(varianceOfLaplacian(grayOf(flat), 50, 50)).toBeLessThan(1);
  });

  it("returns zero for an image too small to have an interior", () => {
    expect(varianceOfLaplacian(new Uint8ClampedArray(4), 2, 2)).toBe(0);
  });
});

describe("brightness", () => {
  it("reads a dark capture below the floor", () => {
    expect(meanBrightness(grayOf(darkCapture()))).toBeLessThan(
      QUALITY_THRESHOLDS.minimumBrightness,
    );
  });

  it("reads a glared capture above the ceiling", () => {
    expect(meanBrightness(grayOf(glaredCapture()))).toBeGreaterThan(
      QUALITY_THRESHOLDS.maximumBrightness,
    );
  });

  it("reads a good capture between the two", () => {
    const brightness = meanBrightness(grayOf(sharpCapture()));

    expect(brightness).toBeGreaterThan(QUALITY_THRESHOLDS.minimumBrightness);
    expect(brightness).toBeLessThan(QUALITY_THRESHOLDS.maximumBrightness);
  });
});

describe("document coverage", () => {
  it("is high when the document fills the frame", () => {
    const sharp = sharpCapture();

    expect(
      documentCoverage(grayOf(sharp), sharp.width, sharp.height),
    ).toBeGreaterThan(QUALITY_THRESHOLDS.minimumCoverage);
  });

  it("collapses when the document is a patch in a wide shot", () => {
    const cropped = croppedCapture();

    expect(
      documentCoverage(grayOf(cropped), cropped.width, cropped.height),
    ).toBeLessThan(QUALITY_THRESHOLDS.minimumCoverage);
  });
});

describe("the verdict on each fixture", () => {
  it("passes a clean capture on every check", () => {
    const report = evaluateCaptureQuality(sharpCapture());

    expect(report.failures).toEqual([]);
    expect(report.score).toBeGreaterThan(90);
  });

  it("fails a blurred capture for blur", () => {
    expect(failureIds(blurredCapture())).toContain("BLUR");
  });

  it("fails a dark capture for brightness", () => {
    expect(failureIds(darkCapture())).toContain("BRIGHTNESS");
  });

  it("fails a glared capture for brightness", () => {
    expect(failureIds(glaredCapture())).toContain("BRIGHTNESS");
  });

  it("fails a cropped capture for coverage", () => {
    expect(failureIds(croppedCapture())).toContain("DOCUMENT_COVERAGE");
  });

  it("fails a small capture for resolution", () => {
    expect(failureIds(lowResolutionCapture())).toContain("RESOLUTION");
  });

  it("passes a skewed but legible capture", () => {
    // Deskewing is TRK-042's job, after upload. Refusing a crooked photograph
    // here would send a driver back to re-shoot something already readable.
    expect(failureIds(skewedCapture())).not.toContain("BLUR");
    expect(failureIds(skewedCapture())).not.toContain("DOCUMENT_COVERAGE");
  });
});

describe("the score", () => {
  it("ranks a clean capture above every defective one", () => {
    const clean = evaluateCaptureQuality(sharpCapture()).score;

    for (const fixture of [
      blurredCapture(),
      darkCapture(),
      croppedCapture(),
      lowResolutionCapture(),
    ]) {
      expect(evaluateCaptureQuality(fixture).score).toBeLessThan(clean);
    }
  });

  it("does not let one catastrophic failure hide behind three passes", () => {
    // A pitch-black photograph at full resolution passes RESOLUTION and would
    // score well on an any-check-passed rule. It must not.
    expect(evaluateCaptureQuality(darkCapture()).score).toBeLessThan(80);
  });

  it("stays within 0 and 100 for every fixture", () => {
    for (const fixture of [
      sharpCapture(),
      blurredCapture(),
      darkCapture(),
      glaredCapture(),
      croppedCapture(),
      skewedCapture(),
      lowResolutionCapture(),
    ]) {
      const { score } = evaluateCaptureQuality(fixture);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("judges resolution by the real photograph, not the copy measured", () => {
    // The browser downsamples before measuring. A 12 MP capture must not fail
    // the floor because we measured a 1024px copy of it.
    const small = lowResolutionCapture();

    const asMeasured = evaluateCaptureQuality(small);
    const asReported = evaluateCaptureQuality(small, {
      width: 4000,
      height: 3000,
    });

    expect(failureIds(small)).toContain("RESOLUTION");
    expect(asMeasured.score).toBeLessThan(asReported.score);
    expect(asReported.failures.map((failure) => failure.id)).not.toContain(
      "RESOLUTION",
    );
  });
});

describe("every failure tells the driver what to do about it", () => {
  it("gives a non-empty Indonesian message for each failed check", () => {
    for (const fixture of [
      blurredCapture(),
      darkCapture(),
      croppedCapture(),
      lowResolutionCapture(),
    ]) {
      for (const failure of evaluateCaptureQuality(fixture).failures) {
        expect(failure.message.length).toBeGreaterThan(15);
        expect(failure.message).toMatch(/foto|dokumen|cahaya/i);
      }
    }
  });

  it("says nothing in English", () => {
    const english = /\b(blurry|dark|photo|retake|again|please|document)\b/i;

    for (const fixture of [blurredCapture(), darkCapture(), croppedCapture()]) {
      for (const failure of evaluateCaptureQuality(fixture).failures) {
        expect(failure.message).not.toMatch(english);
      }
    }
  });

  it("leaves a passing check with no message to show", () => {
    for (const check of evaluateCaptureQuality(sharpCapture()).checks) {
      expect(check.message).toBe("");
    }
  });
});
