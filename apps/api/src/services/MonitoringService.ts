import { logger } from '@/utils/logger';
import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { totalmem } from 'os';

export interface SystemMetrics {
  timestamp: Date;
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: number;
  activeConnections: number;
  requestCount: number;
  errorCount: number;
  responseTime: {
    avg: number;
    min: number;
    max: number;
  };
  services: {
    database: boolean;
    redis: boolean;
    blockchain: boolean;
    strategyEngine: boolean;
  };
}

export interface AlertRule {
  id: string;
  name: string;
  condition: string;
  threshold: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
  cooldownMs: number;
  lastTriggered?: Date;
}

export interface Alert {
  id: string;
  ruleId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
  resolved: boolean;
  resolvedAt?: Date;
  metadata?: Record<string, any>;
}

export class MonitoringService extends EventEmitter {
  private prisma: PrismaClient;
  private metrics: SystemMetrics[] = [];
  private alerts: Alert[] = [];
  private alertRules: Map<string, AlertRule> = new Map();
  private requestCounts: Map<string, number> = new Map();
  private responseTimes: number[] = [];
  private errorCounts: Map<string, number> = new Map();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private maxMetricsHistory = 1440; // 24 hours at 1-minute intervals
  private maxAlertsHistory = 1000; // Max alerts to keep in memory
  private maxResponseTimesHistory = 10000; // Max response times per period

  constructor(prisma: PrismaClient) {
    super();
    this.prisma = prisma;
    this.initializeDefaultAlertRules();
    logger.info('📊 Monitoring Service initialized');
  }

  /**
   * Start monitoring system
   */
  start(): void {
    if (this.monitoringInterval) {
      logger.warn('Monitoring service is already running');
      return;
    }

    this.monitoringInterval = setInterval(async () => {
      await this.collectMetrics();
      await this.evaluateAlertRules();
    }, 300000); // Collect metrics every 5 minutes (production optimized)

    logger.info('🚀 Monitoring service started');
  }

  /**
   * Stop monitoring system
   */
  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      
      // Cleanup memory
      this.cleanup();
      
