import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  clamp,
  coordinateToIndex,
  indexToCoordinate,
  manhattanDistance,
  mix32,
  orthogonalNeighbors,
  solveMarketTargets,
  tileHash,
  tilesWithinManhattan,
} from '../../src/market-city/math';

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

describe('market-city grid math', () => {
  it('clamps values at both inclusive bounds', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(0.4, 0, 1)).toBe(0.4);
    expect(clamp(2, 0, 1)).toBe(1);
  });

  it('round-trips coordinates and indices on default and custom grids', () => {
    expect(coordinateToIndex(0, 0)).toBe(0);
    expect(coordinateToIndex(47, 47)).toBe(2_303);
    expect(indexToCoordinate(2_303)).toEqual({ x: 47, y: 47 });

    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        expect(indexToCoordinate(coordinateToIndex(x, y, 5), 5)).toEqual({ x, y });
      }
    }
  });

  it('rejects invalid grid arguments instead of wrapping into another row', () => {
    expect(() => coordinateToIndex(-1, 0, 5)).toThrow(RangeError);
    expect(() => coordinateToIndex(5, 0, 5)).toThrow(RangeError);
    expect(() => indexToCoordinate(25, 5)).toThrow(RangeError);
    expect(() => indexToCoordinate(0, 0)).toThrow(RangeError);
  });

  it('computes Manhattan distance from tile indices', () => {
    expect(manhattanDistance(coordinateToIndex(0, 0, 5), coordinateToIndex(4, 3, 5), 5)).toBe(7);
    expect(manhattanDistance(coordinateToIndex(2, 2, 5), coordinateToIndex(2, 2, 5), 5)).toBe(0);
  });

  it('enumerates clipped Manhattan diamonds in stable tile order', () => {
    expect(tilesWithinManhattan(coordinateToIndex(2, 2, 5), 1, 5)).toEqual([7, 11, 12, 13, 17]);
    expect(tilesWithinManhattan(coordinateToIndex(0, 0, 5), 2, 5)).toEqual([0, 1, 2, 5, 6, 10]);
    expect(tilesWithinManhattan(coordinateToIndex(4, 4, 5), 0, 5)).toEqual([24]);
  });

  it('returns orthogonal neighbors without wrapping at map edges', () => {
    expect(orthogonalNeighbors(coordinateToIndex(0, 0, 5), 5)).toEqual([1, 5]);
    expect(orthogonalNeighbors(coordinateToIndex(2, 2, 5), 5)).toEqual([7, 11, 13, 17]);
    expect(orthogonalNeighbors(coordinateToIndex(4, 4, 5), 5)).toEqual([19, 23]);
  });
});

describe('deterministic hashes', () => {
  it.each([
    [0, 493_009_611],
    [1, 1_059_954_845],
    [101, 3_917_664_074],
    [202, 2_113_080_274],
    [303, 721_712_632],
    [65_535, 947_637_035],
    [4_294_967_295, 4_288_662_295],
  ])('matches the source mix32 vector for %d', (input, expected) => {
    expect(mix32(input)).toBe(expected);
  });

  it('uses the source coordinate hash with unsigned Math.imul semantics', () => {
    expect(tileHash(0, 0)).toBe(0);
    expect(tileHash(1, 0)).toBe(6_378);
    expect(tileHash(0, 1)).toBe(60_101);
    expect(tileHash(5, 9)).toBe(12_054);
    expect(tileHash(5, 9, 7)).toBe(22_822);
  });
});

