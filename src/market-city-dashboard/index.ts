import './dashboard.css';
import {
  MARKET_FACILITY_CATALOG,
  MARKET_NETWORK_CATALOG,
  MARKET_SERVICE_ZONE_CATALOG,
} from '../market-city/catalog';
import { deriveMarketView } from '../market-city/queries';
import { deriveCrimeBalance } from '../market-city/crime';
import { crimeHeightModifier } from '../market-city/spatial';
import {
  MARKET_CITY_RULES,
} from '../market-city/rules';
import { derivePower } from '../market-city/spatial';
import type {
  MarketCityStateV2,
  MarketFireDifficulty,
  MarketPlaybackSpeed,
  MarketSectorView,
  MarketZoneKind,
} from '../market-city/types';
import {
  DEFAULT_MARKET_CITY_CONTROLLER_ENGINE,
  MarketCityController,
  MarketCityNotFoundError,
  type MarketCityControllerEngine,
  type MarketCityCreateOptions,
} from './controller';
import {
  BrowserMarketCityPersistence,
  MemoryMarketCityPersistence,
  type MarketCityPersistence,
} from './persistence';
import { toSquareGridRendererState, type SquareGridMarketRendererState } from './render-adapter';
import {
  MarketCityDashboardRuntime,
  type MarketDashboardCommandPlan,
  type MarketDashboardCommandResult,
  type MarketDashboardRenderUpdate,
} from './runtime';
import {
  deriveInspectorTarget,
  EMPTY_INSPECTOR_STATE,
  focusTileCoordinate,
  reduceInspectorState,
  type InspectorConnector,
  type InspectorPin,
  type InspectorState,
  type InspectorTargetSnapshot,
} from './inspector';
import { onAssetVisualSelectionChange } from '../market-city/asset-visuals';

type BuildIdentity = Readonly<{
  commitSha: string;
  deploymentId: string;
  environment: string;
  canonicalUrl: string;
  deploymentUrl: string;
  schemaVersion: number;
  rulesVersion: string;
  buildTime: string;
}>;

declare const __SYNTHCITY_BUILD_IDENTITY__: BuildIdentity;

interface SquareGridMayorBridge {
  centerOnTile(coordinate: { x: number; y: number }): void;
  onViewStateChange(listener: () => void): () => void;
  registerSynthCityController(controller: {
    ready(): void;
    preview(command: unknown): MarketDashboardCommandPlan;
    commit(plan: MarketDashboardCommandPlan): MarketDashboardCommandResult;
    dispatch(command: unknown): MarketDashboardCommandResult;
    inspect(coordinate: { x: number; y: number }): void;
    queryRoutes(coordinate: { x: number; y: number }): void;
    clearQuery(): void;
    pause(): void;
    hash(): string;
    snapshot(): MarketCityStateV2;
    canonicalSnapshot(): string;
    setVerticalDevelopmentLevel(level: number): void;
    undo(): Promise<boolean>;
    save(): Promise<boolean>;
    reload(): Promise<boolean>;
    whenDurable(): Promise<boolean>;
  }): void;
  selectAction(action: string | null): void;
  selectDataView(view: string): void;
  refreshCatalogVisuals(): void;
  createCatalogWorldThumbnail(options: {
    kind: string;
    footprint: Readonly<{ width: number; height: number }>;
    mode?: 'surface' | 'network' | 'underground' | 'service-zone';
    rotation?: number;
    label?: string;
  }): SVGSVGElement;
  renderSynthCityState(state: SquareGridMarketRendererState, update?: MarketDashboardRenderUpdate): void;
  renderSynthCityStatus(state: SquareGridMarketRendererState): void;
  renderRouteQueryFlows(flows?: unknown[]): void;
}

declare global {
  interface Window {
    __synthCityBuildIdentity?: BuildIdentity;
    marketCityDashboard?: {
      hash(): string;
      snapshot(): MarketCityStateV2;
      canonicalSnapshot(): string;
      preview(command: unknown): MarketDashboardCommandPlan;
      commit(plan: MarketDashboardCommandPlan): MarketDashboardCommandResult;
      dispatch(command: unknown): MarketDashboardCommandResult;
      step(months?: number): MarketCityStateV2;
      setSpeed(speed: MarketPlaybackSpeed): void;
      setFireDifficulty(difficulty: MarketFireDifficulty): void;
      setVerticalDevelopmentLevel(level: number): void;
      undo(): Promise<boolean>;
      save(): Promise<boolean>;
      reload(): Promise<boolean>;
      whenDurable(): Promise<boolean>;
    };
  }
}

const buildIdentity = __SYNTHCITY_BUILD_IDENTITY__;
window.__synthCityBuildIdentity = buildIdentity;
document.documentElement.dataset.synthcityCommit = buildIdentity.commitSha;
document.documentElement.dataset.synthcityDeployment = buildIdentity.deploymentId;
document.documentElement.dataset.synthcityEnvironment = buildIdentity.environment;
document.documentElement.dataset.synthcitySchema = String(buildIdentity.schemaVersion);
document.documentElement.dataset.synthcityRules = buildIdentity.rulesVersion;
document.documentElement.dataset.synthcityBuildTime = buildIdentity.buildTime;

/** Set once the runtime exists; the Police tray only calls it from a click. */
let policeBudgetRefresh: (() => void) | null = null;
const hidePoliceBudget = (): void => { required<HTMLElement>('#police-budget').hidden = true; };

const signedStoreys = (value: number): string => (value > 0 ? `+${value}` : String(value));

/**
 * The force budget panel.
 *
 * Two things this has to communicate or the dial reads as broken. First, the
 * rate does not follow the slider: funding moves the TARGET, and the city
 * drifts toward it over years, so both numbers are always on screen. Second,
 * funding with no station buys nothing and bills nothing, so the control is
 * disabled with the reason rather than silently doing nothing.
 */
