/**
 * Capture attestation: where and when the driver photographed the POD
 * (TRK-032).
 *
 * Captured independently of EXIF. WhatsApp strips EXIF from forwarded images,
 * and a browser upload can lose it regardless, so the location the fraud
 * checks in TRK-062 read has to be collected here rather than recovered from
 * the file later.
 *
 * Nothing here blocks. A driver who refuses the prompt, or whose phone cannot
 * get a fix inside a warehouse, uploads exactly as before — the absence is
 * recorded as an absence, never as an obstacle.
 */

export type GeolocationPermission = "GRANTED" | "DENIED" | "UNAVAILABLE";

export type CaptureAttestation = {
  permission: GeolocationPermission;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  /** The client's own clock, ISO-8601. Kept even when no fix was obtained. */
  capturedAt: string;
};

/**
 * A loading bay is a bad place to ask for a GPS fix, and a driver holding a
 * phone at a gate will not wait. Twelve seconds is long enough for a warm
 * fix and short enough that the screen never feels stuck; past it the upload
 * proceeds with no location, which is a perfectly good outcome.
 */
const FIX_TIMEOUT_MS = 12_000;

/**
 * Maps a browser geolocation failure onto what we record.
 *
 * Pure, and separated from the request so the mapping is testable without a
 * browser. The distinction that matters is refusal versus inability: only the
 * first says anything about the driver, and even then it says very little.
 */
export function classifyGeolocationError(code: number): GeolocationPermission {
  // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT.
  // Numeric literals rather than the constants, because `GeolocationPositionError`
  // does not exist in a non-browser runtime and this file is imported by tests.
  return code === 1 ? "DENIED" : "UNAVAILABLE";
}

/** The attestation recorded when no fix was even attempted. */
export function unavailableAttestation(
  permission: GeolocationPermission = "UNAVAILABLE",
): CaptureAttestation {
  return {
    permission,
    latitude: null,
    longitude: null,
    accuracyMeters: null,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Asks the browser for a position, and always resolves.
 *
 * Never rejects: a rejected promise here would have to be caught at every call
 * site, and one forgotten catch would turn a refused prompt into a failed
 * upload. Refusal is an outcome, not an error.
 */
export async function captureLocation(): Promise<CaptureAttestation> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return unavailableAttestation();
  }

  return new Promise<CaptureAttestation>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          permission: "GRANTED",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          capturedAt: new Date().toISOString(),
        });
      },
      (error) => {
        resolve(unavailableAttestation(classifyGeolocationError(error.code)));
      },
      {
        enableHighAccuracy: true,
        timeout: FIX_TIMEOUT_MS,
        // A fix from the last two minutes is fine. The driver has not moved
        // between photographing the document and pressing send, and reusing
        // one saves a cold GPS lock on a phone that is already struggling.
        maximumAge: 120_000,
      },
    );
  });
}
