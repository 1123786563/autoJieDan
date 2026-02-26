/**
 * 对象池与Buffer池
 * 用于内存优化，减少GC压力
 *
 * @module interagent.performance.pool
 * @version 1.0.0
 */

// ============================================================================
// Types
// ============================================================================

export interface PoolOptions<T> {
  /** 初始池大小 */
  initialSize?: number;
  /** 最大池大小 */
  maxSize?: number;
  /** 工厂函数 - 创建新对象 */
  factory: () => T;
  /** 重置函数 - 重置对象状态 */
  reset?: (obj: T) => void;
}

export interface BufferPoolOptions {
  /** Buffer 大小 */
  bufferSize: number;
  /** 初始池大小 */
  initialSize?: number;
  /** 最大池大小 */
  maxSize?: number;
}

export interface PoolStats {
  /** 池中可用对象数 */
  available: number;
  /** 正在使用的对象数 */
  inUse: number;
  /** 总创建数 */
  totalCreated: number;
  /** 总获取数 */
  totalAcquired: number;
  /** 总释放数 */
  totalReleased: number;
  /** 命中率 */
  hitRate: number;
}

// ============================================================================
// ObjectPool
// ============================================================================

/**
 * 通用对象池
 *
 * Example:
 * ```typescript
 * const pool = new ObjectPool({
 *   factory: () => ({ data: '', count: 0 }),
 *   reset: (obj) => { obj.data = ''; obj.count = 0; },
 *   maxSize: 100
 * });
 *
 * const obj = pool.acquire();
 * // 使用对象...
 * pool.release(obj);
 * ```
 */
export class ObjectPool<T> {
  private pool: T[] = [];
  private inUseCount = 0;
  private totalCreated = 0;
  private totalAcquired = 0;
  private totalReleased = 0;
  private hits = 0;
  private misses = 0;

  private readonly factory: () => T;
  private readonly reset?: (obj: T) => void;
  private readonly maxSize: number;

  constructor(options: PoolOptions<T>) {
    this.factory = options.factory;
    this.reset = options.reset;
    this.maxSize = options.maxSize ?? 100;

    const initialSize = options.initialSize ?? 10;
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.factory());
      this.totalCreated++;
    }
  }

  /**
   * 获取对象
   */
  acquire(): T {
    this.totalAcquired++;

    if (this.pool.length > 0) {
      this.hits++;
      const obj = this.pool.pop()!;
      this.inUseCount++;
      return obj;
    }

    this.misses++;
    this.totalCreated++;
    this.inUseCount++;
    return this.factory();
  }

  /**
   * 释放对象回池
   */
  release(obj: T): void {
    if (this.inUseCount <= 0) {
      return;
    }

    this.totalReleased++;
    this.inUseCount--;

    if (this.pool.length < this.maxSize) {
      if (this.reset) {
        this.reset(obj);
      }
      this.pool.push(obj);
    }
    // 超过最大容量则丢弃
  }

  /**
   * 批量获取对象
   */
  acquireBatch(count: number): T[] {
    const result: T[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.acquire());
    }
    return result;
  }

  /**
   * 批量释放对象
   */
  releaseBatch(objects: T[]): void {
    for (const obj of objects) {
      this.release(obj);
    }
  }

  /**
   * 清空池
   */
  clear(): void {
    this.pool = [];
    this.inUseCount = 0;
  }

  /**
   * 获取统计信息
   */
  getStats(): PoolStats {
    const totalRequests = this.hits + this.misses;
    return {
      available: this.pool.length,
      inUse: this.inUseCount,
      totalCreated: this.totalCreated,
      totalAcquired: this.totalAcquired,
      totalReleased: this.totalReleased,
      hitRate: totalRequests > 0 ? this.hits / totalRequests : 0,
    };
  }

  /**
   * 获取可用对象数
   */
  get available(): number {
    return this.pool.length;
  }

  /**
   * 获取使用中对象数
   */
  get inUse(): number {
    return this.inUseCount;
  }
}

// ============================================================================
// BufferPool
// ============================================================================

/**
 * Buffer 池
 * 专门用于 Buffer 复用
 *
 * Example:
 * ```typescript
 * const bufferPool = new BufferPool({ bufferSize: 4096, maxSize: 50 });
 *
 * const buffer = bufferPool.acquire();
 * // 使用 buffer...
 * bufferPool.release(buffer);
 * ```
 */
export class BufferPool {
  private pool: Buffer[] = [];
  private inUseCount = 0;
  private totalCreated = 0;
  private totalAcquired = 0;
  private totalReleased = 0;
  private hits = 0;
  private misses = 0;

  private readonly bufferSize: number;
  private readonly maxSize: number;

  constructor(options: BufferPoolOptions) {
    this.bufferSize = options.bufferSize;
    this.maxSize = options.maxSize ?? 50;

    const initialSize = options.initialSize ?? 10;
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(Buffer.allocUnsafe(this.bufferSize));
      this.totalCreated++;
    }
  }

  /**
   * 获取 Buffer
   */
  acquire(): Buffer {
    this.totalAcquired++;

    if (this.pool.length > 0) {
      this.hits++;
      const buffer = this.pool.pop()!;
      this.inUseCount++;
      buffer.fill(0); // 清空 buffer
      return buffer;
    }

    this.misses++;
    this.totalCreated++;
    this.inUseCount++;
    return Buffer.allocUnsafe(this.bufferSize);
  }

  /**
   * 释放 Buffer 回池
   */
  release(buffer: Buffer): void {
    if (this.inUseCount <= 0) {
      return;
    }

    this.totalReleased++;
    this.inUseCount--;

    if (buffer.length === this.bufferSize && this.pool.length < this.maxSize) {
      this.pool.push(buffer);
    }
  }

  /**
   * 清空池
   */
  clear(): void {
    this.pool = [];
    this.inUseCount = 0;
  }

  /**
   * 获取统计信息
   */
  getStats(): PoolStats {
    const totalRequests = this.hits + this.misses;
    return {
      available: this.pool.length,
      inUse: this.inUseCount,
      totalCreated: this.totalCreated,
      totalAcquired: this.totalAcquired,
      totalReleased: this.totalReleased,
      hitRate: totalRequests > 0 ? this.hits / totalRequests : 0,
    };
  }

  /**
   * 获取 Buffer 大小
   */
  getBufferSize(): number {
    return this.bufferSize;
  }

  /**
   * 获取可用 Buffer 数
   */
  get available(): number {
    return this.pool.length;
  }

  /**
   * 获取使用中 Buffer 数
   */
  get inUse(): number {
    return this.inUseCount;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 创建对象池
 */
export function createObjectPool<T>(options: PoolOptions<T>): ObjectPool<T> {
  return new ObjectPool<T>(options);
}

/**
 * 创建 Buffer 池
 */
export function createBufferPool(options: BufferPoolOptions): BufferPool {
  return new BufferPool(options);
}
