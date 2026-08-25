"use client";

import { useRef, useState } from "react";
import { genUploader } from "uploadthing/client";

import { type QualityReport } from "~/lib/pod-quality";
import { type UploadRouter } from "~/server/storage/router";
import {
  captureLocation,
  unavailableAttestation,
  type CaptureAttestation,
} from "./capture-location";
import { measurePhoto } from "./measure-photo";
import {
  backoffDelayMs,
  isOffline,
  MAX_UPLOAD_ATTEMPTS,
  shouldRetry,
  waitBeforeRetry,
} from "./upload-retry";

/**
 * The capture screen (TRK-030), with the quality guard (TRK-031).
 *
 * Deliberately built from plain elements rather than the shadcn primitives the
 * console uses. Pak Herman is on a throttled 3G connection at a warehouse
 * gate, and a dialog primitive he never opens is still bytes he waits for.
 *
 * `genUploader` rather than the React helpers in `~/lib/uploadthing`: the
 * helpers pull in a dropzone built for a mouse, which is the wrong interaction
 * and the wrong weight for a phone held in one hand.
 *
 * The quality guard warns and never blocks. Every warning is overridable by
 * the same single tap that sends a clean photograph, because a blurry POD
 * beats no POD and the driver is the one who can see the document.
 */

const { uploadFiles } = genUploader<UploadRouter>();

/** Mirrors the ceiling the upload route enforces server-side. */
const MAX_PAGES = 6;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type Phase = "memilih" | "mengunggah" | "berhasil" | "gagal";

type Selected = {
  file: File;
  /** Object URL for the thumbnail; revoked when the photo is removed. */
  previewUrl: string;
  /** Undefined while measuring, null when the browser could not decode it. */
  quality?: QualityReport | null;
};

function formatSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isWarned(item: Selected): boolean {
  return (item.quality?.failures.length ?? 0) > 0;
}

