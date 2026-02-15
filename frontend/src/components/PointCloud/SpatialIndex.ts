/**
 * Octree-based spatial index for O(log N) proximity queries.
 * Replaces O(N²) distance calculations for edge computation.
 */

import * as THREE from 'three';

interface OctreeNode {
  bounds: THREE.Box3;
  points: Array<{ id: string; position: THREE.Vector3 }>;
  children: OctreeNode[] | null;
}

const MAX_POINTS_PER_NODE = 8;
const MAX_DEPTH = 10;

export class SpatialIndex {
  private root: OctreeNode;
  private allPoints: Map<string, THREE.Vector3>;

  constructor(bounds?: THREE.Box3) {
    const defaultBounds = bounds || new THREE.Box3(
      new THREE.Vector3(-2, -2, -2),
      new THREE.Vector3(2, 2, 2)
    );
    this.root = this.createNode(defaultBounds);
    this.allPoints = new Map();
  }

  private createNode(bounds: THREE.Box3): OctreeNode {
    return {
      bounds,
      points: [],
      children: null,
    };
  }

  /**
   * Build the index from an array of vectors with projections.
   */
  static fromVectors(vectors: Array<{ id: string; projection?: number[] | null }>): SpatialIndex {
    // Calculate bounds from data
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    const validPoints: Array<{ id: string; position: THREE.Vector3 }> = [];

    for (const v of vectors) {
      if (!v.projection || v.projection.length < 3) continue;
      const [x, y, z] = v.projection;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
      validPoints.push({ id: v.id, position: new THREE.Vector3(x, y, z) });
    }

    // Add padding to bounds
    const padding = 0.1;
    const bounds = new THREE.Box3(
      new THREE.Vector3(minX - padding, minY - padding, minZ - padding),
      new THREE.Vector3(maxX + padding, maxY + padding, maxZ + padding)
    );

    const index = new SpatialIndex(bounds);
    for (const point of validPoints) {
      index.insert(point.id, point.position);
    }

    return index;
  }

  /**
   * Insert a point into the octree.
   */
  insert(id: string, position: THREE.Vector3): void {
    this.allPoints.set(id, position.clone());
    this.insertIntoNode(this.root, { id, position }, 0);
  }

  private insertIntoNode(
    node: OctreeNode,
    point: { id: string; position: THREE.Vector3 },
    depth: number
  ): void {
    // If we haven't subdivided yet and have room, add here
    if (node.children === null) {
      node.points.push(point);

      // Subdivide if we exceed capacity and haven't hit max depth
      if (node.points.length > MAX_POINTS_PER_NODE && depth < MAX_DEPTH) {
        this.subdivide(node);
        // Redistribute points to children
        const pointsToRedistribute = node.points;
        node.points = [];
        for (const p of pointsToRedistribute) {
          this.insertIntoNode(node, p, depth);
        }
      }
      return;
    }

    // Find the child that contains this point
    for (const child of node.children) {
      if (child.bounds.containsPoint(point.position)) {
        this.insertIntoNode(child, point, depth + 1);
        return;
      }
    }

    // Point is outside all children (shouldn't happen with correct bounds)
    // Store in this node as fallback
    node.points.push(point);
  }

  private subdivide(node: OctreeNode): void {
    const { min, max } = node.bounds;
    const mid = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);

    node.children = [];

    // Create 8 child octants
    for (let x = 0; x < 2; x++) {
      for (let y = 0; y < 2; y++) {
        for (let z = 0; z < 2; z++) {
          const childMin = new THREE.Vector3(
            x === 0 ? min.x : mid.x,
            y === 0 ? min.y : mid.y,
            z === 0 ? min.z : mid.z
          );
          const childMax = new THREE.Vector3(
            x === 0 ? mid.x : max.x,
            y === 0 ? mid.y : max.y,
            z === 0 ? mid.z : max.z
          );
          node.children.push(this.createNode(new THREE.Box3(childMin, childMax)));
        }
      }
    }
  }

  /**
   * Query all points within a radius of a center point.
   * O(log N) average case.
   */
  queryRadius(center: THREE.Vector3, radius: number): Array<{ id: string; position: THREE.Vector3; distance: number }> {
    const results: Array<{ id: string; position: THREE.Vector3; distance: number }> = [];
    const radiusSq = radius * radius;

    this.queryRadiusNode(this.root, center, radius, radiusSq, results);

    // Sort by distance
    results.sort((a, b) => a.distance - b.distance);
    return results;
  }

  private queryRadiusNode(
    node: OctreeNode,
    center: THREE.Vector3,
    radius: number,
    radiusSq: number,
    results: Array<{ id: string; position: THREE.Vector3; distance: number }>
  ): void {
    // Check if sphere intersects this node's bounds
    if (!this.sphereIntersectsBox(center, radius, node.bounds)) {
      return;
    }

    // Check points in this node
    for (const point of node.points) {
      const distSq = point.position.distanceToSquared(center);
      if (distSq <= radiusSq) {
        results.push({
          id: point.id,
          position: point.position.clone(),
          distance: Math.sqrt(distSq),
        });
      }
    }

    // Recurse into children
    if (node.children) {
      for (const child of node.children) {
        this.queryRadiusNode(child, center, radius, radiusSq, results);
      }
    }
  }

  private sphereIntersectsBox(center: THREE.Vector3, radius: number, box: THREE.Box3): boolean {
    // Find closest point on box to sphere center
    const closest = new THREE.Vector3(
      Math.max(box.min.x, Math.min(center.x, box.max.x)),
      Math.max(box.min.y, Math.min(center.y, box.max.y)),
      Math.max(box.min.z, Math.min(center.z, box.max.z))
    );
    return closest.distanceToSquared(center) <= radius * radius;
  }

  /**
   * Find all pairs of points within a given distance threshold.
   * Much more efficient than O(N²) for sparse data.
   */
  queryAllPairsWithinDistance(
    threshold: number,
    maxPairs: number = 500
  ): Array<{ id1: string; id2: string; distance: number }> {
    const pairs: Array<{ id1: string; id2: string; distance: number }> = [];
    const visited = new Set<string>();

    // For each point, find neighbors within threshold
    for (const [id, position] of this.allPoints) {
      visited.add(id);
      const neighbors = this.queryRadius(position, threshold);

      for (const neighbor of neighbors) {
        // Skip self and already visited pairs
        if (neighbor.id === id || visited.has(neighbor.id)) continue;

        pairs.push({
          id1: id,
          id2: neighbor.id,
          distance: neighbor.distance,
        });

        // Early exit if we have enough pairs
        if (pairs.length >= maxPairs) {
          // Sort by distance and return closest pairs
          pairs.sort((a, b) => a.distance - b.distance);
          return pairs.slice(0, maxPairs);
        }
      }
    }

    // Sort by distance
    pairs.sort((a, b) => a.distance - b.distance);
    return pairs.slice(0, maxPairs);
  }

  /**
   * Get position for a specific ID.
   */
  getPosition(id: string): THREE.Vector3 | undefined {
    return this.allPoints.get(id);
  }

  /**
   * Get all point IDs.
   */
  getAllIds(): string[] {
    return Array.from(this.allPoints.keys());
  }

  /**
   * Get total number of points.
   */
  get size(): number {
    return this.allPoints.size;
  }
}
