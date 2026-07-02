import { vi, describe, beforeEach, afterAll } from 'vitest';
import { AnsiLogger, LogLevel } from 'matterbridge/logger';
import { MatterbridgeEndpoint, PlatformConfig, PlatformMatterbridge } from 'matterbridge';

import { TemplatePlatform } from '../src/module.ts';

const mockLog = {
  fatal: vi.fn((message: string, ...parameters: any[]) => {}),
  error: vi.fn((message: string, ...parameters: any[]) => {}),
  warn: vi.fn((message: string, ...parameters: any[]) => {}),
  notice: vi.fn((message: string, ...parameters: any[]) => {}),
  info: vi.fn((message: string, ...parameters: any[]) => {}),
  debug: vi.fn((message: string, ...parameters: any[]) => {}),
} as unknown as AnsiLogger;

const mockMatterbridge = {
  matterbridgeDirectory: './jest/matterbridge',
  matterbridgePluginDirectory: './jest/plugins',
  systemInformation: { ipv4Address: undefined, ipv6Address: undefined, osRelease: 'xx.xx.xx.xx.xx.xx', nodeVersion: '22.1.10' },
  matterbridgeVersion: '3.0.0',
  log: mockLog,
  getDevices: vi.fn(() => {
    return [];
  }),
  getPlugins: vi.fn(() => {
    return [];
  }),
  addBridgedEndpoint: vi.fn(async (pluginName: string, device: MatterbridgeEndpoint) => {}),
  removeBridgedEndpoint: vi.fn(async (pluginName: string, device: MatterbridgeEndpoint) => {}),
  removeAllBridgedEndpoints: vi.fn(async (pluginName: string) => {}),
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

const loggerLogSpy = vi.spyOn(AnsiLogger.prototype, 'log').mockImplementation((level: string, message: string, ...parameters: any[]) => {});

describe('Matterbridge Plugin Template', () => {
  let instance: TemplatePlatform;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('should throw an error if matterbridge is not the required version', async () => {
    mockMatterbridge.matterbridgeVersion = '3.0.0';
    expect(() => new TemplatePlatform(mockMatterbridge, mockLog, mockConfig)).toThrow(
      'This plugin requires Matterbridge version >= "3.9.0" for the plugin web interface. Please update Matterbridge from 3.0.0 to the latest version in the frontend.',
    );
    mockMatterbridge.matterbridgeVersion = '3.9.0';
  });

  it('should create an instance of the platform', async () => {
    instance = (await import('../src/module.ts')).default(mockMatterbridge, mockLog, mockConfig) as TemplatePlatform;
    expect(instance).toBeInstanceOf(TemplatePlatform);
    expect(instance.matterbridge).toBe(mockMatterbridge);
    expect(instance.log).toBe(mockLog);
    expect(instance.config).toBe(mockConfig);
    expect(instance.matterbridge.matterbridgeVersion).toBe('3.9.0');
    expect(mockLog.info).toHaveBeenCalledWith('Initializing Atomberg Fan platform...');
  });

  it('should start without auto-registering unconfigured Matter fans', async () => {
    await instance.onStart('Jest');
    expect(instance.getDevices()).toHaveLength(0);
    expect(mockLog.info).toHaveBeenCalledWith('onStart called with reason: Jest');
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

  it('should configure', async () => {
    await instance.onConfigure();
    expect(mockLog.info).toHaveBeenCalledWith('onConfigure called');
  });

  it('should change logger level', async () => {
    await instance.onChangeLoggerLevel(LogLevel.DEBUG);
    expect(mockLog.info).toHaveBeenCalledWith('onChangeLoggerLevel called with: debug');
  });

  it('should shutdown', async () => {
    await instance.onShutdown('Jest');
    expect(mockLog.info).toHaveBeenCalledWith('onShutdown called with reason: Jest');

    const unregisterAllDevicesSpy = vi.spyOn(instance, 'unregisterAllDevices').mockResolvedValue(undefined);
    mockConfig.unregisterOnShutdown = true;
    await instance.onShutdown();
    expect(mockLog.info).toHaveBeenCalledWith('onShutdown called with reason: none');
    expect(unregisterAllDevicesSpy).toHaveBeenCalled();
    unregisterAllDevicesSpy.mockRestore();
    mockConfig.unregisterOnShutdown = false;
  });
});