function wirePoliceBudget(runtime: MarketCityDashboardRuntime): () => void {
  const rules = MARKET_CITY_RULES.police;
  const section = required<HTMLElement>('#police-budget');
  const slider = required<HTMLInputElement>('#police-funding');
  slider.max = String(rules.maximumFunding);

  const refresh = (): void => {
    const state = runtime.snapshot();
    const balance = deriveCrimeBalance(state);
    const staffed = balance.operationalStations > 0;
    slider.value = String(state.crime.funding);
    slider.disabled = !staffed;
    setText('#police-funding-value', String(state.crime.funding));
    setText('#police-budget-cost', formatMoney(staffed ? state.crime.funding * rules.fundingMonthlyExpense : 0));
    setText('#police-budget-now', `${(state.crime.share * 100).toFixed(1)}%`);
    setText('#police-budget-target', `${(balance.targetShare * 100).toFixed(1)}%`);
    const now = crimeHeightModifier(state.crime.share);
    const eventual = crimeHeightModifier(balance.targetShare);
    setText('#police-budget-height', now === eventual
      ? `${signedStoreys(now)} storeys`
      : `${signedStoreys(now)} → ${signedStoreys(eventual)} storeys`);
    setText('#police-budget-note', staffed
      ? `${formatMoney(rules.fundingMonthlyExpense)} per step each month, across ${balance.operationalStations} operational station${balance.operationalStations === 1 ? '' : 's'}. Funding sets the target; the rate drifts toward it over years.`
      : 'Build a road-served, powered police station first. Funding buys nothing, and costs nothing, without a force to spend it on.');
    section.hidden = false;
  };

  slider.addEventListener('input', () => setText('#police-funding-value', slider.value));
  slider.addEventListener('change', () => {
    runtime.dispatch({ type: 'set-crime-funding', funding: Number(slider.value) });
    refresh();
  });
  return refresh;
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`MarketCity dashboard is missing ${selector}.`);
  return element;
}

function setText(selector: string, value: string): void {
  required<HTMLElement>(selector).textContent = value;
}

function cleanText(value: unknown, fallback: string, maximum = 50): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/\s+/g, ' ').trim().slice(0, maximum);
  return cleaned || fallback;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function seedFromText(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function cityUrl(cityId: string, identity?: { cityName: string; mayorName: string; seed: number }): string {
  const url = new URL(window.location.href);
  url.searchParams.delete('fixture');
  url.searchParams.set('profile', 'city');
  url.searchParams.set('size', '48');
  url.searchParams.set('city', cityId);
  if (identity) {
    url.searchParams.set('newCityName', identity.cityName);
    url.searchParams.set('newMayorName', identity.mayorName);
    url.searchParams.set('seed', String(identity.seed));
  } else {
    url.searchParams.delete('newCityName');
    url.searchParams.delete('newMayorName');
    url.searchParams.delete('seed');
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function openingUrl(): string {
  const url = new URL(window.location.href);
  for (const key of ['city', 'newCityName', 'newMayorName', 'seed', 'fixture']) url.searchParams.delete(key);
  url.searchParams.set('profile', 'city');
  url.searchParams.set('size', '48');
  return `${url.pathname}${url.search}${url.hash}`;
}

function installBuildIdentity(): void {
  const section = document.createElement('section');
  section.className = 'city-settings-section';
  const title = document.createElement('h2');
  title.textContent = 'Build identity';
  const description = document.createElement('p');
  description.textContent = `${buildIdentity.commitSha.slice(0, 12)} · schema ${buildIdentity.schemaVersion} · ${buildIdentity.rulesVersion} · ${buildIdentity.environment}`;
  description.title = `Deployment ${buildIdentity.deploymentId} · ${buildIdentity.deploymentUrl} · built ${buildIdentity.buildTime}`;
  section.append(title, description);
  document.querySelector('.city-settings-danger')?.before(section);
}

async function showOpening(persistence: MarketCityPersistence): Promise<void> {
  const dialog = required<HTMLDialogElement>('#city-opening-dialog');
  const list = required<HTMLElement>('#city-opening-list');
  const profileForm = required<HTMLFormElement>('#city-opening-profile-form');
  const cityForm = required<HTMLFormElement>('#city-opening-form');
  const mayorInput = required<HTMLInputElement>('#city-opening-mayor');
  const cityInput = required<HTMLInputElement>('#city-opening-name');
  const found = required<HTMLButtonElement>('#city-opening-found');
  const mayorStatus = required<HTMLElement>('#city-opening-mayor-status');
  const foundStatus = required<HTMLElement>('#city-opening-found-status');

  let profile = await persistence.loadMayorProfile();
  mayorInput.value = profile?.mayorName ?? '';

  const refreshAvailability = (): void => {
    const cityName = cleanText(cityInput.value, '');
    found.disabled = !profile || !cityName;
    foundStatus.textContent = !profile
      ? 'Save your mayor name before founding a city.'
      : !cityName
        ? 'Enter a city name to continue.'
        : `Ready to found ${cityName} on the fixed 48 × 48 map.`;
  };

  const renderCities = async (): Promise<void> => {
    const cities = await persistence.listCitySummaries();
    if (cities.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'city-opening-empty';
      empty.textContent = 'No cities yet.';
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...cities.map((city) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'city-opening-city';
      button.setAttribute('aria-label', `Continue ${city.cityName}`);
      const identity = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = city.cityName;
      const details = document.createElement('small');
      details.textContent = `Mayor ${city.mayorName} · month ${city.month} · ${formatMoney(city.treasury)}`;
      identity.append(name, details);
      const action = document.createElement('b');
      action.textContent = 'Continue';
      button.append(identity, action);
      button.addEventListener('click', () => window.location.assign(cityUrl(city.cityId)));
      return button;
    }));
  };

  profileForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void persistence.saveMayorProfile({ mayorName: cleanText(mayorInput.value, '') })
      .then(async (saved) => {
        profile = saved;
        mayorInput.value = saved.mayorName;
        mayorStatus.textContent = `${saved.mayorName} will appear across every fresh market city in this browser.`;
        refreshAvailability();
        await renderCities();
      })
      .catch((error: unknown) => {
        mayorStatus.textContent = error instanceof Error ? error.message : 'Mayor profile could not be saved.';
      });
  });
  cityInput.addEventListener('input', refreshAvailability);
  cityForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const cityName = cleanText(cityInput.value, '');
    if (!profile || !cityName) return refreshAvailability();
    const cityId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().toLowerCase()
      : `market-${Date.now().toString(36)}-${seedFromText(cityName).toString(36)}`;
    window.location.assign(cityUrl(cityId, {
      cityName,
      mayorName: profile.mayorName,
      seed: seedFromText(cityId),
    }));
  });

  await renderCities();
  refreshAvailability();
  if (!dialog.open) dialog.showModal();
}

function renderDemand(id: 'residential' | 'commercial' | 'industrial', view: MarketSectorView): void {
  const element = required<HTMLElement>(`#demand-${id}`);
  element.classList.toggle('negative', view.bar < 0);
  element.style.setProperty('--magnitude', String(Math.abs(view.bar) * 16));
  element.setAttribute('aria-label', `${id} has ${view.have.toFixed(2)}, wants ${view.want.toFixed(2)}, gap ${view.gap.toFixed(2)}.`);
  const value = element.querySelector<HTMLElement>('i');
  if (value) value.textContent = view.gap > 0.005 ? '+' : view.gap < -0.005 ? '−' : '0';
}

