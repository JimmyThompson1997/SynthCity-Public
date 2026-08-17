import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const shell = readFileSync(
  resolve(process.cwd(), 'design-review/square-grid-mayor.html'),
  'utf8',
);

describe('MarketCity playable shell cutover', () => {
  it('boots only the fresh market dashboard on a fixed 48 by 48 map', () => {
    expect(shell).toContain('aria-label="48 by 48 square city grid"');
    expect(shell).toContain('const CITY_GRID_CELLS = 48;');
    expect(shell).toContain('<script type="module" src="/src/market-city-dashboard/index.ts"></script>');
    expect(shell).not.toContain('/src/synthcity-dashboard/index.ts');
  });

  it('shows only active transport, utility, public fire, zoning, and terrain controls', () => {
    expect(shell).toContain('aria-label="Roads"');
    expect(shell).toContain('aria-label="Power"');
    expect(shell).toContain('data-panel="public-services"');
    expect(shell).toContain('aria-label="Public Services"');
    expect(shell).toContain('aria-label="Passenger Rail"');
    expect(shell).toContain('Rail and train stations');
    expect(shell).toContain('aria-label="Water"');
    expect(shell).toContain('Pipes, sources, and treatment');
    expect(shell).toContain('data-city-view-option="underground"');
    expect(shell).toContain('Underground View');
    expect(shell).not.toContain('data-city-view-option="water"');
  });

  it('keeps Fire and Police in a dedicated Public Services tray and out of Utilities', () => {
    const utilities = shell.match(/<section class="utilities-tray"[\s\S]*?<\/section>/)?.[0] ?? '';
    const publicServices = shell.match(/<section class="synthcity-tray public-services-tray"[\s\S]*?<\/section>/)?.[0] ?? '';

    expect(utilities).toContain('data-utility-category="power"');
    expect(utilities).not.toContain('data-utility-category="fire"');
    expect(utilities).not.toContain('Fire protection');
    expect(publicServices).toContain('<h2>Public Services</h2>');
    expect(publicServices).toContain('data-public-service-category="fire"');
    expect(publicServices).toContain('aria-label="Fire"');
    expect(publicServices).not.toMatch(/Health|School|Park/i);
    expect(shell).toContain('id="public-service-catalog-dialog"');
    expect(shell).toContain('aria-label="Close public services catalogue"');
  });

  it('publishes operational fire status in both inspector and hover copy', () => {
    expect(shell).toContain('facility.operational');
    expect(shell).toContain('facility.inactiveReason');
    expect(shell).toContain("facility.operational ? 'operational' : 'inactive'");
  });

  it('removes old progression and job-matching language from the playable UI', () => {
    expect(shell).not.toContain('city-level-button');
    expect(shell).not.toContain('city-level-dialog');
    expect(shell).not.toContain('Infrastructure Jobs');
    expect(shell).not.toContain('Workforce');
    expect(shell).not.toContain('Commercial Jobs');
    expect(shell).not.toContain('Industrial Jobs');
    expect(shell).toContain('Fixed tax 2.5%');
    expect(shell).toContain('Monthly operating cost');
  });
});
