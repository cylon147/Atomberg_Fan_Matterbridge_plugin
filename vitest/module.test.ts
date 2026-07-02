import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { type AnsiLogger, LogLevel } from 'matterbridge/logger';
import { type MatterbridgeEndpoint, type PlatformConfig, type PlatformMatterbridge } from 'matterbridge';

import { TemplatePlatform } from '../src/module.js';
import type { AtombergFanRecord } from '../src/types.js';

const mockLog = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  notice: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
} as unknown as AnsiLogger;

const baseMatterbridge = {
  matterbridgeDirectory: './vitest/matterbridge',
  matterbridgePluginDirectory: './vitest/plugins',
  systemInformation: { ipv4Address: undefined, ipv6Address: undefined, osRelease: 'xx.xx.xx.xx.xx.xx', nodeVersion: '22.1.10' },
  matterbridgeVersion: '3.9.0',
  log: mockLog,
  getDevices: vi.fn(() => []),
  getPlugins: vi.fn(() => []),
  addBridgedEndpoint: vi.fn(async (_pluginName: string, _device: MatterbridgeEndpoint) => {}),
  removeBridgedEndpoint: vi.fn(async (_pluginName: string, _device: MatterbridgeEndpoint) => {}),
  removeAllBridgedEndpoints: vi.fn(async (_pluginName: string) => {}),
} as unknown as PlatformMatterbridge;

const mockConfig = {
  name: 'matterbridge-atomberg-fan',
  type: 'DynamicPlatform',
  version: '1.0.0',
  debug: false,
  unregisterOnShutdown: false,
  fans: [
    {
      ipAddress: '192.168.1.50',
      displayName: 'Bedroom Fan',
      productName: 'Atomberg Fan',
      matterEnabled: false,
    },
  ],
} as PlatformConfig;

describe('TemplatePlatform', () => {
  let instance: TemplatePlatform;
  let mockMatterbridge: PlatformMatterbridge;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockMatterbridge = { ...baseMatterbridge, matterbridgeVersion: '3.9.0' } as PlatformMatterbridge;
    instance = (await import('../src/module.js')).default(mockMatterbridge, mockLog, mockConfig);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('should throw an error if matterbridge is not the required version', () => {
    const outdatedBridge = { ...baseMatterbridge, matterbridgeVersion: '3.0.0' } as PlatformMatterbridge;
    expect(() => new TemplatePlatform(outdatedBridge, mockLog, mockConfig)).toThrow(
      'This plugin requires Matterbridge version >= "3.9.0" for the plugin web interface. Please update Matterbridge from 3.0.0 to the latest version in the frontend.',
    );
  });

  it('should create an instance of the platform', () => {
    expect(instance).toBeInstanceOf(TemplatePlatform);
    expect(instance.matterbridge).toBe(mockMatterbridge);
    expect(instance.log).toBe(mockLog);
    expect(instance.config).toBe(mockConfig);
    expect(mockLog.info).toHaveBeenCalledWith('Initializing Atomberg Fan platform...');
  });

  it('should start without auto-registering unconfigured Matter fans', async () => {
    await instance.onStart('Vitest');
    expect(instance.getDevices()).toHaveLength(0);
    expect(mockLog.info).toHaveBeenCalledWith('onStart called with reason: Vitest');
  });

  it('should expose fan configuration through onFetch', async () => {
    const list = (await instance.onFetch('GET', 'fans')) as { fans: Array<{ ipAddress: string; displayName: string }> };
    expect(Array.isArray(list.fans)).toBe(true);
    expect(list.fans.some((fan) => fan.ipAddress === '192.168.1.50' && fan.displayName === 'Bedroom Fan')).toBe(true);

    const configured = (await instance.onFetch('POST', 'fans/configure', undefined, {
      ipAddress: '192.168.1.51',
      displayName: 'Kitchen Fan',
      productName: 'Atomberg Renesa',
    })) as { ok: boolean };

    expect(configured.ok).toBe(true);
  });

  it('should update Matter identity live when a registered fan is reconfigured', async () => {
    const updateAttribute = vi.fn(() => Promise.resolve(true));
    const mockEndpoint = {
      log: mockLog,
      deviceName: 'Bedroom Fan',
      productName: 'Atomberg Fan',
      updateAttribute,
    } as unknown as MatterbridgeEndpoint;

    (instance as unknown as { endpointByIp: Map<string, MatterbridgeEndpoint> }).endpointByIp.set('192.168.1.50', mockEndpoint);
    (instance as unknown as { fanRecordByIp: Map<string, AtombergFanRecord> }).fanRecordByIp.set('192.168.1.50', {
      ipAddress: '192.168.1.50',
      displayName: 'Bedroom Fan',
      productName: 'Atomberg Fan',
      serialNumber: 'ATB-1',
      uniqueStorageKey: 'atomberg-fan-192-168-1-50',
    });

    const result = (await instance.onFetch('POST', 'fans/configure', undefined, {
      ipAddress: '192.168.1.50',
      displayName: 'Primary Bedroom Fan',
      productName: 'Atomberg Renesa',
    })) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(updateAttribute).toHaveBeenCalledWith('BridgedDeviceBasicInformation', 'nodeLabel', 'Primary Bedroom Fan', mockLog);
    expect(mockEndpoint.deviceName).toBe('Primary Bedroom Fan');
  });

  it('should configure', async () => {
    await instance.onConfigure();
    expect(mockLog.info).toHaveBeenCalledWith('onConfigure called');
  });

  it('should change logger level', async () => {
    await instance.onChangeLoggerLevel(LogLevel.DEBUG);
    expect(mockLog.info).toHaveBeenCalledWith('onChangeLoggerLevel called with: debug');
  });

  it('should shutdown', async () => {
    await instance.onShutdown('Vitest');
    expect(mockLog.info).toHaveBeenCalledWith('onShutdown called with reason: Vitest');

    const unregisterAllDevicesSpy = vi.spyOn(instance, 'unregisterAllDevices').mockResolvedValue();
    mockConfig.unregisterOnShutdown = true;
    await instance.onShutdown();
    expect(mockLog.info).toHaveBeenCalledWith('onShutdown called with reason: none');
    expect(unregisterAllDevicesSpy).toHaveBeenCalled();
    mockConfig.unregisterOnShutdown = false;
  });
});
