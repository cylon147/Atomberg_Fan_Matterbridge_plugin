import type { PlatformConfig, PlatformMatterbridge } from 'matterbridge';
import { type MatterbridgeEndpoint } from 'matterbridge';
import { LogLevel } from 'matterbridge/logger';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import initializePlugin, { AtombergPlatform } from '../src/module.js';

const mockLog = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  notice: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
} as unknown as import('matterbridge/logger').AnsiLogger;

const baseMatterbridge = {
  matterbridgeDirectory: './vitest/matterbridge',
  matterbridgePluginDirectory: './vitest/plugins',
  systemInformation: { ipv4Address: undefined, ipv6Address: undefined, osRelease: 'xx.xx.xx.xx.xx.xx', nodeVersion: '22.1.10' },
  matterbridgeVersion: '3.9.0',
  aggregatorVendorId: 0xfff1,
  log: mockLog,
  getDevices: vi.fn(() => []),
  getPlugins: vi.fn(() => []),
  addBridgedEndpoint: vi.fn(async (_pluginName: string, _device: MatterbridgeEndpoint) => {}),
  removeBridgedEndpoint: vi.fn(async (_pluginName: string, _device: MatterbridgeEndpoint) => {}),
} as unknown as PlatformMatterbridge;

const mockConfig = {
  name: 'matterbridge-atomberg-plugin',
  type: 'DynamicPlatform',
  version: '1.0.0',
  debug: false,
  unregisterOnShutdown: false,
} as PlatformConfig;

describe('AtombergPlatform', () => {
  let instance: AtombergPlatform;
  let mockMatterbridge: PlatformMatterbridge;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMatterbridge = { ...baseMatterbridge, matterbridgeVersion: '3.9.0' } as PlatformMatterbridge;
    instance = initializePlugin(mockMatterbridge, mockLog, mockConfig);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('should throw an error if matterbridge is not the required version', () => {
    const outdatedBridge = { ...baseMatterbridge, matterbridgeVersion: '2.0.0' } as PlatformMatterbridge;
    expect(() => new AtombergPlatform(outdatedBridge, mockLog, mockConfig)).toThrow(
      'This plugin requires Matterbridge version >= "3.9.0". Please update Matterbridge from 2.0.0 to the latest version in the frontend.',
    );
  });

  it('should create an instance of the platform', () => {
    expect(instance).toBeInstanceOf(AtombergPlatform);
    expect(instance.matterbridge).toBe(mockMatterbridge);
    expect(instance.log).toBe(mockLog);
    expect(instance.config).toBe(mockConfig);
    expect(mockLog.info).toHaveBeenCalledWith('Initializing platform:', mockConfig.name);
  });

  it('should start', async () => {
    await instance.onStart('Vitest');
    expect(mockLog.info).toHaveBeenCalledWith('onStart called with reason:', 'Vitest');
    await instance.onStart();
    expect(mockLog.info).toHaveBeenCalledWith('onStart called with reason:', 'none');
  });

  it('should call the command handlers', async () => {
    await instance.onStart();
    for (const device of instance.getDevices()) {
      if (device.hasClusterServer('onOff')) {
        await device.executeCommandHandler('OnOff.on', {} as never, 'onOff', {} as never, device);
        await device.executeCommandHandler('OnOff.off', {} as never, 'onOff', {} as never, device);
      }
    }
    expect(mockLog.info).toHaveBeenCalledWith('Command OnOff.on called');
    expect(mockLog.info).toHaveBeenCalledWith('Command OnOff.off called');
  });

  it('should configure', async () => {
    await instance.onStart();
    await instance.onConfigure();
    expect(mockLog.info).toHaveBeenCalledWith('onConfigure called');
    expect(instance.getDevices().length).toBeGreaterThan(0);
    expect(mockLog.info).toHaveBeenCalledWith('Configuring device:', expect.any(String));
  });

  it('should change logger level', async () => {
    await instance.onChangeLoggerLevel(LogLevel.DEBUG);
    expect(mockLog.info).toHaveBeenCalledWith('onChangeLoggerLevel called with:', 'debug');
  });

  it('should shutdown', async () => {
    const unregisterSpy = vi.spyOn(instance, 'unregisterAllDevices').mockResolvedValue();

    await instance.onShutdown('Vitest');
    expect(mockLog.info).toHaveBeenCalledWith('onShutdown called with reason:', 'Vitest');

    mockConfig.unregisterOnShutdown = true;
    await instance.onShutdown();
    expect(mockLog.info).toHaveBeenCalledWith('onShutdown called with reason:', 'none');
    expect(unregisterSpy).toHaveBeenCalled();
    mockConfig.unregisterOnShutdown = false;
  });
});
