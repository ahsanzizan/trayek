import {
  type DocumentType,
  type PodField,
} from "~/server/domain/shipper/requirement-rules";

/**
 * Bahasa Indonesia labels for the requirement vocabulary.
 *
 * Keyed by the domain identifiers rather than duplicating the lists, so adding
 * a requirement type fails to compile here until it is given a label — which
 * is the one place a new type genuinely needs a human decision.
 */
export const POD_FIELD_LABELS: Record<PodField, string> = {
  tandaTangan: "Tanda tangan",
  stempel: "Stempel perusahaan",
  namaTerang: "Nama terang",
  tanggalTerima: "Tanggal terima",
  nomorSuratJalan: "Nomor surat jalan",
  jumlahKoli: "Jumlah koli",
};

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  SURAT_JALAN: "Surat jalan",
  POD: "POD (bukti terima barang)",
  INVOICE: "Invoice",
  FAKTUR_PAJAK: "Faktur pajak",
  BERITA_ACARA: "Berita acara",
  FOTO_BARANG: "Foto barang",
};

export const CLOCK_START_LABELS = {
  INVOICE_DATE: "Tanggal invoice",
  PACKET_RECEIVED_DATE: "Tanggal berkas diterima",
} as const;

export const WEEKDAY_LABELS = [
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
  "Minggu",
] as const;
