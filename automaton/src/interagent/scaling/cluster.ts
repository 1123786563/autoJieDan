/**
 * 水平扩展支持模块
 * 实现多实例水平扩展能力
 *
 * @module interagent.scaling.cluster
 * @version 1.0.0
 */

import { EventEmitter } from "events";

// ============================================================================
// Types
// ============================================================================

/**
 * 实例状态
 */
export type InstanceStatus = "healthy" | "degraded" | "unhealthy";

/**
 * 负载均衡策略
 */
export type LoadBalanceStrategy = "round-robin" | "least-load" | "random";

/**
 * 实例信息
 */
export interface InstanceInfo {
  /** 实例 ID */
  id: string;
  /** 实例 URL */
  url: string;
  /** 实例状态 */
  status: InstanceStatus;
  /** 当前负载 (0-1) */
  load: number;
  /** 最后心跳时间 */
  lastHeartbeat: Date;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 实例注册选项
 */
export interface RegisterOptions {
  /** 超时时间 (毫秒) */
  heartbeatTimeout?: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 路由结果
 */
export interface RouteResult {
  /** 选中的实例 */
  instance: InstanceInfo;
  /** 路由策略 */
  strategy: LoadBalanceStrategy;
}

/**
 * 集群统计
 */
export interface ClusterStats {
  /** 总实例数 */
  totalInstances: number;
  /** 健康实例数 */
  healthyInstances: number;
  /** 降级实例数 */
  degradedInstances: number;
  /** 不健康实例数 */
  unhealthyInstances: number;
  /** 总负载 */
  totalLoad: number;
  /** 平均负载 */
  averageLoad: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_HEARTBEAT_INTERVAL = 30000; // 30 秒
const DEFAULT_HEARTBEAT_TIMEOUT = 60000; // 60 秒

// ============================================================================
// InstanceRegistry Class
// ============================================================================

/**
 * 实例注册表
 *
 * 管理集群中的所有实例，提供注册、发现和健康检查功能
 *
 * @example
 * ```typescript
 * const registry = new InstanceRegistry();
 *
 * // 注册实例
 * registry.register({
 *   id: 'instance-1',
 *   url: 'http://localhost:3001',
 *   status: 'healthy',
 *   load: 0.5,
 * });
 *
 * // 获取健康实例
 * const healthy = registry.getHealthyInstances();
 *
 * // 选择实例
 * const selected = registry.selectInstance('least-load');
 * ```
 */
export class InstanceRegistry extends EventEmitter {
  private instances: Map<string, InstanceInfo> = new Map();
  private heartbeatTimeout: number;
  private roundRobinIndex = 0;

  constructor(options: { heartbeatTimeout?: number } = {}) {
    super();
    this.heartbeatTimeout = options.heartbeatTimeout || DEFAULT_HEARTBEAT_TIMEOUT;
  }

  /**
   * 注册实例
   */
  register(instance: Omit<InstanceInfo, "lastHeartbeat">, options?: RegisterOptions): void {
    const info: InstanceInfo = {
      ...instance,
      lastHeartbeat: new Date(),
      metadata: options?.metadata || instance.metadata,
    };

    const isNew = !this.instances.has(instance.id);
    this.instances.set(instance.id, info);

    if (isNew) {
      this.emit("registered", info);
    } else {
      this.emit("updated", info);
    }
  }

  /**
   * 注销实例
   */
  deregister(instanceId: string): boolean {
    const instance = this.instances.get(instanceId);
    if (instance) {
      this.instances.delete(instanceId);
      this.emit("deregistered", instance);
      return true;
    }
    return false;
  }

  /**
   * 更新心跳
   */
  heartbeat(instanceId: string, load: number, status?: InstanceStatus): boolean {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.lastHeartbeat = new Date();
      instance.load = Math.max(0, Math.min(1, load));
      if (status) {
        instance.status = status;
      }
      this.emit("heartbeat", instance);
      return true;
    }
    return false;
  }

  /**
   * 获取实例
   */
  getInstance(instanceId: string): InstanceInfo | undefined {
    return this.instances.get(instanceId);
  }

  /**
   * 获取所有实例
   */
  getAllInstances(): InstanceInfo[] {
    return Array.from(this.instances.values());
  }

  /**
   * 获取健康实例
   */
  getHealthyInstances(): InstanceInfo[] {
    const now = Date.now();
    return Array.from(this.instances.values()).filter(
      (i) =>
        (i.status === "healthy" || i.status === "degraded") &&
        now - i.lastHeartbeat.getTime() < this.heartbeatTimeout
    );
  }

  /**
   * 按状态获取实例
   */
  getInstancesByStatus(status: InstanceStatus): InstanceInfo[] {
    return Array.from(this.instances.values()).filter((i) => i.status === status);
  }

