/**
 * Deterministic painter ordering for the retained terrain-anchored SVG scene.
 * Every visual supplies the point where it meets the ground. Camera rotation
 * then determines paint depth; insertion and placement history never do.
 */

export interface WorldRenderAnchor {
  x: number;
  y: number;
  elevation: number;
}

export interface WorldRenderContext {
  mapCells: number;
  rotation: number;
  baselineHeight: number;
}

export interface WorldRenderItem<T = unknown> {
  id: string;
  sublayer: number;
  anchor: WorldRenderAnchor;
  payload: T;
}

function normalizedRotation(rotation: number): number {
  return ((rotation % 4) + 4) % 4;
}

export function rotateWorldAnchor(
  anchor: Pick<WorldRenderAnchor, 'x' | 'y'>,
  rotation: number,
  mapCells: number,
): Pick<WorldRenderAnchor, 'x' | 'y'> {
  switch (normalizedRotation(rotation)) {
    case 1: return { x: mapCells - anchor.y, y: anchor.x };
    case 2: return { x: mapCells - anchor.x, y: mapCells - anchor.y };
    case 3: return { x: anchor.y, y: mapCells - anchor.x };
    default: return { x: anchor.x, y: anchor.y };
  }
}

export function worldPainterDepth(anchor: WorldRenderAnchor, context: WorldRenderContext): number {
  const view = rotateWorldAnchor(anchor, context.rotation, context.mapCells);
  return view.x + view.y - (anchor.elevation - context.baselineHeight);
}

/**
 * A merged footprint must paint at the depth of the occupied cell closest to
 * the camera.  Using its centroid lets a later one-cell neighbor overpaint the
 * front edge of L and 2x2 lots even though their simulation cells never
 * overlap.
 */
export function nearestWorldRenderAnchor(
  anchors: readonly WorldRenderAnchor[],
  context: WorldRenderContext,
): WorldRenderAnchor {
  if (!anchors.length) throw new RangeError('A world footprint requires at least one render anchor.');
  let nearest = anchors[0]!;
  let nearestDepth = worldPainterDepth(nearest, context);
  for (let index = 1; index < anchors.length; index += 1) {
    const candidate = anchors[index]!;
    const candidateDepth = worldPainterDepth(candidate, context);
    if (candidateDepth > nearestDepth) {
      nearest = candidate;
      nearestDepth = candidateDepth;
    }
  }
  return nearest;
}

export function orderWorldRenderItems<T>(
  items: readonly WorldRenderItem<T>[],
  context: WorldRenderContext,
): WorldRenderItem<T>[] {
  return [...items].sort((left, right) => {
    const depthDifference = worldPainterDepth(left.anchor, context) - worldPainterDepth(right.anchor, context);
    if (Math.abs(depthDifference) > 1e-9) return depthDifference;
    const sublayerDifference = left.sublayer - right.sublayer;
    return sublayerDifference || left.id.localeCompare(right.id);
  });
}
