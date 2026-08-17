import { MARKET_FACILITY_CATALOG } from '../market-city/catalog';
import { deriveTileInspection } from '../market-city/queries';
import { isPowerPlant, MARKET_CITY_RULES } from '../market-city/rules';
import { derivePower, hasFacilityRoadAccess } from '../market-city/spatial';
import { deriveRailStationOperations } from '../market-city/transport';
import { deriveWaterService } from '../market-city/water';
import type {
  MarketCityStateV2,
  MarketFacility,
  MarketFacilityKind,
  MarketZoneKind,
} from '../market-city/types';

export type InspectorTargetKind =
  | 'building'
  | 'zoned-tile'
  | 'road'
  | 'power-line'
  | 'power-facility'
  | 'water-facility'
  | 'surface-facility';

export type InspectorConnectorState = 'connected' | 'failed' | 'not-applicable';

export interface InspectorConnector {
  state: InspectorConnectorState;
  mode?: 'usage' | 'production';
  used?: number;
  capacity?: number;
  secondaryLabel?: string;
  secondaryUsed?: number;
  secondaryCapacity?: number;
}

export interface InspectorTargetSnapshot {
  targetId: string;
  focusTileId: number;
  x: number;
  y: number;
  kind: InspectorTargetKind;
  title: string;
  subtitle: string;
  icon: string;
  road: InspectorConnector;
  rail?: InspectorConnector;
  water: InspectorConnector;
  power: InspectorConnector;
  details?: readonly string[];
}

export interface InspectorPin {
  targetId: string;
  focusTileId: number;
  kind: InspectorTargetKind;
  title: string;
  icon: string;
}

export interface InspectorState {
  open: InspectorPin | null;
  pinned: InspectorPin[];
}

export type InspectorAction =
  | { type: 'open'; target: InspectorTargetSnapshot }
  | { type: 'minimize' }
  | { type: 'restore'; targetId: string }
  | { type: 'close' }
  | { type: 'refresh'; targetId: string; target: InspectorTargetSnapshot | null };

export const EMPTY_INSPECTOR_STATE: InspectorState = {
  open: null,
  pinned: [],
};

const WATER_FACILITY_KINDS = new Set<MarketFacilityKind>([
  'water-tower',
  'coastal-water-pump',
  'water-treatment-plant',
]);

const SUBWAY_FACILITY_KIND = 'subway-station';

function tileIdFor(x: number, y: number, size: number): number {
  return y * size + x;
}

function coordinateFor(tileId: number, size: number): { x: number; y: number } {
  return { x: tileId % size, y: Math.floor(tileId / size) };
}

function zoneLabel(zone: MarketZoneKind): string {
  return zone === 'R' ? 'Residential' : zone === 'C' ? 'Commercial' : 'Industrial';
}

function facilityLabel(kind: MarketFacilityKind): string {
  return MARKET_FACILITY_CATALOG[kind]?.label ?? kind.replaceAll('-', ' ');
}

function notApplicable(): InspectorConnector {
  return { state: 'not-applicable' };
}

function binary(connected: boolean): InspectorConnector {
  return { state: connected ? 'connected' : 'failed' };
}

function usage(connected: boolean, used: number, capacity: number): InspectorConnector {
  return {
    state: connected ? 'connected' : 'failed',
    mode: 'usage',
    used,
    capacity,
  };
}

function production(
  connected: boolean,
  capacity: number,
  used: number | undefined,
  secondaryLabel?: string,
  secondaryUsed?: number,
  secondaryCapacity?: number,
): InspectorConnector {
  const connector: InspectorConnector = {
    state: connected ? 'connected' : 'failed',
    mode: 'production',
    capacity,
  };
  if (used !== undefined) connector.used = used;
  if (secondaryLabel !== undefined) connector.secondaryLabel = secondaryLabel;
  if (secondaryUsed !== undefined) connector.secondaryUsed = secondaryUsed;
  if (secondaryCapacity !== undefined) connector.secondaryCapacity = secondaryCapacity;
  return connector;
}

function componentForPower(state: MarketCityStateV2, tileIds: readonly number[]) {
  const power = derivePower(state);
  const componentIds = new Set(
    tileIds
      .map((tileId) => power.componentByTile[tileId])
      .filter((componentId): componentId is string => componentId !== null),
  );
  return {
    power,
    component: power.components.find(({ id }) => componentIds.has(id)),
  };
}

function componentForWater(state: MarketCityStateV2, tileIds: readonly number[]) {
  const power = derivePower(state);
  const water = deriveWaterService(state, power);
  const componentIds = new Set(
    tileIds
      .flatMap((tileId) => [water.componentByTile[tileId], water.coverageByTile[tileId]])
      .filter((componentId): componentId is string => componentId !== null),
  );
  return {
    water,
    component: water.components.find(({ id }) => componentIds.has(id)),
  };
}

