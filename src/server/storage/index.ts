import { env } from "~/env";
import { type StoragePort } from "~/server/domain/ports/storage";
import { UploadThingStorageAdapter } from "~/server/storage/uploadthing-adapter";

export { UploadThingStorageAdapter } from "~/server/storage/uploadthing-adapter";
export {
  uploadRouter,
  type UploadRouter,
  podUploadInput,
  invoiceUploadInput,
  validatePodFileSizes,
  type UploadThingFileMetadata,
} from "~/server/storage/router";

export const storage: StoragePort = new UploadThingStorageAdapter(
  env.UPLOADTHING_TOKEN,
);