export function PodCapture({ token }: { token: string }) {
  const [selected, setSelected] = useState<Selected[]>([]);
  const [phase, setPhase] = useState<Phase>("memilih");
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  /**
   * Where and when the driver photographed the POD (TRK-032). Requested once,
   * on the first photograph, so the browser prompt appears immediately after
   * the consent notice below rather than out of nowhere on send.
   */
  const [attestation, setAttestation] = useState<CaptureAttestation | null>(
    null,
  );
  /**
   * One key per capture attempt (TRK-033). Held across retries so the second
   * attempt lands on the submission the first opened, and replaced only after
   * a batch has actually been accepted.
   */
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [attempt, setAttempt] = useState(1);

  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  /**
   * Measures after the thumbnail is already on screen, keyed by preview URL.
   *
   * The driver sees his photograph immediately and the verdict arrives a
   * moment later. Blocking the preview on the measurement would make a cheap
   * phone feel broken for the second it takes to decode a 12 MP frame.
   */
  function measure(item: Selected) {
    void measurePhoto(item.file).then((quality) => {
      setSelected((current) =>
        current.map((entry) =>
          entry.previewUrl === item.previewUrl ? { ...entry, quality } : entry,
        ),
      );
    });
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList) {
      return;
    }

    const incoming = Array.from(fileList);
    const tooLarge = incoming.find((file) => file.size > MAX_IMAGE_BYTES);

    if (tooLarge) {
      setMessage(
        `Foto ${tooLarge.name} berukuran ${formatSize(tooLarge.size)}. Maksimal 8 MB. Coba foto ulang.`,
      );
      return;
    }

    setSelected((current) => {
      const room = MAX_PAGES - current.length;

      if (room <= 0) {
        setMessage(`Maksimal ${MAX_PAGES} foto untuk satu POD.`);
        return current;
      }

      setMessage(null);

      const added = incoming.slice(0, room).map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
      }));

      added.forEach(measure);

      // Asked once, and never awaited: a driver whose phone cannot get a fix
      // inside a warehouse must not wait on it, and one who refuses must not
      // be blocked by it.
      if (current.length === 0 && added.length > 0) {
        void captureLocation().then(setAttestation);
      }

      return [...current, ...added];
    });
  }

  function removeAt(index: number) {
    setSelected((current) => {
      const target = current[index];

      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }

      return current.filter((_, position) => position !== index);
    });
  }

  async function submit() {
    if (selected.length === 0) {
      return;
    }

    setPhase("mengunggah");
    setMessage(null);
    setProgress(0);

    const payload = {
      files: selected.map((item) => item.file),
      input: {
        token,
        idempotencyKey,
        // Recorded whether or not a fix was obtained: the absence of a
        // location is itself worth knowing, and TRK-062 reads both.
        attestation: attestation ?? unavailableAttestation(),
        // Advisory only. The server stores this for the TRK-044 correlation
        // and must never let it decide whether a write is allowed.
        quality: selected.map((item) => ({
          fileName: item.file.name,
          score: item.quality?.score ?? null,
          overridden: isWarned(item),
          checks:
            item.quality?.checks.map((check) => ({
              id: check.id,
              passed: check.passed,
              value: check.value,
            })) ?? [],
        })),
      },
      onUploadProgress: ({ progress: percent }: { progress: number }) => {
        setProgress(Math.round(percent));
      },
    };

    for (let current = 1; current <= MAX_UPLOAD_ATTEMPTS; current += 1) {
      setAttempt(current);

      // Skip an attempt the browser already knows will fail, but still count
      // it: waiting for `online` is the retry, and it is not free.
      if (!isOffline()) {
        try {
          await uploadFiles("podUploader", payload);

          for (const item of selected) {
            URL.revokeObjectURL(item.previewUrl);
          }

          // Only now. The success screen appears after the server has taken
          // the batch, never after the last byte left the phone — a driver
          // who is told it worked will not send it again.
          setIdempotencyKey(crypto.randomUUID());
          setPhase("berhasil");
          return;
        } catch {
          // The reason is deliberately not surfaced: it is either a network
          // fault that retrying answers, or a link problem the admin has to
          // fix. Neither is improved by an English string from a library.
        }
      }

      if (shouldRetry(current)) {
        setMessage(
          `Sinyal terputus. Mencoba mengirim ulang secara otomatis (${current} dari ${MAX_UPLOAD_ATTEMPTS})…`,
        );
        await waitBeforeRetry(backoffDelayMs(current));
      }
    }

    setPhase("gagal");
    setMessage(
      "Foto belum terkirim setelah beberapa kali percobaan. Periksa sinyal Anda, lalu tekan Kirim ulang.",
    );
  }

  if (phase === "berhasil") {
    return (
      <section className="mt-8" aria-live="polite">
        <div className="border-border rounded-lg border border-dashed p-6 text-center">
          <p className="text-2xl">✓</p>
          <h2 className="mt-3 text-lg font-medium">POD sudah terkirim</h2>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            Terima kasih. Admin sudah menerima {selected.length} foto. Anda
            tidak perlu mengirim ulang.
          </p>
        </div>
      </section>
    );
  }

  const warnings = selected.flatMap((item, index) =>
    (item.quality?.failures ?? []).map((failure) => ({
      page: index + 1,
      message: failure.message,
    })),
  );

  return (
    <section className="mt-8">
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(event) => {
          addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={galleryInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          addFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <div className="flex flex-col gap-3">
        <button
          type="button"
          disabled={phase === "mengunggah"}
          onClick={() => cameraInput.current?.click()}
          className="bg-primary text-primary-foreground min-h-14 rounded-lg px-4 text-base font-medium disabled:opacity-50"
        >
          Ambil foto POD
        </button>
        <button
          type="button"
          disabled={phase === "mengunggah"}
          onClick={() => galleryInput.current?.click()}
          className="border-border min-h-14 rounded-lg border px-4 text-base disabled:opacity-50"
        >
          Pilih dari galeri
        </button>
      </div>

      {selected.length > 0 && (
        <ul className="mt-6 grid grid-cols-3 gap-3">
          {selected.map((item, index) => (
            <li key={item.previewUrl} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- an
                  object URL for a local file has no remote loader to optimize,
                  and next/image would ship a component for nothing. */}
              <img
                src={item.previewUrl}
                alt={`Foto POD halaman ${index + 1}`}
                className={
                  isWarned(item)
                    ? "aspect-square w-full rounded-md border-2 border-amber-500 object-cover"
                    : "border-border aspect-square w-full rounded-md border object-cover"
                }
              />
              {isWarned(item) && (
                <span
                  className="absolute bottom-1 left-1 rounded bg-amber-500 px-1.5 py-0.5 text-xs text-white"
                  aria-label={`Halaman ${index + 1} kurang jelas`}
                >
                  !
                </span>
              )}
              <button
                type="button"
                disabled={phase === "mengunggah"}
                onClick={() => removeAt(index)}
                aria-label={`Hapus foto halaman ${index + 1}`}
                className="bg-background border-border absolute -top-2 -right-2 h-8 w-8 rounded-full border text-sm disabled:opacity-50"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <div
          className="mt-6 rounded-lg border border-amber-500 p-4"
          role="status"
        >
          <p className="text-sm font-medium">Periksa foto berikut</p>
          <ul className="mt-2 space-y-1">
            {warnings.map((warning) => (
              <li
                key={`${warning.page}-${warning.message}`}
                className="text-sm leading-6 text-amber-700"
              >
                Halaman {warning.page}: {warning.message}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-3 text-sm leading-6">
            Anda tetap bisa mengirim foto ini jika sudah tidak memungkinkan
            untuk foto ulang.
          </p>
        </div>
      )}

      {message !== null && (
        <p className="mt-4 text-sm leading-6 text-amber-700" role="alert">
          {message}
        </p>
      )}

      {selected.length > 0 && (
        <button
          type="button"
          disabled={phase === "mengunggah"}
          onClick={() => void submit()}
          className="bg-primary text-primary-foreground mt-6 min-h-14 w-full rounded-lg px-4 text-base font-medium disabled:opacity-50"
        >
          {phase === "mengunggah"
            ? `Mengirim… ${progress}% (percobaan ${attempt})`
            : phase === "gagal"
              ? "Kirim ulang"
              : warnings.length > 0
                ? `Tetap kirim ${selected.length} foto`
                : `Kirim ${selected.length} foto`}
        </button>
      )}

      <p className="text-muted-foreground mt-4 text-sm leading-6">
        Foto POD harus terlihat jelas: nomor surat jalan, tanda tangan, nama
        terang, dan stempel penerima.
      </p>

      {/* Shown before the browser is asked, never after. The prompt appears
          when the first photograph is added, and a driver who has not read
          why would simply refuse it. Wording pending review against the PDP
          notice in TRK-140. */}
      <p className="text-muted-foreground mt-4 text-xs leading-5">
        Saat Anda menambahkan foto, aplikasi meminta izin lokasi untuk mencatat
        tempat pengambilan foto sebagai bukti pengiriman. Anda boleh menolak,
        dan foto tetap bisa dikirim seperti biasa.
      </p>
    </section>
  );
}
