"use client";

import { useRef, useState } from "react";
import { genUploader } from "uploadthing/client";

import { type UploadRouter } from "~/server/storage/router";

/**
 * The capture screen (TRK-030).
 *
 * Deliberately built from plain elements rather than the shadcn primitives the
 * console uses. Pak Herman is on a throttled 3G connection at a warehouse
 * gate, and a dialog primitive he never opens is still bytes he waits for.
 *
 * `genUploader` rather than the React helpers in `~/lib/uploadthing`: the
 * helpers pull in a dropzone built for a mouse, which is the wrong interaction
 * and the wrong weight for a phone held in one hand.
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
};

function formatSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PodCapture({ token }: { token: string }) {
  const [selected, setSelected] = useState<Selected[]>([]);
  const [phase, setPhase] = useState<Phase>("memilih");
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

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

      return [
        ...current,
        ...incoming.slice(0, room).map((file) => ({
          file,
          previewUrl: URL.createObjectURL(file),
        })),
      ];
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

    try {
      await uploadFiles("podUploader", {
        files: selected.map((item) => item.file),
        input: { token },
        onUploadProgress: ({ progress: percent }) => {
          setProgress(Math.round(percent));
        },
      });

      for (const item of selected) {
        URL.revokeObjectURL(item.previewUrl);
      }

      setPhase("berhasil");
    } catch {
      // The reason is deliberately not surfaced: it is either a network fault
      // the driver can only retry, or a link problem the admin has to fix.
      // Neither is improved by an English error string from a library.
      setPhase("gagal");
      setMessage(
        "Foto gagal terkirim. Periksa sinyal Anda, lalu coba kirim lagi.",
      );
    }
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
                className="border-border aspect-square w-full rounded-md border object-cover"
              />
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
            ? `Mengirim… ${progress}%`
            : `Kirim ${selected.length} foto`}
        </button>
      )}

      <p className="text-muted-foreground mt-4 text-sm leading-6">
        Foto POD harus terlihat jelas: nomor surat jalan, tanda tangan, nama
        terang, dan stempel penerima.
      </p>
    </section>
  );
}
