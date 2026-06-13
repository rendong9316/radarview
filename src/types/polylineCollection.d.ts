// Type declarations for Cesium @private APIs: PolylineCollection, Polyline
// These are exported at runtime (Cesium.js L746) but not in the public type definitions.
// Cesium version locked at 1.140.0.
import type { Cartesian3, Color, DistanceDisplayCondition, Material, Matrix4 } from 'cesium'

declare module 'cesium' {
  /**
   * A renderable polyline. Created by {@link PolylineCollection#add}, not directly.
   * @private
   */
  class Polyline {
    /** Determines if this polyline will be shown. */
    show: boolean
    /** Width in pixels. */
    width: number
    /** Whether a closing segment connects last→first position. */
    loop: boolean
    /** The polyline's material. */
    material: Material
    /** The polyline's vertex positions in world coordinates. */
    positions: Cartesian3[]
    /** User-defined object returned when this polyline is picked. */
    id: any
    /** Condition specifying at what camera distance this polyline is displayed. */
    distanceDisplayCondition?: DistanceDisplayCondition
  }

  /** @private */
  interface PolylineCollectionOptions {
    /** 4x4 transform from model to world coordinates. Default: Matrix4.IDENTITY */
    modelMatrix?: Matrix4
    /** For debugging. Default: false */
    debugShowBoundingVolume?: boolean
    /** Determines if the collection is shown. Default: true */
    show?: boolean
  }

  /** @private */
  interface PolylineOptions {
    show?: boolean
    width?: number
    loop?: boolean
    material?: Material
    positions?: Cartesian3[]
    id?: any
    distanceDisplayCondition?: DistanceDisplayCondition
  }

  /**
   * A renderable collection of polylines. All polylines in a single collection
   * are batched into one GPU draw call (instanced rendering).
   *
   * @performance Prefer one collection with many polylines over many collections with few each.
   * Organize by update frequency: static polylines in one collection, per-frame-changing in another.
   *
   * @see Polyline
   * @see PointPrimitiveCollection
   * @private
   */
  class PolylineCollection {
    constructor(options?: PolylineCollectionOptions)

    /** Determines if polylines in this collection will be shown. */
    show: boolean
    /** 4x4 matrix transforming each polyline from model to world coordinates. */
    modelMatrix: Matrix4
    /** For debugging only. */
    debugShowBoundingVolume: boolean
    /** Number of polylines in this collection. */
    readonly length: number

    /**
     * Creates and adds a polyline. Triggers O(n) vertex buffer rewrite — batch adds when possible.
     * @returns The added Polyline for further modification.
     */
    add(options?: PolylineOptions): Polyline
    /** Removes a polyline. Returns true if found and removed. */
    remove(polyline: Polyline): boolean
    /** Removes all polylines. O(n) — more efficient than creating a new collection. */
    removeAll(): void
    /** Returns the polyline at the given zero-based index. */
    get(index: number): Polyline
    /** Returns true if the collection contains the given polyline. */
    contains(polyline: Polyline): boolean
    /** Called by the scene each frame. Do not call directly. */
    update(frameState: any): void
    /** Destroys the collection and all GPU resources. */
    destroy(): void
    /** Returns true if this collection has been destroyed. */
    isDestroyed(): boolean
  }
}
