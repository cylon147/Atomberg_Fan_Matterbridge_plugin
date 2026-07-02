import { FanControl } from 'matterbridge/matter/clusters';
import { bridgedNode, fan as fanDeviceType, MatterbridgeEndpoint, powerSource } from 'matterbridge';
import { type AnsiLogger, debugStringify } from 'matterbridge/logger';

import {
  ATOMBERG_MAX_SPEED,
  atombergSpeedToFanMode,
  atombergSpeedToPercent,
  fanModeToAtombergSpeed,
  percentToAtombergSpeed,
} from './fanSpeed.js';
import { type AtombergFanRecord } from './types.js';

const BRIDGED_INFO_CLUSTER = 'BridgedDeviceBasicInformation';
const FAN_CLUSTER = 'FanControl';

const FAN_MODE_LOOKUP = ['Off', 'Low', 'Medium', 'High', 'On', 'Auto', 'Smart'];

export function buildFanStorageKey(ipAddress: string): string {
  return `atomberg-fan-${ipAddress.replace(/\./g, '-')}`;
}

export function buildFanSerial(ipAddress: string, deviceId?: string): string {
  return deviceId ?? `ATB-${ipAddress.replace(/\./g, '')}`;
}

export function buildPluginConfigUrl(pluginName: string, ipAddress: string): string {
  return `/plugins/${pluginName}/?device=${encodeURIComponent(ipAddress)}`;
}

export function createFanEndpoint(
  fan: AtombergFanRecord,
  aggregatorVendorId: number,
  configUrl: string,
  debug: boolean,
): MatterbridgeEndpoint {
  const endpoint = new MatterbridgeEndpoint([fanDeviceType, bridgedNode, powerSource], { id: fan.uniqueStorageKey }, debug)
    .createDefaultBridgedDeviceBasicInformationClusterServer(
      fan.displayName,
      fan.serialNumber,
      aggregatorVendorId,
      'Atomberg',
      fan.productName,
    )
    .createDefaultPowerSourceWiredClusterServer()
    .createMultiSpeedFanControlClusterServer(
      FanControl.FanMode.Off,
      FanControl.FanModeSequence.OffLowMedHighAuto,
      0,
      0,
      ATOMBERG_MAX_SPEED,
      0,
      0,
    )
    .addRequiredClusterServers();

  endpoint.configUrl = configUrl;
  return endpoint;
}

export async function updateFanEndpointIdentity(endpoint: MatterbridgeEndpoint, fan: AtombergFanRecord): Promise<void> {
  const vendorName = 'Atomberg';
  const displayName = fan.displayName.slice(0, 32);
  const productName = (fan.productName ?? 'Atomberg Fan').slice(0, 32);
  const productLabel = productName.replace(vendorName, '').trim().slice(0, 64) || productName;

  endpoint.deviceName = fan.displayName;
  endpoint.productName = fan.productName;
  endpoint.log.logName = fan.displayName;

  await endpoint.updateAttribute(BRIDGED_INFO_CLUSTER, 'nodeLabel', displayName, endpoint.log);
  await endpoint.updateAttribute(BRIDGED_INFO_CLUSTER, 'productName', productName, endpoint.log);
  await endpoint.updateAttribute(BRIDGED_INFO_CLUSTER, 'productLabel', productLabel, endpoint.log);
}

export function setupFanHandlers(
  endpoint: MatterbridgeEndpoint,
  fan: AtombergFanRecord,
  onControl?: (fan: AtombergFanRecord, command: Record<string, unknown>) => void,
): void {
  endpoint.subscribeAttribute(
    FAN_CLUSTER,
    'fanMode',
    (newValue: FanControl.FanMode, oldValue: FanControl.FanMode, context) =>
      void handleFanModeChange(endpoint, fan, newValue, oldValue, context, onControl),
    endpoint.log,
  );

  endpoint.subscribeAttribute(
    FAN_CLUSTER,
    'percentSetting',
    (newValue: number | null, oldValue: number | null, context) =>
      void handlePercentSettingChange(endpoint, fan, newValue, oldValue, context, onControl),
    endpoint.log,
  );

  endpoint.subscribeAttribute(
    FAN_CLUSTER,
    'speedSetting',
    (newValue: number | null, oldValue: number | null, context) =>
      void handleSpeedSettingChange(endpoint, fan, newValue, oldValue, context, onControl),
    endpoint.log,
  );

  endpoint.addCommandHandler('step', ({ request }) => {
    endpoint.log.info(`${fan.displayName}: step command called with ${debugStringify(request)}`);
    onControl?.(fan, { type: 'step', value: request });
  });
}

