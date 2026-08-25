import { createRequire } from "node:module";

interface QrCodeModule {
  toDataURL(value: string): Promise<string>;
}

const loadCommonJs = createRequire(import.meta.url);
const qrCode = loadCommonJs("qrcode") as QrCodeModule;

export function qrDataUrl(value: string): Promise<string> {
  return qrCode.toDataURL(value);
}