  /**
   * 选择实例
   */
  selectInstance(strategy: LoadBalanceStrategy = "least-load"): InstanceInfo | null {
    const healthy = this.getHealthyInstances();
    if (healthy.length === 0) return null;

    switch (strategy) {
      case "least-load":
        return healthy.reduce((a, b) => (a.load < b.load ? a : b));

      case "round-robin":
        this.roundRobinIndex = (this.roundRobinIndex + 1) % healthy.length;
        return healthy[this.roundRobinIndex];

      case "random":
        return healthy[Math.floor(Math.random() * healthy.length)];

      default:
        return healthy[0];
    }
  }

  /**
   * 检查实例健康状态
   */
  checkHealth(): { healthy: string[]; unhealthy: string[] } {
    const now = Date.now();
    const healthy: string[] = [];
    const unhealthy: string[] = [];

    for (const [id, instance] of this.instances) {
      if (
        instance.status === "healthy" &&
        now - instance.lastHeartbeat.getTime() < this.heartbeatTimeout
      ) {
        healthy.push(id);
      } else {
        unhealthy.push(id);
      }
    }

    return { healthy, unhealthy };
  }

  /**
   * 获取统计信息
   */
  getStats(): ClusterStats {
    const instances = Array.from(this.instances.values());
    const totalInstances = instances.length;
    const healthyInstances = instances.filter((i) => i.status === "healthy").length;
    const degradedInstances = instances.filter((i) => i.status === "degraded").length;
    const unhealthyInstances = instances.filter((i) => i.status === "unhealthy").length;
    const totalLoad = instances.reduce((sum, i) => sum + i.load, 0);
    const averageLoad = totalInstances > 0 ? totalLoad / totalInstances : 0;

    return {
      totalInstances,
      healthyInstances,
      degradedInstances,
      unhealthyInstances,
      totalLoad,
      averageLoad,
    };
  }

  /**
   * 清空所有实例
   */
  clear(): void {
    this.instances.clear();
    this.roundRobinIndex = 0;
    this.emit("cleared");
  }

  /**
   * 获取实例数量
   */
  get size(): number {
    return this.instances.size;
  }
}

// ============================================================================
// LoadBalancer Class
// ============================================================================

/**
 * 负载均衡器
 *
 * 根据策略将请求路由到合适的实例
 *
 * @example
 * ```typescript
 * const registry = new InstanceRegistry();
 * const loadBalancer = new LoadBalancer(registry);
 *
 * // 路由请求
 * const result = loadBalancer.selectInstance();
 * if (result) {
 *   console.log(`Routing to ${result.instance.url}`);
 * }
 * ```
 */
export class LoadBalancer {
  private registry: InstanceRegistry;
  private strategy: LoadBalanceStrategy;
  private sessionAffinity: Map<string, string> = new Map();

  constructor(registry: InstanceRegistry, strategy: LoadBalanceStrategy = "least-load") {
    this.registry = registry;
    this.strategy = strategy;
  }

  /**
   * 设置负载均衡策略
   */
  setStrategy(strategy: LoadBalanceStrategy): void {
    this.strategy = strategy;
  }

  /**
   * 选择实例
   */
  selectInstance(sessionId?: string): RouteResult | null {
    // 会话亲和性检查
    if (sessionId) {
      const affinityInstance = this.sessionAffinity.get(sessionId);
      if (affinityInstance) {
        const instance = this.registry.getInstance(affinityInstance);
        if (instance && instance.status !== "unhealthy") {
          return { instance, strategy: "round-robin" };
        }
        // 实例不健康，移除亲和性
        this.sessionAffinity.delete(sessionId);
      }
    }

    const instance = this.registry.selectInstance(this.strategy);
    if (!instance) return null;

    // 设置会话亲和性
    if (sessionId) {
      this.sessionAffinity.set(sessionId, instance.id);
    }

    return { instance, strategy: this.strategy };
  }

  /**
   * 路由请求
   */
  async routeRequest<T>(
    request: T,
    executor: (instance: InstanceInfo, request: T) => Promise<Response>
  ): Promise<{ response: Response; instance: InstanceInfo }> {
    const result = this.selectInstance();
    if (!result) {
      throw new Error("No healthy instances available");
    }

    try {
      const response = await executor(result.instance, request);
      return { response, instance: result.instance };
    } catch (error) {
      // 故障转移：尝试其他实例
      const retryResult = this.registry.selectInstance("random");
      if (retryResult && retryResult.id !== result.instance.id) {
        const response = await executor(retryResult, request);
        return { response, instance: retryResult };
      }
      throw error;
    }
  }

  /**
   * 清除会话亲和性
   */
  clearSessionAffinity(sessionId?: string): void {
    if (sessionId) {
      this.sessionAffinity.delete(sessionId);
    } else {
      this.sessionAffinity.clear();
    }
  }

  /**
   * 获取注册表
   */
  getRegistry(): InstanceRegistry {
    return this.registry;
  }
}

// ============================================================================
// Default Export
// ============================================================================

export default InstanceRegistry;