function renderRciMatrix(state: MarketCityStateV2): void {
  const view = deriveMarketView(state);
  const labels: Readonly<Record<MarketZoneKind, string>> = Object.freeze({ R: 'Residential', C: 'Commercial', I: 'Industrial' });
  const matrix = required<HTMLElement>('#rci-matrix');
  matrix.replaceChildren(...(['R', 'C', 'I'] as const).map((sector) => {
    const sectorView = view[sector];
    const cell = document.createElement('div');
    cell.className = `rci-cell${sectorView.gap > 0 ? ' positive' : sectorView.gap < 0 ? ' negative' : ''}`;
    const header = document.createElement('div');
    header.className = 'rci-header';
    header.textContent = labels[sector];
    const graph = document.createElement('div');
    graph.className = 'rci-graph';
    graph.setAttribute('role', 'img');
    graph.setAttribute('aria-label', `${labels[sector]} demand bar ${sectorView.bar.toFixed(3)}.`);
    const bar = document.createElement('span');
    bar.className = 'rci-graph-bar';
    bar.style.setProperty('--demand', String(Math.abs(sectorView.bar)));
    graph.append(bar);
    const details = document.createElement('small');
    details.textContent = `Have ${sectorView.have.toFixed(2)} · Want ${sectorView.want.toFixed(2)} · Gap ${sectorView.gap.toFixed(2)} · Eligible cap ${sectorView.availableCapacity.toFixed(2)} · Margin ${sectorView.margin.toFixed(3)}`;
    cell.append(header, graph, details);
    return cell;
  }));
}

function renderMetrics(state: MarketCityStateV2, canUndo: boolean): void {
  const view = deriveMarketView(state);
  const zoneTiles = state.map.zones.reduce<number[]>((tiles, zone, tile) => {
    if (zone !== null) tiles.push(tile);
    return tiles;
  }, []);
  const developedTiles = zoneTiles.filter((tile) => (state.economy.density[tile] ?? 0) > 0.05);
  const densityStock = zoneTiles.reduce((sum, tile) => sum + (state.economy.density[tile] ?? 0), 0);
  const densityMean = zoneTiles.length === 0 ? 0 : densityStock / zoneTiles.length;
  const stocks = { R: 0, C: 0, I: 0 };
  for (const tile of zoneTiles) stocks[state.map.zones[tile]!] += state.economy.density[tile] ?? 0;
  const wealthWeight = developedTiles.reduce((sum, tile) => sum + (state.economy.density[tile] ?? 0), 0);
  const averageWealth = wealthWeight === 0 ? 0 : developedTiles.reduce(
    (sum, tile) => sum + (state.economy.wealth[tile] ?? 0) * (state.economy.density[tile] ?? 0),
    0,
  ) / wealthWeight;
  const averagePollution = zoneTiles.length === 0 ? 0 : zoneTiles.reduce(
    (sum, tile) => sum + (state.environment.pollution[tile] ?? 0),
    0,
  ) / zoneTiles.length;
  const currentPower = derivePower(state);
  const poweredZones = zoneTiles.filter((tile) => currentPower.powered[tile]).length;

  setText('#city-name', state.identity.cityName);
  setText('#city-mayor', state.identity.mayorName);
  setText('#city-population', Math.round(view.population).toLocaleString('en-US'));
  setText('#city-treasury', formatMoney(state.economy.treasury));
  setText('#city-date', `Month ${state.clock.month}`);
  setText('#city-height-level', `L${state.market.verticalDevelopmentLevel}`);
  setText('#metric-developed', developedTiles.length.toLocaleString('en-US'));
  setText('#metric-density', `${(densityMean * 100).toFixed(1)}%`);
  setText('#metric-residential-stock', stocks.R.toFixed(2));
  setText('#metric-business-stock', `${stocks.C.toFixed(2)} / ${stocks.I.toFixed(2)}`);
  setText('#metric-revenue', formatMoney(state.economy.lastRevenue));
  setText('#metric-expenses', formatMoney(state.economy.lastOperatingExpense));
  setText('#metric-result', formatMoney(state.economy.lastNet));
  setText('#metric-powered', zoneTiles.length === 0 ? '—' : `${Math.round(poweredZones / zoneTiles.length * 100)}%`);
  required<HTMLElement>('#metric-powered').title = view.powerConstrainedComponentCount === 0
    ? `${view.powerAllocatedLoad.toFixed(2)} of ${view.powerLoad.toFixed(2)} load allocated.`
    : `${view.powerUnservedLoad.toFixed(2)} load unserved across ${view.powerConstrainedComponentCount} constrained component${view.powerConstrainedComponentCount === 1 ? '' : 's'}.`;
  setText('#metric-average-wealth', formatMoney(averageWealth));
  setText('#metric-pollution', `${averagePollution.toFixed(1)}%`);
  renderDemand('residential', view.R);
  renderDemand('commercial', view.C);
  renderDemand('industrial', view.I);
  renderRciMatrix(state);

  const speed = state.clock.paused ? 0 : state.clock.speed;
  const speedButton = required<HTMLButtonElement>('#simulation-speed');
  speedButton.dataset.speed = String(speed);
  speedButton.textContent = speed === 0 ? '▶ Play' : `${speed}× Running`;
  speedButton.setAttribute('aria-label', speed === 0 ? 'Play simulation' : `Simulation speed ${speed}×`);
  speedButton.title = speed === 0 ? 'Play simulation at 1×' : `Simulation running at ${speed}×; click to change speed`;
  const undo = required<HTMLButtonElement>('#simulation-undo');
  undo.disabled = speed !== 0 || !canUndo;
  undo.title = !canUndo ? 'No map action to undo' : speed !== 0 ? 'Pause to undo the last map action' : 'Undo last map action';

  const eventStream = required<HTMLElement>('#simulation-events');
  const message = document.createElement('span');
  message.className = 'ticker-message';
  message.textContent = view.powerConstrainedComponentCount > 0
    ? `Power constrained: ${view.powerUnservedLoad.toFixed(2)} load unserved across ${view.powerConstrainedComponentCount} component${view.powerConstrainedComponentCount === 1 ? '' : 's'}.`
    : state.clock.month === 0
    ? 'Build a road-accessible live plant, connect R zoning, then watch C and I respond.'
    : `Month ${state.clock.month}: revenue ${formatMoney(state.economy.lastRevenue)}, operating cost ${formatMoney(state.economy.lastOperatingExpense)}, net ${formatMoney(state.economy.lastNet)}.`;
  eventStream.replaceChildren(message);
}