      logger.info('🛑 Monitoring service stopped');
    }
  }

  /**
   * Cleanup memory to prevent leaks
   */
  private cleanup(): void {
    this.metrics = [];
    this.alerts = [];
    this.requestCounts.clear();
    this.responseTimes = [];
    this.errorCounts.clear();
    logger.info('🧹 Monitoring service memory cleaned up');
  }

  /**
   * Initialize default alert rules
   */
  private initializeDefaultAlertRules(): void {
    const defaultRules: AlertRule[] = [
      {
        id: 'high_memory_usage',
        name: 'High Memory Usage',
        condition: 'memory_usage_percent',
        threshold: 85,
        severity: 'high',
        enabled: true,
        cooldownMs: 300000 // 5 minutes
      },
      {
        id: 'high_error_rate',
        name: 'High Error Rate',
        condition: 'error_rate_percent',
        threshold: 10,
        severity: 'critical',
        enabled: true,
        cooldownMs: 180000 // 3 minutes
      },
      {
        id: 'database_connection_failed',
        name: 'Database Connection Failed',
        condition: 'database_connection',
        threshold: 0,
        severity: 'critical',
        enabled: true,
        cooldownMs: 60000 // 1 minute
      },
      {
        id: 'strategy_engine_down',
        name: 'Strategy Engine Down',
        condition: 'strategy_engine_status',
        threshold: 0,
        severity: 'high',
        enabled: true,
        cooldownMs: 120000 // 2 minutes
      },
      {
        id: 'high_response_time',
        name: 'High Response Time',
        condition: 'avg_response_time_ms',
        threshold: 2000,
        severity: 'medium',
        enabled: true,
        cooldownMs: 300000 // 5 minutes
      },
      {
        id: 'low_uptime',
        name: 'Service Restart Detected',
        condition: 'uptime_seconds',
        threshold: 300, // Less than 5 minutes uptime
        severity: 'medium',
        enabled: true,
        cooldownMs: 600000 // 10 minutes
      }
    ];

    defaultRules.forEach(rule => {
      this.alertRules.set(rule.id, rule);
    });
  }

  /**
   * Collect system metrics
   */
  private async collectMetrics(): Promise<void> {
    try {
      const memUsage = process.memoryUsage();
      const uptime = process.uptime();
      
      // Calculate CPU usage (simplified)
      const cpuUsage = process.cpuUsage();
      const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds

      // Calculate request metrics
      const totalRequests = Array.from(this.requestCounts.values()).reduce((a, b) => a + b, 0);
      const totalErrors = Array.from(this.errorCounts.values()).reduce((a, b) => a + b, 0);
      
      const avgResponseTime = this.responseTimes.length > 0 
        ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length 
        : 0;
      
      const minResponseTime = this.responseTimes.length > 0 ? Math.min(...this.responseTimes) : 0;
      const maxResponseTime = this.responseTimes.length > 0 ? Math.max(...this.responseTimes) : 0;

      const metrics: SystemMetrics = {
        timestamp: new Date(),
        uptime,
        memoryUsage: memUsage,
        cpuUsage: cpuPercent,
        activeConnections: 0, // TODO: Track actual connections
        requestCount: totalRequests,
        errorCount: totalErrors,
        responseTime: {
          avg: avgResponseTime,
          min: minResponseTime,
          max: maxResponseTime
        },
        services: {
          database: await this.checkDatabaseHealth(),
          redis: await this.checkRedisHealth(),
          blockchain: await this.checkBlockchainHealth(),
          strategyEngine: await this.checkStrategyEngineHealth()
        }
      };

      // Add to metrics history
      this.metrics.push(metrics);
      
      // Keep only recent metrics
      if (this.metrics.length > this.maxMetricsHistory) {
        this.metrics.shift();
      }

      // Reset counters for next period
      this.resetPeriodCounters();

      // Emit metrics event
      this.emit('metrics', metrics);

      logger.debug(`📊 Collected metrics: Memory ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB, CPU ${cpuPercent.toFixed(1)}%, Requests ${totalRequests}, Errors ${totalErrors}`);
    } catch (error) {
      logger.error('Error collecting metrics:', error);
    }
  }

  /**
   * Check database health
   */
  private async checkDatabaseHealth(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check Redis health
   */
  private async checkRedisHealth(): Promise<boolean> {
    try {
      // TODO: Implement Redis health check
      return false; // Redis is not connected currently
    } catch {
      return false;
    }
  }

  /**
   * Check blockchain health
   */
  private async checkBlockchainHealth(): Promise<boolean> {
    try {
      // TODO: Call blockchain service health check
      return true; // Assume healthy for now
    } catch {
      return false;
    }
  }

  /**
   * Check strategy engine health
   */
  private async checkStrategyEngineHealth(): Promise<boolean> {
    try {
      // TODO: Call strategy engine health check
      return true; // Assume healthy for now
    } catch {
      return false;
    }
  }

  /**
   * Reset period counters
   */
  private resetPeriodCounters(): void {
    this.requestCounts.clear();
    this.errorCounts.clear();
    this.responseTimes = [];
  }

  /**
   * Record request
   */
  recordRequest(endpoint: string, method: string): void {
    const key = `${method}:${endpoint}`;
    this.requestCounts.set(key, (this.requestCounts.get(key) || 0) + 1);
  }

  /**
   * Record response time
   */
  recordResponseTime(ms: number): void {
    this.responseTimes.push(ms);
    
    // Prevent memory leak: limit response times array size
    if (this.responseTimes.length > this.maxResponseTimesHistory) {
      this.responseTimes = this.responseTimes.slice(-this.maxResponseTimesHistory / 2);
    }
  }

  /**
   * Record error
   */
  recordError(endpoint: string, method: string, error: string): void {
    const key = `${method}:${endpoint}:${error}`;
    this.errorCounts.set(key, (this.errorCounts.get(key) || 0) + 1);
  }

  /**
   * Evaluate alert rules
   */
  private async evaluateAlertRules(): Promise<void> {
    const latestMetrics = this.metrics[this.metrics.length - 1];
    if (!latestMetrics) return;

    for (const rule of this.alertRules.values()) {
      if (!rule.enabled) continue;

      // Check cooldown period
      if (rule.lastTriggered && Date.now() - rule.lastTriggered.getTime() < rule.cooldownMs) {
        continue;
      }

      const shouldTrigger = await this.evaluateRule(rule, latestMetrics);
      
      if (shouldTrigger) {
        await this.triggerAlert(rule, latestMetrics);
      }
    }
  }

  /**
   * Evaluate a single rule
   */
  private async evaluateRule(rule: AlertRule, metrics: SystemMetrics): Promise<boolean> {
    switch (rule.condition) {
      case 'memory_usage_percent':
        // Use RSS (Resident Set Size) instead of heap for more accurate system memory usage
        const totalSystemMemory = totalmem();
        const memoryPercent = (metrics.memoryUsage.rss / totalSystemMemory) * 100;
        return memoryPercent > rule.threshold;
        
      case 'error_rate_percent':
        const errorRate = metrics.requestCount > 0 ? (metrics.errorCount / metrics.requestCount) * 100 : 0;
        return errorRate > rule.threshold;
        
      case 'database_connection':
        return !metrics.services.database;
        
      case 'strategy_engine_status':
        return !metrics.services.strategyEngine;
        
      case 'avg_response_time_ms':
        return metrics.responseTime.avg > rule.threshold;
        
      case 'uptime_seconds':
        return metrics.uptime < rule.threshold;
        
      default:
        return false;
    }
  }

  /**
   * Trigger an alert
   */
  private async triggerAlert(rule: AlertRule, metrics: SystemMetrics): Promise<void> {
    const alert: Alert = {
      id: `alert_${Date.now()}_${rule.id}`,
      ruleId: rule.id,
      severity: rule.severity,
      message: this.formatAlertMessage(rule, metrics),
      timestamp: new Date(),
      resolved: false,
      metadata: {
        metrics: {
          uptime: metrics.uptime,
          memoryUsage: metrics.memoryUsage,
          responseTime: metrics.responseTime,
          services: metrics.services
        }
      }
    };

    this.alerts.push(alert);
    
    // Prevent memory leak: limit alerts array size
    if (this.alerts.length > this.maxAlertsHistory) {
      this.alerts = this.alerts.slice(-this.maxAlertsHistory / 2);
    }
    
    rule.lastTriggered = new Date();

    // Emit alert event
    this.emit('alert', alert);

    logger.warn(`🚨 ALERT [${alert.severity.toUpperCase()}]: ${alert.message}`);

    // TODO: Send to external alerting systems (email, Slack, etc.)
  }

  /**
   * Format alert message
   */
  private formatAlertMessage(rule: AlertRule, metrics: SystemMetrics): string {
    switch (rule.condition) {
      case 'memory_usage_percent':
        const totalSystemMemory = totalmem();
        const memoryPercent = (metrics.memoryUsage.rss / totalSystemMemory) * 100;
        return `Memory usage is ${memoryPercent.toFixed(1)}% (threshold: ${rule.threshold}%)`;
        
      case 'error_rate_percent':
        const errorRate = metrics.requestCount > 0 ? (metrics.errorCount / metrics.requestCount) * 100 : 0;
        return `Error rate is ${errorRate.toFixed(1)}% (threshold: ${rule.threshold}%)`;
        
      case 'database_connection':
        return 'Database connection failed';
        
      case 'strategy_engine_status':
        return 'Strategy engine is not responding';
        
      case 'avg_response_time_ms':
        return `Average response time is ${metrics.responseTime.avg.toFixed(0)}ms (threshold: ${rule.threshold}ms)`;
        
      case 'uptime_seconds':
        return `Service uptime is ${metrics.uptime.toFixed(0)}s - service may have restarted`;
        
      default:
        return `Alert triggered for rule: ${rule.name}`;
    }
  }

  /**
   * Get current metrics
   */
  getCurrentMetrics(): SystemMetrics | null {
    return this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] : null;
  }

  /**
   * Get metrics history
   */
  getMetricsHistory(limit?: number): SystemMetrics[] {
    if (limit) {
      return this.metrics.slice(-limit);
    }
    return [...this.metrics];
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return this.alerts.filter(alert => !alert.resolved);
  }

  /**
   * Get all alerts
   */
  getAllAlerts(limit?: number): Alert[] {
    const sortedAlerts = [...this.alerts].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    if (limit) {
      return sortedAlerts.slice(0, limit);
    }
    return sortedAlerts;
  }

  /**
   * Resolve alert
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert && !alert.resolved) {
      alert.resolved = true;
      alert.resolvedAt = new Date();
      
      this.emit('alertResolved', alert);
      logger.info(`✅ Alert resolved: ${alert.message}`);
      return true;
    }
    return false;
  }

  /**
   * Add custom alert rule
   */
  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
    logger.info(`📋 Added alert rule: ${rule.name}`);
  }

  /**
   * Remove alert rule
   */
  removeAlertRule(ruleId: string): boolean {
    const removed = this.alertRules.delete(ruleId);
    if (removed) {
      logger.info(`🗑️ Removed alert rule: ${ruleId}`);
    }
    return removed;
  }

  /**
   * Get alert rules
   */
  getAlertRules(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }

  /**
   * Get system health summary
   */
  getHealthSummary(): {
    status: 'healthy' | 'warning' | 'critical';
    uptime: number;
    activeAlerts: number;
    criticalAlerts: number;
    services: Record<string, boolean>;
  } {
    const currentMetrics = this.getCurrentMetrics();
    const activeAlerts = this.getActiveAlerts();
    const criticalAlerts = activeAlerts.filter(a => a.severity === 'critical').length;
    
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    
    if (criticalAlerts > 0) {
      status = 'critical';
    } else if (activeAlerts.length > 0) {
      status = 'warning';
    }

    return {
      status,
      uptime: currentMetrics?.uptime || 0,
      activeAlerts: activeAlerts.length,
      criticalAlerts,
      services: currentMetrics?.services || {
        database: false,
        redis: false,
        blockchain: false,
        strategyEngine: false
      }
    };
  }
}

export default MonitoringService;