export async function syncFanStateFromUdp(
  endpoint: MatterbridgeEndpoint,
  power: boolean | undefined,
  speed: number | undefined,
  log: AnsiLogger,
): Promise<void> {
  if (power === false) {
    await endpoint.setAttribute(FAN_CLUSTER, 'fanMode', FanControl.FanMode.Off, log);
    await endpoint.setAttribute(FAN_CLUSTER, 'percentSetting', 0, log);
    await endpoint.setAttribute(FAN_CLUSTER, 'percentCurrent', 0, log);
    await endpoint.setAttribute(FAN_CLUSTER, 'speedSetting', 0, log);
    await endpoint.setAttribute(FAN_CLUSTER, 'speedCurrent', 0, log);
    return;
  }

  if (speed === undefined) return;

  const level = speed <= 0 ? 0 : Math.max(1, Math.min(ATOMBERG_MAX_SPEED, Math.round(speed)));
  const percent = atombergSpeedToPercent(level);
  const mode = atombergSpeedToFanMode(level);

  await endpoint.setAttribute(FAN_CLUSTER, 'fanMode', mode, log);
  await endpoint.setAttribute(FAN_CLUSTER, 'percentSetting', percent, log);
  await endpoint.setAttribute(FAN_CLUSTER, 'percentCurrent', percent, log);
  await endpoint.setAttribute(FAN_CLUSTER, 'speedSetting', level, log);
  await endpoint.setAttribute(FAN_CLUSTER, 'speedCurrent', level, log);
}

async function applyAtombergSpeedToEndpoint(endpoint: MatterbridgeEndpoint, atombergSpeed: number): Promise<void> {
  const level = atombergSpeed <= 0 ? 0 : Math.max(1, Math.min(ATOMBERG_MAX_SPEED, Math.round(atombergSpeed)));
  const percent = atombergSpeedToPercent(level);
  const mode = atombergSpeedToFanMode(level);

  await endpoint.setAttribute(FAN_CLUSTER, 'fanMode', mode, endpoint.log);
  await endpoint.setAttribute(FAN_CLUSTER, 'percentSetting', percent, endpoint.log);
  await endpoint.setAttribute(FAN_CLUSTER, 'percentCurrent', percent, endpoint.log);
  await endpoint.setAttribute(FAN_CLUSTER, 'speedSetting', level, endpoint.log);
  await endpoint.setAttribute(FAN_CLUSTER, 'speedCurrent', level, endpoint.log);
}

async function handleSpeedSettingChange(
  endpoint: MatterbridgeEndpoint,
  fan: AtombergFanRecord,
  newValue: number | null,
  oldValue: number | null,
  context: { fabric?: unknown },
  onControl?: (fan: AtombergFanRecord, command: Record<string, unknown>) => void,
): Promise<void> {
  endpoint.log.info(
    `${fan.displayName}: speed setting changed from ${oldValue} to ${newValue} context: ${context.fabric === undefined ? 'offline' : 'online'}`,
  );

  if (context.fabric === undefined || newValue === null) return;

  const level = Math.max(0, Math.min(ATOMBERG_MAX_SPEED, Math.round(newValue)));
  onControl?.(fan, { type: 'speedSetting', value: level });
  await applyAtombergSpeedToEndpoint(endpoint, level);
}

async function handleFanModeChange(
  endpoint: MatterbridgeEndpoint,
  fan: AtombergFanRecord,
  newValue: FanControl.FanMode,
  oldValue: FanControl.FanMode,
  context: { fabric?: unknown },
  onControl?: (fan: AtombergFanRecord, command: Record<string, unknown>) => void,
): Promise<void> {
  endpoint.log.info(
    `${fan.displayName}: fan mode changed from ${FAN_MODE_LOOKUP[oldValue] ?? oldValue} to ${FAN_MODE_LOOKUP[newValue] ?? newValue} context: ${context.fabric === undefined ? 'offline' : 'online'}`,
  );

  if (context.fabric === undefined) return;

  onControl?.(fan, { type: 'fanMode', value: newValue });

  if (newValue === FanControl.FanMode.Auto) {
    await endpoint.setAttribute(FAN_CLUSTER, 'percentSetting', null, endpoint.log);
    await endpoint.setAttribute(FAN_CLUSTER, 'percentCurrent', atombergSpeedToPercent(3), endpoint.log);
    return;
  }

  await applyAtombergSpeedToEndpoint(endpoint, fanModeToAtombergSpeed(newValue));
}

async function handlePercentSettingChange(
  endpoint: MatterbridgeEndpoint,
  fan: AtombergFanRecord,
  newValue: number | null,
  oldValue: number | null,
  context: { fabric?: unknown },
  onControl?: (fan: AtombergFanRecord, command: Record<string, unknown>) => void,
): Promise<void> {
  endpoint.log.info(
    `${fan.displayName}: percent setting changed from ${oldValue} to ${newValue} context: ${context.fabric === undefined ? 'offline' : 'online'}`,
  );

  if (context.fabric === undefined || newValue === null) return;

  const level = percentToAtombergSpeed(newValue);
  onControl?.(fan, { type: 'percentSetting', value: newValue });
  await applyAtombergSpeedToEndpoint(endpoint, level);
}