let inspectorState: InspectorState = {
  open: EMPTY_INSPECTOR_STATE.open,
  pinned: [...EMPTY_INSPECTOR_STATE.pinned],
};
let pinnedTrayExpanded = false;
let restorePinnedInspector: ((targetId: string) => void) | null = null;

function inspectorNumber(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function clearInspectedTiles(): void {
  document.querySelectorAll('.tile.inspected').forEach((tile) => tile.classList.remove('inspected'));
}

function targetForPin(state: MarketCityStateV2, pin: InspectorPin): InspectorTargetSnapshot | null {
  const x = pin.focusTileId % state.map.size;
  const y = Math.floor(pin.focusTileId / state.map.size);
  const target = deriveInspectorTarget(state, { x, y });
  return target?.targetId === pin.targetId ? target : null;
}

function renderPinnedInspectorTray(): void {
  const tray = required<HTMLElement>('#pinned-inspector-tray');
  const toggle = required<HTMLButtonElement>('#pinned-inspector-toggle');
  const list = required<HTMLElement>('#pinned-inspector-list');
  list.replaceChildren();
  const hasPins = inspectorState.pinned.length > 0;
  if (!hasPins) pinnedTrayExpanded = false;
  tray.hidden = !hasPins;
  tray.dataset.expanded = String(pinnedTrayExpanded);
  toggle.setAttribute('aria-expanded', String(pinnedTrayExpanded));
  toggle.setAttribute('aria-label', pinnedTrayExpanded ? 'Hide pinned object tabs' : 'Show pinned object tabs');
  toggle.title = pinnedTrayExpanded ? 'Hide pinned object tabs' : 'Show pinned object tabs';
  toggle.textContent = pinnedTrayExpanded ? '⌄' : '⌃';
  list.hidden = !pinnedTrayExpanded;
  inspectorState.pinned.forEach((pin) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pinned-inspector-item';
    button.dataset.inspectorPinId = pin.targetId;
    button.dataset.inspectorTargetId = pin.targetId;
    button.dataset.inspectorTargetKind = pin.kind;
    button.setAttribute('aria-label', `Open ${pin.title}`);
    button.setAttribute('aria-pressed', String(inspectorState.open?.targetId === pin.targetId));

    const icon = document.createElement('span');
    icon.className = 'pinned-inspector-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = pin.icon;
    const title = document.createElement('span');
    title.className = 'pinned-inspector-title';
    title.textContent = pin.title;
    button.append(icon, title);
    button.addEventListener('click', () => restorePinnedInspector?.(pin.targetId));
    list.append(button);
  });
}

function setPinnedTrayExpanded(expanded: boolean): void {
  pinnedTrayExpanded = expanded;
  renderPinnedInspectorTray();
  if (inspectorState.open) {
    window.requestAnimationFrame(() => positionInspectorPanel(inspectorState.open!.focusTileId));
  }
}

function positionInspectorPanel(focusTileId: number): void {
  const panel = required<HTMLElement>('#route-query-panel');
  if (panel.hidden) return;
  const state = inspectorState.open;
  if (!state) return;
  const x = focusTileId % 48;
  const y = Math.floor(focusTileId / 48);
  const tile = document.querySelector<HTMLElement>(`.tile[data-x="${x}"][data-y="${y}"]`);
  const map = document.querySelector<HTMLElement>('.city-map');
  if (!tile || !map) return;

  panel.style.left = '0px';
  panel.style.top = '0px';
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
  const panelRect = panel.getBoundingClientRect();
  const tileRect = tile.getBoundingClientRect();
  const mapRect = map.getBoundingClientRect();
  const tray = required<HTMLElement>('#pinned-inspector-tray');
  const trayRect = tray.hidden ? null : tray.getBoundingClientRect();
  const safeRight = Math.min(mapRect.right - 10, window.innerWidth - 122);
  const safeBottom = Math.min(mapRect.bottom - 10, trayRect ? trayRect.top - 8 : mapRect.bottom - 10);
  const minLeft = mapRect.left + 10;
  const maxLeft = Math.max(minLeft, safeRight - panelRect.width);
  const minTop = mapRect.top + 10;
  const maxTop = Math.max(minTop, safeBottom - panelRect.height);
  const rightCandidate = tileRect.right + 14;
  const leftCandidate = tileRect.left - panelRect.width - 14;
  const left = rightCandidate + panelRect.width <= safeRight
    ? rightCandidate
    : leftCandidate;
  const top = tileRect.top + tileRect.height / 2 - panelRect.height / 2;
  panel.style.left = `${Math.round(Math.max(minLeft, Math.min(maxLeft, left)))}px`;
  panel.style.top = `${Math.round(Math.max(minTop, Math.min(maxTop, top)))}px`;
}

function connectorStatusLabel(connector: InspectorConnector): string {
  if (connector.state === 'connected') return '✓';
  if (connector.state === 'failed') return '✕';
  return '—';
}

function renderConnectorRow(label: string, connector: InspectorConnector): HTMLElement {
  const row = document.createElement('div');
  row.className = `inspector-connector inspector-connector-${connector.state}`;
  row.dataset.inspectorConnector = label.toLowerCase();
  row.dataset.inspectorStatus = connector.state;

  const name = document.createElement('span');
  name.className = 'inspector-connector-name';
  name.textContent = label;
  const status = document.createElement('strong');
  status.className = 'inspector-connector-status';
  status.textContent = connectorStatusLabel(connector);
  row.append(name, status);

  if (connector.state === 'connected' && connector.mode === 'usage') {
    const detail = document.createElement('small');
    detail.className = 'inspector-connector-detail';
    detail.textContent = `${inspectorNumber(connector.used)} / ${inspectorNumber(connector.capacity)} used`;
    row.append(detail);
  }
  if (connector.state === 'connected' && connector.mode === 'production') {
    const detail = document.createElement('small');
    detail.className = 'inspector-connector-detail';
    detail.textContent = `Generation capacity ${inspectorNumber(connector.capacity)}`;
    row.append(detail);
    if (connector.secondaryLabel && connector.secondaryUsed !== undefined) {
      const secondary = document.createElement('small');
      secondary.className = 'inspector-connector-detail';
      secondary.textContent = `${connector.secondaryLabel} ${inspectorNumber(connector.secondaryUsed)} / ${inspectorNumber(connector.secondaryCapacity)}`;
      row.append(secondary);
    }
  }
  return row;
}