function facilityTarget(
  state: MarketCityStateV2,
  facility: MarketFacility,
  tileId: number,
  x: number,
  y: number,
): InspectorTargetSnapshot | null {
  if (facility.kind === SUBWAY_FACILITY_KIND) return null;

  const { power, component: powerComponent } = componentForPower(state, facility.tiles);
  const roadConnected = hasFacilityRoadAccess(state, facility);
  const catalogKind = facility.kind as keyof typeof MARKET_FACILITY_CATALOG;

  if (isPowerPlant(facility.kind)) {
    const capacity = MARKET_CITY_RULES.plants[facility.kind].capacity;
    const operation = power.plantOperations.find(({ id }) => id === facility.id);
    const { component: waterComponent } = componentForWater(state, facility.tiles);
    const connected = operation?.operational === true;
    return {
      targetId: `facility:${facility.id}`,
      focusTileId: tileId,
      x,
      y,
      kind: 'power-facility',
      title: facilityLabel(facility.kind),
      subtitle: `Power facility · Tile ${x + 1}, ${y + 1}`,
      icon: '⚡',
      road: operation?.roadRequired === true ? binary(operation.roadAccess === true) : notApplicable(),
      water: (operation?.waterDemand ?? 0) > 0
        ? usage(operation?.waterAccess === true, operation!.waterDemand, waterComponent?.usableCapacity ?? 0)
        : notApplicable(),
      power: production(
        connected,
        capacity,
        powerComponent?.allocated,
        'Network load',
        powerComponent?.allocated,
        powerComponent?.capacity ?? capacity,
      ),
      details: operation === undefined
        ? ['Plant state unavailable']
        : connected
          ? [
            'Plant operational',
            operation.waterComponentId === null ? 'Cooling water not required' : `Cooling water component ${operation.waterComponentId}`,
          ]
          : ['Plant inactive', `Reason: ${operation.inactiveReason ?? 'Utility requirements are not met.'}`],
    };
  }

  if (WATER_FACILITY_KINDS.has(facility.kind)) {
    const { water, component: waterComponent } = componentForWater(state, facility.tiles);
    const operation = water.facilities.find(({ id }) => id === facility.id);
    if (!operation) return null;
    const usableCapacity = waterComponent?.usableCapacity
      ?? Math.max(
        operation.rawCapacity,
        operation.treatmentCapacity,
        MARKET_FACILITY_CATALOG[catalogKind].operatingCapacity,
      );
    return {
      targetId: `facility:${facility.id}`,
      focusTileId: tileId,
      x,
      y,
      kind: 'water-facility',
      title: facilityLabel(facility.kind),
      subtitle: `Water facility · Tile ${x + 1}, ${y + 1}`,
      icon: '💧',
      road: binary(operation.roadAccess),
      water: production(
        operation.operational,
        usableCapacity,
        waterComponent?.demand,
        'Network demand',
        waterComponent?.demand,
        usableCapacity,
      ),
      power: binary(operation.powerAccess),
    };
  }

  if (facility.kind === 'train-station') {
    const water = deriveWaterService(state, power);
    const operation = deriveRailStationOperations(state, power, water)
      .find((candidate) => candidate.stationId === facility.id);
    if (!operation) return null;
    const waterComponent = operation.waterComponentId === null
      ? undefined
      : water.components.find(({ id }) => id === operation.waterComponentId);
    return {
      targetId: `facility:${facility.id}`,
      focusTileId: tileId,
      x,
      y,
      kind: 'surface-facility',
      title: facilityLabel(facility.kind),
      subtitle: `Passenger rail · Tile ${x + 1}, ${y + 1}`,
      icon: '▣',
      road: binary(operation.roadAccess),
      rail: binary(operation.railAccess),
      power: usage(
        operation.powerAccess,
        MARKET_CITY_RULES.transit.trainStationPowerLoad,
        powerComponent?.capacity ?? 0,
      ),
      water: usage(
        operation.waterAccess,
        MARKET_CITY_RULES.transit.trainStationWaterDemand,
        waterComponent?.usableCapacity ?? 0,
      ),
      details: [
        `Station ${operation.operational ? 'operational' : 'inactive'}`,
        `Water component ${operation.waterComponentId ?? 'none'}`,
        ...(operation.inactiveReason === null ? [] : [`Reason: ${operation.inactiveReason}`]),
      ],
    };
  }

  return {
    targetId: `facility:${facility.id}`,
    focusTileId: tileId,
    x,
    y,
    kind: 'surface-facility',
    title: facilityLabel(facility.kind),
    subtitle: `Surface facility · Tile ${x + 1}, ${y + 1}`,
    icon: '✚',
    road: binary(roadConnected),
    water: notApplicable(),
    power: notApplicable(),
  };
}

