export interface PresignedGetParams {
  organizationId: string;
  key: string;
  expiresInMinutes?: number;
}

export interface PresignedPutParams {
  organizationId: string;
  key: string;
  contentType: string;
  declaredContentLength: number;
  expiresInMinutes?: number;
}

export interface StorageObjectParams {
  organizationId: string;
  key: string;
}

export interface PresignedUrl {
  url: string;
  expiresAt: Date;
}

export interface StoragePort {
  presignedGet(params: PresignedGetParams): Promise<PresignedUrl>;
  presignedPut(params: PresignedPutParams): Promise<PresignedUrl>;
  exists(params: StorageObjectParams): Promise<boolean>;
  delete(params: StorageObjectParams): Promise<void>;
}