function renderMissingInspector(pin: InspectorPin): void {
  const panel = required<HTMLElement>('#route-query-panel');
  const icon = required<HTMLElement>('#route-query-icon');
  const title = required<HTMLElement>('#route-query-title');
  const subtitle = required<HTMLElement>('#route-query-subtitle');
  const summary = required<HTMLElement>('#route-query-summary');
  icon.textContent = '·';
  title.textContent = pin.title;
  subtitle.textContent = 'Object no longer present';
  summary.replaceChildren();
  const message = document.createElement('p');
  message.className = 'inspector-empty-state';
  message.textContent = 'This pinned target no longer exists at its original tile.';
  summary.append(message);
  required<HTMLElement>('#tile-density-history').hidden = true;
  panel.hidden = false;
  panel.dataset.inspectorTargetId = pin.targetId;
  panel.dataset.inspectorTargetKind = pin.kind;
  positionInspectorPanel(pin.focusTileId);
}

function renderInspectorCard(target: InspectorTargetSnapshot): void {
  const panel = required<HTMLElement>('#route-query-panel');
  const icon = required<HTMLElement>('#route-query-icon');
  const title = required<HTMLElement>('#route-query-title');
  const subtitle = required<HTMLElement>('#route-query-subtitle');
  const summary = required<HTMLElement>('#route-query-summary');
  const connectors = document.createElement('div');
  connectors.className = 'inspector-connectors';
  connectors.dataset.inspectorTargetId = target.targetId;
  connectors.append(
    renderConnectorRow('Road', target.road),
    ...(target.rail ? [renderConnectorRow('Rail', target.rail)] : []),
    renderConnectorRow('Water', target.water),
    renderConnectorRow('Power', target.power),
  );
  icon.textContent = target.icon;
  title.textContent = target.title;
  subtitle.textContent = target.subtitle;
  const details = (target.details ?? []).map((detailText) => {
    const detail = document.createElement('p');
    detail.className = 'inspector-operation-detail';
    detail.dataset.inspectorOperationDetail = '';
    detail.textContent = detailText;
    return detail;
  });
  summary.replaceChildren(connectors, ...details);
  required<HTMLElement>('#tile-density-history').hidden = true;
  panel.dataset.inspectorTargetId = target.targetId;
  panel.dataset.inspectorTargetKind = target.kind;
  panel.hidden = false;
  positionInspectorPanel(target.focusTileId);
  window.requestAnimationFrame(() => positionInspectorPanel(target.focusTileId));
}

function refreshInspectorForState(state: MarketCityStateV2): void {
  const refreshedPins = inspectorState.pinned.map((pin) => {
    const target = targetForPin(state, pin);
    if (!target) return { ...pin, title: 'Object no longer present', icon: '·' };
    return { ...pin, title: target.title, icon: target.icon, kind: target.kind, focusTileId: target.focusTileId };
  });
  const refreshedOpen = inspectorState.open
    ? (() => {
        const target = targetForPin(state, inspectorState.open!);
        return target
          ? { ...inspectorState.open!, title: target.title, icon: target.icon, kind: target.kind, focusTileId: target.focusTileId }
          : inspectorState.open;
      })()
    : null;
  inspectorState = { open: refreshedOpen, pinned: refreshedPins };
  renderPinnedInspectorTray();
  if (!inspectorState.open) return;
  const target = targetForPin(state, inspectorState.open);
  if (!target) renderMissingInspector(inspectorState.open);
  else renderInspectorCard(target);
}

function renderInspector(state: MarketCityStateV2, coordinate: { x: number; y: number }): void {
  const target = deriveInspectorTarget(state, coordinate);
  if (!target) {
    inspectorState = { ...inspectorState, open: null };
    clearInspectedTiles();
    required<HTMLElement>('#route-query-panel').hidden = true;
    setPinnedTrayExpanded(false);
    return;
  }
  clearInspectedTiles();
  document.querySelector(`.tile[data-x="${target.x}"][data-y="${target.y}"]`)?.classList.add('inspected');
  inspectorState = reduceInspectorState(inspectorState, { type: 'open', target });
  setPinnedTrayExpanded(inspectorState.pinned.length > 0);
  renderInspectorCard(target);
}

function clearInspector(bridge: SquareGridMayorBridge): void {
  clearInspectedTiles();
  inspectorState = reduceInspectorState(inspectorState, { type: 'close' });
  required<HTMLElement>('#route-query-panel').hidden = true;
  pinnedTrayExpanded = false;
  renderPinnedInspectorTray();
  bridge.renderRouteQueryFlows([]);
}

function minimizeInspector(): void {
  inspectorState = reduceInspectorState(inspectorState, { type: 'minimize' });
  required<HTMLElement>('#route-query-panel').hidden = true;
  setPinnedTrayExpanded(true);
}

function hideInspectorForConstruction(): void {
  if (!inspectorState.open) return;
  clearInspectedTiles();
  inspectorState = { ...inspectorState, open: null };
  required<HTMLElement>('#route-query-panel').hidden = true;
  pinnedTrayExpanded = false;
  renderPinnedInspectorTray();
}

function restorePinnedInspectorCard(
  state: MarketCityStateV2,
  bridge: SquareGridMayorBridge,
  targetId: string,
): void {
  const pin = inspectorState.pinned.find(({ targetId: candidate }) => candidate === targetId);
  if (!pin) return;
  const coordinate = focusTileCoordinate(pin, state.map.size);
  inspectorState = reduceInspectorState(inspectorState, { type: 'restore', targetId });
  setPinnedTrayExpanded(true);
  clearInspectedTiles();
  bridge.centerOnTile(coordinate);
  const target = targetForPin(state, pin);
  if (target) {
    document.querySelector(`.tile[data-x="${target.x}"][data-y="${target.y}"]`)?.classList.add('inspected');
    renderInspectorCard(target);
  } else if (inspectorState.open) {
    renderMissingInspector(inspectorState.open);
  }
}