export function deriveInspectorTarget(
  state: MarketCityStateV2,
  coordinate: { x: number; y: number },
): InspectorTargetSnapshot | null {
  const { x, y } = coordinate;
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x >= state.map.size || y >= state.map.size) {
    return null;
  }

  const tileId = tileIdFor(x, y, state.map.size);
  const inspection = deriveTileInspection(state, tileId);
  const facility = state.map.facilities.find((candidate) => candidate.tiles.includes(tileId));
  if (facility) return facilityTarget(state, facility, tileId, x, y);

  if (inspection.powerLine) {
    const { component } = componentForPower(state, [tileId]);
    const connected = component !== undefined && component.capacity > 0 && inspection.powered;
    return {
      targetId: `tile:power-line:${tileId}`,
      focusTileId: tileId,
      x,
      y,
      kind: 'power-line',
      title: 'Power Line',
      subtitle: `Power network · Tile ${x + 1}, ${y + 1}`,
      icon: '⌁',
      road: notApplicable(),
      water: notApplicable(),
      power: usage(connected, component?.allocated ?? 0, component?.capacity ?? 0),
    };
  }

  if (inspection.roadSurface) {
    return {
      targetId: `tile:road:${tileId}`,
      focusTileId: tileId,
      x,
      y,
      kind: 'road',
      title: inspection.avenueLane ? 'Avenue' : 'Road',
      subtitle: `Road surface · Tile ${x + 1}, ${y + 1}`,
      icon: '═',
      road: binary(true),
      water: notApplicable(),
      power: notApplicable(),
    };
  }

  if (inspection.zone !== null) {
    const { component: powerComponent } = componentForPower(state, [tileId]);
    const { component: waterComponent } = componentForWater(state, [tileId]);
    const isBuilding = inspection.renderedHeight > 0 || inspection.density > 0;
    return {
      targetId: `tile:zone:${tileId}`,
      focusTileId: tileId,
      x,
      y,
      kind: isBuilding ? 'building' : 'zoned-tile',
      title: isBuilding ? `${zoneLabel(inspection.zone)} Building` : `${zoneLabel(inspection.zone)} Tile`,
      subtitle: `Tile ${x + 1}, ${y + 1} · ${isBuilding ? `${inspection.renderedHeight} floor${inspection.renderedHeight === 1 ? '' : 's'}` : 'Empty zoning'}`,
      icon: inspection.zone === 'R' ? '⌂' : inspection.zone === 'C' ? '▥' : '▤',
      road: binary(inspection.roadAccess),
      water: usage(inspection.watered, waterComponent?.allocated ?? 0, waterComponent?.usableCapacity ?? 0),
      power: usage(inspection.powered, powerComponent?.allocated ?? 0, powerComponent?.capacity ?? 0),
    };
  }

  return null;
}

export function pinFromTarget(target: InspectorTargetSnapshot): InspectorPin {
  return {
    targetId: target.targetId,
    focusTileId: target.focusTileId,
    kind: target.kind,
    title: target.title,
    icon: target.icon,
  };
}

export function refreshPin(pin: InspectorPin, target: InspectorTargetSnapshot | null): InspectorPin {
  if (!target) return { ...pin, title: 'Object no longer present', icon: '·' };
  return pinFromTarget(target);
}

export function reduceInspectorState(state: InspectorState, action: InspectorAction): InspectorState {
  switch (action.type) {
    case 'open':
      return { ...state, open: pinFromTarget(action.target) };
    case 'minimize':
      if (!state.open) return state;
      return {
        open: null,
        pinned: state.pinned.some(({ targetId }) => targetId === state.open?.targetId)
          ? state.pinned
          : [...state.pinned, state.open],
      };
    case 'restore': {
      const pin = state.pinned.find(({ targetId }) => targetId === action.targetId);
      return pin ? { ...state, open: pin } : state;
    }
    case 'close':
      return {
        open: null,
        pinned: state.open
          ? state.pinned.filter(({ targetId }) => targetId !== state.open?.targetId)
          : state.pinned,
      };
    case 'refresh': {
      return {
        open: state.open && state.open.targetId === action.targetId
          ? refreshPin(state.open, action.target)
          : state.open,
        pinned: state.pinned.map((pin) => pin.targetId === action.targetId
          ? refreshPin(pin, action.target)
          : pin),
      };
    }
  }
}

export function focusTileCoordinate(pin: InspectorPin, size: number): { x: number; y: number } {
  return coordinateFor(pin.focusTileId, size);
}
