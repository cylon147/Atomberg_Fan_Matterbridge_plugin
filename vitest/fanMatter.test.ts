import { describe, expect, it, vi } from 'vitest';
import { type MatterbridgeEndpoint } from 'matterbridge';

import { updateFanEndpointIdentity } from '../src/fanMatter.js';
import { type AtombergFanRecord } from '../src/types.js';

describe('fanMatter', () => {
  it('updates bridged device identity attributes without re-registering', async () => {
    const updateAttribute = vi.fn(() => Promise.resolve(true));
    const endpoint = {
      deviceName: 'Old Name',
      productName: 'Old Product',
      log: { logName: 'Old Name' },
      updateAttribute,
    } as unknown as MatterbridgeEndpoint;

    const fan: AtombergFanRecord = {
      ipAddress: '192.168.1.50',
      displayName: 'Living Room Fan',
      productName: 'Atomberg Renesa',
      serialNumber: 'ATB-192168150',
      uniqueStorageKey: 'atomberg-fan-192-168-1-50',
    };

    await updateFanEndpointIdentity(endpoint, fan);

    expect(endpoint.deviceName).toBe('Living Room Fan');
    expect(endpoint.productName).toBe('Atomberg Renesa');
    expect(endpoint.log.logName).toBe('Living Room Fan');
    expect(updateAttribute).toHaveBeenCalledWith('BridgedDeviceBasicInformation', 'nodeLabel', 'Living Room Fan', endpoint.log);
    expect(updateAttribute).toHaveBeenCalledWith('BridgedDeviceBasicInformation', 'productName', 'Atomberg Renesa', endpoint.log);
    expect(updateAttribute).toHaveBeenCalledWith('BridgedDeviceBasicInformation', 'productLabel', 'Renesa', endpoint.log);
  });
});
