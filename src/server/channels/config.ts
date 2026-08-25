export type BaileysNodeEnv = "development" | "test" | "production";

export interface BaileysConfigInput {
  nodeEnv: BaileysNodeEnv;
  authDir?: string;
  maxChannelSockets?: number;
  pairingPhone?: string;
}

export interface BaileysConfig {
  authDir: string;
  maxChannelSockets: number;
  pairingPhone?: string;
}

const DEFAULT_AUTH_DIR = "./auth_info";
const DEVELOPMENT_MAX_CHANNEL_SOCKETS = 10;
const PRODUCTION_MAX_CHANNEL_SOCKETS = 100;

export function resolveBaileysConfig(input: BaileysConfigInput): BaileysConfig {
  const config: BaileysConfig = {
    authDir: input.authDir ?? DEFAULT_AUTH_DIR,
    maxChannelSockets:
      input.maxChannelSockets ??
      (input.nodeEnv === "production"
        ? PRODUCTION_MAX_CHANNEL_SOCKETS
        : DEVELOPMENT_MAX_CHANNEL_SOCKETS),
  };

  if (input.pairingPhone !== undefined) {
    config.pairingPhone = input.pairingPhone;
  }

  return config;
}