function catalogCard(
  entry: (typeof MARKET_NETWORK_CATALOG)[keyof typeof MARKET_NETWORK_CATALOG]
    | (typeof MARKET_FACILITY_CATALOG)[keyof typeof MARKET_FACILITY_CATALOG]
    | (typeof MARKET_SERVICE_ZONE_CATALOG)[keyof typeof MARKET_SERVICE_ZONE_CATALOG],
  action: string,
  close: () => void,
  bridge: SquareGridMayorBridge,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = entry.category === 'roads' || entry.category === 'transit'
    ? 'transit-catalog-item'
    : 'utility-catalog-item';
  button.dataset.catalogKind = entry.kind;
  button.dataset.catalogStatus = 'active';
  button.dataset.action = action;
  button.dataset.buildCost = String(entry.buildCost);
  button.dataset.monthlyMaintenance = String(
    'monthlyMaintenancePerTile' in entry
      ? entry.monthlyMaintenancePerTile
      : entry.monthlyMaintenance,
  );
  button.dataset.capacity = String(
    'operatingCapacity' in entry ? entry.operatingCapacity : 'storageCapacity' in entry ? entry.storageCapacity : 0,
  );
  button.setAttribute('aria-label', entry.label);
  const preview = document.createElement('span');
  preview.className = 'utility-catalog-preview shared-world-preview';
  preview.dataset.previewKind = entry.kind;
  preview.dataset.worldRenderer = 'shared-v1';
  preview.append(bridge.createCatalogWorldThumbnail({
    kind: entry.kind,
    footprint: entry.footprint,
    mode: entry.kind === 'water-pipe' || entry.kind === 'subway'
      ? 'underground'
      : entry.kind === 'landfill'
        ? 'service-zone'
        : 'monthlyMaintenancePerTile' in entry ? 'network' : 'surface',
    label: entry.label,
  }));
  const details = document.createElement('span');
  details.className = 'utility-catalog-details';
  const label = document.createElement('strong');
  label.textContent = entry.label;
  const footprint = document.createElement('small');
  footprint.textContent = `${entry.footprint.width} × ${entry.footprint.height} tiles · free placement`;
  const stats = document.createElement('span');
  stats.className = 'utility-catalog-stats';
  if ('monthlyMaintenancePerTile' in entry) {
    stats.textContent = entry.kind === 'rail' && entry.monthlyMaintenancePerTile === 0
      ? '$0/month'
      : `${formatMoney(entry.monthlyMaintenancePerTile)} per tile each month`;
  } else if ('storageCapacity' in entry) {
    stats.textContent = `${entry.monthlyIntake.toLocaleString('en-US')} tenths/tile/month · ${entry.storageCapacity.toLocaleString('en-US')} tenths capacity`;
  } else {
    const capacity = entry.operatingCapacity > 0 ? ` · capacity ${entry.operatingCapacity.toLocaleString('en-US')}` : '';
    stats.textContent = entry.kind === 'train-station' && entry.monthlyMaintenance === 0
      ? '$0/month'
      : `${formatMoney(entry.monthlyMaintenance)} each month${capacity}`;
  }
  const capabilities = document.createElement('span');
  capabilities.className = 'utility-catalog-capabilities';
  capabilities.textContent = entry.capabilities.slice(0, 3).map((item) => item.replaceAll('-', ' ')).join(' · ');
  details.append(label, footprint, stats, capabilities);
  button.append(preview, details);
  button.addEventListener('click', () => {
    close();
    bridge.selectAction(action);
  });
  return button;
}

