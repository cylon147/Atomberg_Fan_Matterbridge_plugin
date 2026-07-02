import { PlatformConfig } from 'matterbridge';

/** Persisted fan configuration (saved in plugin config). */
export interface StoredFanConfig {
  ipAddress: string;
  displayName: string;
  productName?: string;
  matterEnabled: boolean;
}

/** Live UDP status for a fan, keyed by IP address. */
export interface DiscoveredFanStatus {
  ipAddress: string;
  lastSeen: number;
  online: boolean;
  deviceId?: string;
  series?: string;
  model?: string;
  power?: boolean;
  speed?: number;
  sleepMode?: boolean;
  led?: boolean;
}

/** API response row merging discovery + saved config + Matter state. */
export interface FanListItem {
  ipAddress: string;
  displayName: string;
  productName: string;
  configured: boolean;
  matterEnabled: boolean;
  matterRegistered: boolean;
  online: boolean;
  lastSeen: number | null;
  deviceId?: string;
  series?: string;
  power?: boolean;
  speed?: number;
  configUrl: string;
}

export type AtombergPluginConfig = PlatformConfig & {
  udpListenPort?: number;
  udpCommandPort?: number;
  fans?: StoredFanConfig[];
};

export interface AtombergFanRecord {
  ipAddress: string;
  displayName: string;
  serialNumber: string;
  productName: string;
  uniqueStorageKey: string;
  deviceId?: string;
}
