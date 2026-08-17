const DEFAULT_MILLISECONDS_PER_TILE = 700;
const DEFAULT_TERMINAL_PAUSE_MS = 500;

function finiteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be a finite non-negative number.`);
  return value;
}
function validPath(pathTileIds) {
  if (!Array.isArray(pathTileIds) || pathTileIds.length < 2) {
    throw new RangeError('A rail shuttle path requires at least two tile IDs.');
  }
  pathTileIds.forEach((tileId, index) => {
    if (!Number.isSafeInteger(tileId) || tileId < 0) {
      throw new TypeError(`Rail shuttle path tile ${index} must be a non-negative safe integer.`);
    }
    if (index > 0 && tileId === pathTileIds[index - 1]) {
      throw new RangeError('Adjacent rail shuttle path entries must be distinct.');
    }
  });
  return pathTileIds;
}

/**
 * Derive one immutable display pose from a canonical rail path and a local UI
 * clock. The shuttle is a ping-pong animation: it pauses at each terminal,
 * reverses over the same tile path, and never writes animation state to a save.
 */
export function railShuttlePose(pathTileIds, elapsedMs, options = {}) {
  const path = validPath(pathTileIds);
  const millisecondsPerTile = options.millisecondsPerTile ?? DEFAULT_MILLISECONDS_PER_TILE;
  const terminalPauseMs = options.terminalPauseMs ?? DEFAULT_TERMINAL_PAUSE_MS;
  if (!Number.isFinite(millisecondsPerTile) || millisecondsPerTile <= 0) {
    throw new RangeError('millisecondsPerTile must be a finite positive number.');
  }
  finiteNonNegative(terminalPauseMs, 'terminalPauseMs');
  finiteNonNegative(elapsedMs, 'elapsedMs');

  const segmentCount = path.length - 1;
  const travelDuration = segmentCount * millisecondsPerTile;
  const cycleDuration = travelDuration * 2 + terminalPauseMs * 2;
  const cycleElapsed = elapsedMs % cycleDuration;

  if (cycleElapsed < travelDuration) {
    const pathIndex = Math.min(segmentCount - 1, Math.floor(cycleElapsed / millisecondsPerTile));
    return {
      fromTileId: path[pathIndex],
      toTileId: path[pathIndex + 1],
      pathIndex,
      progress: (cycleElapsed - pathIndex * millisecondsPerTile) / millisecondsPerTile,
      direction: 'forward',
      atTerminal: false,
    };
  }

  if (cycleElapsed < travelDuration + terminalPauseMs) {
    return {
      fromTileId: path.at(-1),
      toTileId: path.at(-1),
      pathIndex: segmentCount,
      progress: 1,
      direction: 'forward',
      atTerminal: true,
    };
  }

  const reverseElapsed = cycleElapsed - travelDuration - terminalPauseMs;
  if (reverseElapsed < travelDuration) {
    const reverseSegment = Math.min(segmentCount - 1, Math.floor(reverseElapsed / millisecondsPerTile));
    const pathIndex = segmentCount - reverseSegment;
    return {
      fromTileId: path[pathIndex],
      toTileId: path[pathIndex - 1],
      pathIndex,
      progress: (reverseElapsed - reverseSegment * millisecondsPerTile) / millisecondsPerTile,
      direction: 'reverse',
      atTerminal: false,
    };
  }

  return {
    fromTileId: path[0],
    toTileId: path[0],
    pathIndex: 0,
    progress: 0,
    direction: 'reverse',
    atTerminal: true,
  };
}