function bindCatalogs(bridge: SquareGridMayorBridge): void {
  const utilityDialog = required<HTMLDialogElement>('#utility-catalog-dialog');
  const transitDialog = required<HTMLDialogElement>('#transit-catalog-dialog');
  const publicServiceDialog = required<HTMLDialogElement>('#public-service-catalog-dialog');
  const openUtility = (): void => {
    const title = required<HTMLElement>('#utility-catalog-title');
    const summary = required<HTMLElement>('#utility-catalog-summary');
    const grid = required<HTMLElement>('#utility-catalog-grid');
    const entries = [
      MARKET_NETWORK_CATALOG['power-line'],
      MARKET_FACILITY_CATALOG['coal-power-plant'],
      MARKET_FACILITY_CATALOG['gas-power-plant'],
      MARKET_FACILITY_CATALOG['nuclear-power-plant'],
      MARKET_FACILITY_CATALOG['wind-turbine'],
      MARKET_FACILITY_CATALOG['solar-plant'],
    ];
    title.textContent = 'Power';
    summary.textContent = 'Plants need road access to go live. Power Lines can cross ordinary Roads and Rail; zones and lines conduct orthogonally, with one road gap also bridged.';
    grid.replaceChildren(...entries.map((entry) => catalogCard(
      entry,
      entry.kind === 'power-line' ? 'power-line' : `facility:${entry.kind}`,
      () => utilityDialog.close(),
      bridge,
    )));
    if (!utilityDialog.open) utilityDialog.showModal();
  };
  const openWater = (): void => {
    const title = required<HTMLElement>('#utility-catalog-title');
    const summary = required<HTMLElement>('#utility-catalog-summary');
    const grid = required<HTMLElement>('#utility-catalog-grid');
    const entries = [
      MARKET_NETWORK_CATALOG['water-pipe'],
      MARKET_FACILITY_CATALOG['water-tower'],
      MARKET_FACILITY_CATALOG['coastal-water-pump'],
      MARKET_FACILITY_CATALOG['water-treatment-plant'],
    ];
    title.textContent = 'Water';
    summary.textContent = 'Pipes are underground and may coexist with surface construction. Water facilities need road access, live power, and a pipe connection; Coastal Water Pumps also require shoreline. Source-fed pipes cover Manhattan radius seven.';
    grid.replaceChildren(...entries.map((entry) => catalogCard(
      entry,
      entry.kind === 'water-pipe' ? 'network:water-pipe' : entry.kind === 'subway' ? 'network:subway' : `facility:${entry.kind}`,
      () => utilityDialog.close(),
      bridge,
    )));
    if (!utilityDialog.open) utilityDialog.showModal();
  };
  document.querySelectorAll<HTMLButtonElement>('[data-utility-category]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.utilityCategory === 'power') openUtility();
      if (button.dataset.utilityCategory === 'water') openWater();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-public-service-category="fire"]').forEach((button) => {
    button.addEventListener('click', () => {
      hidePoliceBudget();
      setText('#public-service-catalog-title', 'Fire');
      setText('#public-service-catalog-summary', `Stations divide ${MARKET_CITY_RULES.fire.suppression.toFixed(2)} suppression across reachable building fires inside Manhattan radius ${MARKET_CITY_RULES.fire.stationRadius}. A station needs a road and power to work; water is not required.`);
      required<HTMLElement>('#public-service-catalog-grid').replaceChildren(catalogCard(
        MARKET_FACILITY_CATALOG['fire-station'],
        'facility:fire-station',
        () => publicServiceDialog.close(),
        bridge,
      ));
      if (!publicServiceDialog.open) publicServiceDialog.showModal();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-public-service-category="safety"]').forEach((button) => {
    button.addEventListener('click', () => {
      setText('#public-service-catalog-title', 'Police');
      setText('#public-service-catalog-summary', `A road-served, powered station grants +1 building height inside Manhattan radius ${MARKET_CITY_RULES.police.stationRadius}, whatever the crime rate. The force itself is citywide: its funding sets one derelict rate for the whole map, which shifts every height cap between +1 and -3.`);
      required<HTMLElement>('#public-service-catalog-grid').replaceChildren(catalogCard(
        MARKET_FACILITY_CATALOG['police-station'],
        'facility:police-station',
        () => publicServiceDialog.close(),
        bridge,
      ));
      policeBudgetRefresh?.();
      if (!publicServiceDialog.open) publicServiceDialog.showModal();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-public-service-category="waste"]').forEach((button) => {
    button.addEventListener('click', () => {
      hidePoliceBudget();
      setText('#public-service-catalog-title', 'Waste');
      setText('#public-service-catalog-summary', 'Each cardinally contiguous landfill area needs direct Road or Avenue contact before it collects citywide waste. Each tile accepts 100 tenths each month and stores up to 10,000. Stored garbage cannot be removed or flooded.');
      required<HTMLElement>('#public-service-catalog-grid').replaceChildren(catalogCard(
        MARKET_SERVICE_ZONE_CATALOG.landfill,
        'zone-landfill',
        () => publicServiceDialog.close(),
        bridge,
      ));
      if (!publicServiceDialog.open) publicServiceDialog.showModal();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-transit-category="roads"]').forEach((button) => {
    button.addEventListener('click', () => {
      setText('#transit-catalog-title', 'Roads');
      setText('#transit-catalog-summary', 'Roads and minimum 2 × 2 avenues form one access surface. Hover an Avenue edge to aim its first block, click to place it, or drag an ordinary road-style route; its opposing right-hand carriageway places atomically and each occupied tile has ordinary road maintenance.');
      required<HTMLElement>('#transit-catalog-grid').replaceChildren(
        catalogCard(
          MARKET_NETWORK_CATALOG.road,
          'road',
          () => transitDialog.close(),
          bridge,
        ),
        catalogCard(
          MARKET_NETWORK_CATALOG.avenue,
          'network:avenue',
          () => transitDialog.close(),
          bridge,
        ),
      );
      if (!transitDialog.open) transitDialog.showModal();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-transit-category="rail"]').forEach((button) => {
    button.addEventListener('click', () => {
      setText('#transit-catalog-title', 'Passenger Rail & Subway');
      setText('#transit-catalog-summary', 'Rail supports curves, junctions, and road or Avenue grade crossings. Subway is a separate underground construction network: tunnels coexist below surface construction and a 1 × 1 entrance must sit directly above a purchased tunnel. Neither subway construction nor its station changes simulation in this release.');
      required<HTMLElement>('#transit-catalog-grid').replaceChildren(
        catalogCard(
          MARKET_NETWORK_CATALOG.rail,
          'network:rail',
          () => transitDialog.close(),
          bridge,
        ),
        catalogCard(
          MARKET_FACILITY_CATALOG['train-station'],
          'facility:train-station',
          () => transitDialog.close(),
          bridge,
        ),
        catalogCard(
          MARKET_NETWORK_CATALOG.subway,
          'network:subway',
          () => transitDialog.close(),
          bridge,
        ),
        catalogCard(
          MARKET_FACILITY_CATALOG['subway-station'],
          'facility:subway-station',
          () => transitDialog.close(),
          bridge,
        ),
      );
      if (!transitDialog.open) transitDialog.showModal();
    });
  });
}

async function loadOrCreateController(
  persistence: MarketCityPersistence,
  cityId: string,
  params: URLSearchParams,
  engine: MarketCityControllerEngine<MarketCityCreateOptions> = DEFAULT_MARKET_CITY_CONTROLLER_ENGINE,
): Promise<MarketCityController> {
  const dependencies = { persistence, engine };
  try {
    return await MarketCityController.load(cityId, dependencies);
  } catch (error) {
    if (!(error instanceof MarketCityNotFoundError)) throw error;
  }
  const querySeed = Number(params.get('seed'));
  const seed = Number.isSafeInteger(querySeed) ? querySeed : seedFromText(cityId);
  const controller = MarketCityController.create({
    identity: {
      cityId,
      cityName: cleanText(params.get('newCityName'), 'New Market City'),
      mayorName: cleanText(params.get('newMayorName'), 'Mayor'),
      seed,
      createdAt: new Date().toISOString(),
    },
  }, dependencies);
  await controller.save();
  return controller;
}

installBuildIdentity();
const bridge = (window as unknown as { squareGridMayor?: SquareGridMayorBridge }).squareGridMayor;
if (!bridge) throw new Error('The retained square-grid renderer did not initialize.');
const client = required<HTMLElement>('.city-client');
const params = new URLSearchParams(window.location.search);
const fixture = params.get('fixture');
const visualFixture = ['rotation-lab', 'renderer-regression-fixture'].includes(fixture ?? '');

if (visualFixture) {
  client.removeAttribute('data-session-gate');
} else if (params.get('profile') !== 'lab' && !params.has('city')) {
  const persistence = new BrowserMarketCityPersistence();
  await showOpening(persistence);
} else {
  const ephemeral = params.get('profile') === 'lab' && !params.has('city');
  const cityId = params.get('city') ?? 'market-lab';
  const canonicalPersistence = new BrowserMarketCityPersistence();
  const persistence: MarketCityPersistence = ephemeral
    ? new MemoryMarketCityPersistence()
    : canonicalPersistence;
  const controller = await loadOrCreateController(
    persistence,
    cityId,
    params,
    DEFAULT_MARKET_CITY_CONTROLLER_ENGINE,
  );
  let runtime!: MarketCityDashboardRuntime;
  let playbackTimer: number | null = null;
  let playbackSpeed: MarketPlaybackSpeed = 0;

  const schedulePlayback = (state: MarketCityStateV2): void => {
    const speed = state.clock.paused ? 0 : state.clock.speed;
    if (speed === 0) {
      if (playbackTimer !== null) window.clearTimeout(playbackTimer);
      playbackTimer = null;
      playbackSpeed = 0;
      return;
    }
    if (playbackTimer !== null && playbackSpeed === speed) return;
    if (playbackTimer !== null) window.clearTimeout(playbackTimer);
    playbackSpeed = speed;
    const delay = speed === 1 ? 1_000 : speed === 2 ? 500 : 250;
    playbackTimer = window.setTimeout(() => {
      playbackTimer = null;
      runtime.step(1);
    }, delay);
  };

  const hooks = {
    render(state: MarketCityStateV2, update: MarketDashboardRenderUpdate): void {
      const rendererState = toSquareGridRendererState(state);
      bridge.renderSynthCityState(rendererState, update);
      bridge.renderSynthCityStatus(rendererState);
      renderMetrics(state, runtime?.canUndo ?? false);
      refreshInspectorForState(state);
      schedulePlayback(state);
    },
    inspect(coordinate: { x: number; y: number }): void {
      renderInspector(runtime.snapshot(), coordinate);
      bridge.renderRouteQueryFlows([]);
    },
    clearInspection(): void {
      clearInspector(bridge);
    },
  };
  runtime = new MarketCityDashboardRuntime(controller, persistence, hooks);
  onAssetVisualSelectionChange(() => {
    const visualState = runtime.snapshot();
    bridge.renderSynthCityState(toSquareGridRendererState(visualState));
    bridge.renderSynthCityStatus(toSquareGridRendererState(visualState));
    bridge.refreshCatalogVisuals();
    refreshInspectorForState(visualState);
  });
  restorePinnedInspector = (targetId) => restorePinnedInspectorCard(runtime.snapshot(), bridge, targetId);
  bridge.onViewStateChange(() => {
    refreshInspectorForState(runtime.snapshot());
  });
  window.addEventListener('synthcity-construction-action-selected', hideInspectorForConstruction);

  bindCatalogs(bridge);
  required<HTMLButtonElement>('#simulation-speed').addEventListener('click', () => {
    const state = runtime.snapshot();
    const current = state.clock.paused ? 0 : state.clock.speed;
    runtime.setSpeed(((current + 1) % 4) as MarketPlaybackSpeed);
  });
  required<HTMLButtonElement>('#simulation-undo').addEventListener('click', () => { void runtime.undo(); });
  required<HTMLButtonElement>('#rci-matrix-button').addEventListener('click', () => {
    const dialog = required<HTMLDialogElement>('#rci-matrix-dialog');
    if (!dialog.open) dialog.showModal();
  });
  required<HTMLButtonElement>('#inspector-minimize').addEventListener('click', minimizeInspector);
  required<HTMLButtonElement>('#pinned-inspector-toggle').addEventListener('click', () => {
    setPinnedTrayExpanded(!pinnedTrayExpanded);
  });
  required<HTMLButtonElement>('#close-route-query').addEventListener('click', () => runtime.clearQuery());

  const settings = required<HTMLDialogElement>('#city-settings-dialog');
  required<HTMLButtonElement>('#city-settings-open').addEventListener('click', () => {
    const state = runtime.snapshot();
    required<HTMLInputElement>('#city-settings-name').value = state.identity.cityName;
    required<HTMLSelectElement>('#city-settings-fire-difficulty').value = state.clock.fireDifficulty;
    required<HTMLInputElement>('#city-settings-vertical-development-level').value = String(
      state.market.verticalDevelopmentLevel,
    );
    setText('#city-settings-mayor', state.identity.mayorName);
    if (!settings.open) settings.showModal();
  });
  required<HTMLButtonElement>('#city-settings-save').addEventListener('click', () => {
    const cityName = cleanText(required<HTMLInputElement>('#city-settings-name').value, '');
    const difficulty = required<HTMLSelectElement>('#city-settings-fire-difficulty').value as MarketFireDifficulty;
    const verticalLevel = Number(required<HTMLInputElement>('#city-settings-vertical-development-level').value);
    try {
      if (!cityName) throw new TypeError('cityName must be a non-empty string.');
      if (!Number.isInteger(verticalLevel)) throw new TypeError('Vertical Development Level must be an integer.');
      if (verticalLevel < 1 || verticalLevel > 10) {
        throw new RangeError('Vertical Development Level must be between 1 and 10.');
      }
      runtime.updateIdentity({ cityName });
      runtime.setFireDifficulty(difficulty);
      runtime.setVerticalDevelopmentLevel(verticalLevel);
      settings.close();
      setText('#ticker-copy', 'City name, fire difficulty, and vertical level saved.');
    } catch (error) {
      setText('#ticker-copy', error instanceof Error ? error.message : 'City settings were refused.');
    }
  });
  const deleteDialog = required<HTMLDialogElement>('#city-delete-dialog');
  required<HTMLButtonElement>('#city-delete-open').addEventListener('click', () => {
    settings.close();
    if (!deleteDialog.open) deleteDialog.showModal();
  });
  required<HTMLButtonElement>('#city-delete-cancel').addEventListener('click', () => deleteDialog.close());
  required<HTMLButtonElement>('#city-delete-confirm').addEventListener('click', () => {
    void runtime.delete().then(() => window.location.assign(openingUrl()));
  });

  policeBudgetRefresh = wirePoliceBudget(runtime);

  client.removeAttribute('data-session-gate');
  bridge.registerSynthCityController(runtime);
  window.marketCityDashboard = {
    hash: () => runtime.hash(),
    snapshot: () => runtime.snapshot(),
    canonicalSnapshot: () => runtime.canonicalSnapshot(),
    preview: (command) => runtime.preview(command),
    commit: (plan) => runtime.commit(plan),
    dispatch: (command) => runtime.dispatch(command),
    step: (months = 1) => runtime.step(months),
    setSpeed: (speed) => runtime.setSpeed(speed),
    setFireDifficulty: (difficulty) => runtime.setFireDifficulty(difficulty),
    setVerticalDevelopmentLevel: (level) => runtime.setVerticalDevelopmentLevel(level),
    undo: () => runtime.undo(),
    save: () => runtime.save(),
    reload: () => runtime.reload(),
    whenDurable: () => runtime.whenDurable(),
  };

  if (params.has('newCityName') || params.has('newMayorName')) {
    const clean = new URL(window.location.href);
    clean.searchParams.delete('newCityName');
    clean.searchParams.delete('newMayorName');
    history.replaceState(null, '', `${clean.pathname}${clean.search}${clean.hash}`);
  }
}

// Keep the economic constants inspectable in browser evidence without adding
// a production coefficient editor.
document.documentElement.dataset.marketTaxRate = String(MARKET_CITY_RULES.taxRate);
