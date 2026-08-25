import {
  type ChannelAdapter,
  type ChannelRegistry,
  type ChannelType,
} from "~/server/domain/ports/channel";

const DEFAULT_MAX_ENTRIES = 10;

export interface ChannelRegistryEntry {
  organizationId: string;
  channel: ChannelType;
  adapter: ChannelAdapter;
}

export interface ChannelRegistryOptions {
  maxEntries?: number;
  onEvict?: (entry: ChannelRegistryEntry) => void;
}

export interface RegisteredChannelRegistry extends ChannelRegistry {
  register(
    organizationId: string,
    channel: ChannelType,
    adapter: ChannelAdapter,
  ): void;
  clear(): void;
}

function registryKey(organizationId: string, channel: ChannelType): string {
  return `${organizationId}:${channel}`;
}

export function createChannelRegistry(
  options: ChannelRegistryOptions = {},
): RegisteredChannelRegistry {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;

  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError("maxEntries must be a positive integer");
  }

  const entries = new Map<string, ChannelRegistryEntry>();

  function touch(key: string, entry: ChannelRegistryEntry): void {
    entries.delete(key);
    entries.set(key, entry);
  }

  return {
    get(organizationId, channel) {
      const key = registryKey(organizationId, channel);
      const entry = entries.get(key);

      if (!entry) {
        throw new Error("CHANNEL_NOT_REGISTERED");
      }

      touch(key, entry);
      return entry.adapter;
    },

    register(organizationId, channel, adapter) {
      const key = registryKey(organizationId, channel);
      const entry = { organizationId, channel, adapter };

      entries.delete(key);
      entries.set(key, entry);

      while (entries.size > maxEntries) {
        const oldest = entries.entries().next().value;

        if (!oldest) {
          break;
        }

        const [oldestKey, oldestEntry] = oldest;
        entries.delete(oldestKey);
        options.onEvict?.(oldestEntry);
      }
    },

    clear() {
      entries.clear();
    },
  };
}
