import { jest } from '@jest/globals';
import { AnsiLogger, LogLevel } from 'matterbridge/logger';
import { MatterbridgeEndpoint, PlatformConfig, PlatformMatterbridge } from 'matterbridge';

import { TemplatePlatform } from '../src/module.ts';

const mockLog = {
  fatal: jest.fn((message: string, ...parameters: any[]) => {}),
  error: jest.fn((message: string, ...parameters: any[]) => {}),
  warn: jest.fn((message: string, ...parameters: any[]) => {}),
  notice: jest.fn((message: string, ...parameters: any[]) => {}),
  info: jest.fn((message: string, ...parameters: any[]) => {}),
  debug: jest.fn((message: string, ...parameters: any[]) => {}),
} as unknown as AnsiLogger;

const mockMatterbridge = {
  matterbridgeDirectory: './jest/matterbridge',
  matterbridgePluginDirectory: './jest/plugins',
  systemInformation: { ipv4Address: undefined, ipv6Address: undefined, osRelease: 'xx.xx.xx.xx.xx.xx', nodeVersion: '22.1.10' },
  matterbridgeVersion: '3.0.0',
  log: mockLog,
  getDevices: jest.fn(() => {
    return [];
  }),
  getPlugins: jest.fn(() => {
    return [];
  }),
  addBridgedEndpoint: jest.fn(async (pluginName: string, device: MatterbridgeEndpoint) => {}),
  removeBridgedEndpoint: jest.fn(async (pluginName: string, device: MatterbridgeEndpoint) => {}),
  removeAllBridgedEndpoints: jest.fn(async (pluginName: string) => {}),
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

const loggerLogSpy = jest.spyOn(AnsiLogger.prototype, 'log').mockImplementation((level: string, message: string, ...parameters: any[]) => {});

describe('Matterbridge Plugin Template', () => {
  let instance: TemplatePlatform;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    jest.restoreAllMocks();
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

  it('should update Matter identity live when a registered fan is reconfigured', async () => {
    const updateAttribute = jest.fn(async () => true);
    const mockEndpoint = {
      log: mockLog,
      deviceName: 'Bedroom Fan',
      productName: 'Atomberg Fan',
      updateAttribute,
    } as unknown as MatterbridgeEndpoint;

    (instance as unknown as { endpointByIp: Map<string, MatterbridgeEndpoint> }).endpointByIp.set('192.168.1.50', mockEndpoint);
    (instance as unknown as { fanRecordByIp: Map<string, { displayName: string; productName: string }> }).fanRecordByIp.set('192.168.1.50', {
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
    await instance.onShutdown('Jest');
    expect(mockLog.info).toHaveBeenCalledWith('onShutdown called with reason: Jest');

    const unregisterAllDevicesSpy = jest.spyOn(instance, 'unregisterAllDevices').mockResolvedValue(undefined);
    mockConfig.unregisterOnShutdown = true;
    await instance.onShutdown();
    expect(mockLog.info).toHaveBeenCalledWith('onShutdown called with reason: none');
    expect(unregisterAllDevicesSpy).toHaveBeenCalled();
    unregisterAllDevicesSpy.mockRestore();
    mockConfig.unregisterOnShutdown = false;
  });
});