describe('demand-conserving market target solver', () => {
  it('fixes the source saturated-lot counterexample', () => {
    const result = solveMarketTargets([1, 0.5], [1, 1], 1.2, 0.1);

    expect(result.margin).toBeCloseTo(0.48, 12);
    expect(result.targets[0]).toBeCloseTo(1, 12);
    expect(result.targets[1]).toBeCloseTo(0.2, 12);
    expect(sum(result.targets)).toBeCloseTo(1.2, 12);
  });

  it('handles empty markets, zero demand, negative caps, and excess demand', () => {
    expect(solveMarketTargets([], [], 5)).toEqual({ margin: 0, targets: [] });
    expect(solveMarketTargets([0.8, 0.2], [1, 2], 0).targets).toEqual([0, 0]);
    expect(solveMarketTargets([0.8, 0.2], [-3, 2], 99).targets).toEqual([0, 2]);
    expect(solveMarketTargets([0.8, 0.2], [1, 2], 99).targets).toEqual([1, 2]);
  });

  it('rejects malformed markets and invalid market shape', () => {
    expect(() => solveMarketTargets([1], [1, 2], 1)).toThrow(RangeError);
    expect(() => solveMarketTargets([Number.NaN], [1], 1)).toThrow(TypeError);
    expect(() => solveMarketTargets([1], [1], Number.NaN)).toThrow(TypeError);
    expect(() => solveMarketTargets([1], [1], 1, 0)).toThrow(RangeError);
  });

  it('keeps every target in bounds and conserves all feasible demand', () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        value: fc.integer({ min: -500, max: 500 }).map((value) => value / 100),
        cap: fc.integer({ min: -20, max: 500 }).map((value) => value / 100),
      }), { maxLength: 20 }),
      fc.integer({ min: -100, max: 10_000 }).map((value) => value / 100),
      fc.integer({ min: 1, max: 200 }).map((value) => value / 100),
      (lots, demand, k) => {
        const values = lots.map(({ value }) => value);
        const caps = lots.map(({ cap }) => cap);
        const result = solveMarketTargets(values, caps, demand, k);
        const expected = Math.min(Math.max(0, demand), sum(caps.map((cap) => Math.max(0, cap))));

        result.targets.forEach((target, index) => {
          expect(target).toBeGreaterThanOrEqual(0);
          expect(target).toBeLessThanOrEqual(Math.max(0, caps[index] ?? 0) + 1e-12);
        });
        expect(Math.abs(sum(result.targets) - expected)).toBeLessThanOrEqual(1e-9);
      },
    ), { numRuns: 2_000 });
  });

  it('never lowers total allocation when demand rises', () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        value: fc.integer({ min: -100, max: 100 }).map((value) => value / 20),
        cap: fc.integer({ min: 0, max: 100 }).map((value) => value / 20),
      }), { maxLength: 16 }),
      fc.integer({ min: 0, max: 1_000 }).map((value) => value / 20),
      fc.integer({ min: 0, max: 1_000 }).map((value) => value / 20),
      (lots, leftDemand, rightDemand) => {
        const lowerDemand = Math.min(leftDemand, rightDemand);
        const higherDemand = Math.max(leftDemand, rightDemand);
        const values = lots.map(({ value }) => value);
        const caps = lots.map(({ cap }) => cap);
        const lower = sum(solveMarketTargets(values, caps, lowerDemand).targets);
        const higher = sum(solveMarketTargets(values, caps, higherDemand).targets);

        expect(higher + 1e-10).toBeGreaterThanOrEqual(lower);
      },
    ), { numRuns: 1_000 });
  });

  it('is deterministic and stable when lots are permuted', () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        value: fc.integer({ min: -50, max: 50 }),
        cap: fc.integer({ min: 0, max: 20 }),
      }), { maxLength: 20 }),
      fc.integer({ min: 0, max: 200 }),
      (lots, demand) => {
        const values = lots.map(({ value }) => value);
        const caps = lots.map(({ cap }) => cap);
        const first = solveMarketTargets(values, caps, demand);
        expect(solveMarketTargets(values, caps, demand)).toEqual(first);

        if (lots.length < 2) return;
        const permutation = lots.map((_, index) => lots.length - 1 - index);
        const permuted = solveMarketTargets(
          permutation.map((index) => values[index]!),
          permutation.map((index) => caps[index]!),
          demand,
        );
        const restored = new Array<number>(lots.length);
        permutation.forEach((originalIndex, permutedIndex) => {
          restored[originalIndex] = permuted.targets[permutedIndex]!;
        });

        expect(permuted.margin).toBeCloseTo(first.margin, 12);
        restored.forEach((target, index) => expect(target).toBeCloseTo(first.targets[index]!, 12));
      },
    ), { numRuns: 1_000 });
  });

  it('gives an equal-cap, higher-value lot no less density', () => {
    fc.assert(fc.property(
      fc.integer({ min: -500, max: 500 }).map((value) => value / 100),
      fc.integer({ min: -500, max: 500 }).map((value) => value / 100),
      fc.integer({ min: 1, max: 500 }).map((value) => value / 100),
      fc.integer({ min: 0, max: 1_000 }).map((value) => value / 100),
      (leftValue, rightValue, cap, demand) => {
        const high = Math.max(leftValue, rightValue);
        const low = Math.min(leftValue, rightValue);
        const targets = solveMarketTargets([high, low], [cap, cap], demand).targets;
        expect(targets[0]! + 1e-12).toBeGreaterThanOrEqual(targets[1]!);
      },
    ), { numRuns: 1_000 });
  });
});
