import { FanControl } from 'matterbridge/matter/clusters';
import { bridgedNode, fan as fanDeviceType, MatterbridgeEndpoint, powerSource } from 'matterbridge';
import { type AnsiLogger, debugStringify } from 'matterbridge/logger';
import { isValidNumber } from 'matterbridge/utils';

import { type AtombergFanRecord } from './types.js';

const BRIDGED_INFO_CLUSTER = 'BridgedDeviceBasicInformation';
const FAN_CLUSTER = 'FanControl';

const FAN_MODE_LOOKUP = ['Off', 'Low', 'Medium', 'High', 'On', 'Auto', 'Smart'];
const FAN_DIRECTION_LOOKUP = ['Forward', 'Reverse'];

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
    .createCompleteFanControlClusterServer()
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
    'rockSetting',
    (newValue: object, oldValue: object, context) => {
      endpoint.log.info(
        `${fan.displayName}: rock setting changed from ${debugStringify(oldValue)} to ${debugStringify(newValue)} context: ${context.fabric === undefined ? 'offline' : 'online'}`,
      );
      if (context.fabric === undefined) return;
      onControl?.(fan, { type: 'rockSetting', value: newValue });
    },
    endpoint.log,
  );

  endpoint.subscribeAttribute(
    FAN_CLUSTER,
    'windSetting',
    (newValue: object, oldValue: object, context) => {
      endpoint.log.info(
        `${fan.displayName}: wind setting changed from ${debugStringify(oldValue)} to ${debugStringify(newValue)} context: ${context.fabric === undefined ? 'offline' : 'online'}`,
      );
      if (context.fabric === undefined) return;
      onControl?.(fan, { type: 'windSetting', value: newValue });
    },
    endpoint.log,
  );

  endpoint.subscribeAttribute(
    FAN_CLUSTER,
    'airflowDirection',
    (newValue: number, oldValue: number, context) => {
      endpoint.log.info(
        `${fan.displayName}: airflow direction changed from ${FAN_DIRECTION_LOOKUP[oldValue] ?? oldValue} to ${FAN_DIRECTION_LOOKUP[newValue] ?? newValue} context: ${context.fabric === undefined ? 'offline' : 'online'}`,
      );
      if (context.fabric === undefined) return;
      onControl?.(fan, { type: 'airflowDirection', value: newValue });
    },
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
    return;
  }

  if (speed === undefined) return;

  let percent = 0;
  let mode = FanControl.FanMode.Off;

  if (speed <= 0) {
    percent = 0;
    mode = FanControl.FanMode.Off;
  } else if (speed === 1) {
    percent = 33;
    mode = FanControl.FanMode.Low;
  } else if (speed === 2) {
    percent = 50;
    mode = FanControl.FanMode.Medium;
  } else if (speed >= 3) {
    percent = 100;
    mode = FanControl.FanMode.High;
  }

  await endpoint.setAttribute(FAN_CLUSTER, 'fanMode', mode, log);
  await endpoint.setAttribute(FAN_CLUSTER, 'percentSetting', percent, log);
  await endpoint.setAttribute(FAN_CLUSTER, 'percentCurrent', percent, log);
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

  if (newValue === FanControl.FanMode.Off) {
    await endpoint.setAttribute(FAN_CLUSTER, 'percentSetting', 0, endpoint.log);
    await endpoint.setAttribute(FAN_CLUSTER, 'percentCurrent', 0, endpoint.log);
  } else if (newValue === FanControl.FanMode.Low) {
    await endpoint.setAttribute(FAN_CLUSTER, 'percentSetting', 33, endpoint.log);
    await endpoint.setAttribute(FAN_CLUSTER, 'percentCurrent', 33, endpoint.log);
  } else if (newValue === FanControl.FanMode.Medium) {
    await endpoint.setAttribute(FAN_CLUSTER, 'percentSetting', 66, endpoint.log);
    await endpoint.setAttribute(FAN_CLUSTER, 'percentCurrent', 66, endpoint.log);
  } else if (newValue === FanControl.FanMode.High) {
    await endpoint.setAttribute(FAN_CLUSTER, 'percentSetting', 100, endpoint.log);
    await endpoint.setAttribute(FAN_CLUSTER, 'percentCurrent', 100, endpoint.log);
  } else if (newValue === FanControl.FanMode.On) {
    await endpoint.setAttribute(FAN_CLUSTER, 'fanMode', FanControl.FanMode.High, endpoint.log);
    await endpoint.setAttribute(FAN_CLUSTER, 'percentSetting', 100, endpoint.log);
    await endpoint.setAttribute(FAN_CLUSTER, 'percentCurrent', 100, endpoint.log);
  } else if (newValue === FanControl.FanMode.Auto) {
    await endpoint.setAttribute(FAN_CLUSTER, 'percentSetting', null, endpoint.log);
    await endpoint.setAttribute(FAN_CLUSTER, 'percentCurrent', 50, endpoint.log);
  }
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

  if (context.fabric === undefined) return;

  onControl?.(fan, { type: 'percentSetting', value: newValue });

  if (isValidNumber(newValue, 0, 100)) await endpoint.setAttribute(FAN_CLUSTER, 'percentCurrent', newValue, endpoint.log);
  if (isValidNumber(newValue, 0, 0)) await endpoint.setAttribute(FAN_CLUSTER, 'fanMode', FanControl.FanMode.Off, endpoint.log);
  if (isValidNumber(newValue, 1, 33)) await endpoint.setAttribute(FAN_CLUSTER, 'fanMode', FanControl.FanMode.Low, endpoint.log);
  if (isValidNumber(newValue, 34, 66)) await endpoint.setAttribute(FAN_CLUSTER, 'fanMode', FanControl.FanMode.Medium, endpoint.log);
  if (isValidNumber(newValue, 67, 100)) await endpoint.setAttribute(FAN_CLUSTER, 'fanMode', FanControl.FanMode.High, endpoint.log);
  if (newValue === null) await endpoint.setAttribute(FAN_CLUSTER, 'fanMode', FanControl.FanMode.Auto, endpoint.log);
}
