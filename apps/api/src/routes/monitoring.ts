import express from 'express';
import { logger } from '@/utils/logger';
import MonitoringService from '@/services/MonitoringService';

const router = express.Router();

export function createMonitoringRoutes(monitoringService: MonitoringService) {
  // Get current system metrics
  router.get('/metrics', async (req, res) => {
    try {
      const metrics = monitoringService.getCurrentMetrics();
      
      if (!metrics) {
        return res.status(404).json({
          success: false,
          error: 'No metrics available yet'
        });
      }

      res.json({
        success: true,
        data: metrics
      });
    } catch (error) {
      logger.error('Error fetching current metrics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch metrics'
      });
    }
  });

  // Get metrics history
  router.get('/metrics/history', async (req, res) => {
    try {
      const { limit = 60 } = req.query; // Default to last hour
      const history = monitoringService.getMetricsHistory(parseInt(limit as string));
      
      res.json({
        success: true,
        data: history,
        count: history.length
      });
    } catch (error) {
      logger.error('Error fetching metrics history:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch metrics history'
      });
    }
  });

  // Get system health summary
  router.get('/health', async (req, res) => {
    try {
      const healthSummary = monitoringService.getHealthSummary();
      
      res.status(healthSummary.status === 'critical' ? 503 : 200).json({
        success: true,
        data: healthSummary
      });
    } catch (error) {
      logger.error('Error fetching health summary:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch health summary'
      });
    }
  });

  // Get active alerts
  router.get('/alerts', async (req, res) => {
    try {
      const { active = 'true', limit } = req.query;
      
      let alerts;
      if (active === 'true') {
        alerts = monitoringService.getActiveAlerts();
      } else {
        alerts = monitoringService.getAllAlerts(limit ? parseInt(limit as string) : undefined);
      }
      
      res.json({
        success: true,
        data: alerts,
        count: alerts.length
      });
    } catch (error) {
      logger.error('Error fetching alerts:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch alerts'
      });
    }
  });

  // Resolve an alert
  router.patch('/alerts/:alertId/resolve', async (req, res) => {
    try {
      const { alertId } = req.params;
      
      const resolved = monitoringService.resolveAlert(alertId);
      
      if (!resolved) {
        return res.status(404).json({
          success: false,
          error: 'Alert not found or already resolved'
        });
      }

      res.json({
        success: true,
        message: 'Alert resolved successfully'
      });
    } catch (error) {
      logger.error('Error resolving alert:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to resolve alert'
      });
    }
  });

  // Get alert rules
  router.get('/alerts/rules', async (req, res) => {
    try {
      const rules = monitoringService.getAlertRules();
      
      res.json({
        success: true,
        data: rules,
        count: rules.length
      });
    } catch (error) {
      logger.error('Error fetching alert rules:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch alert rules'
      });
    }
  });

  // Add custom alert rule
  router.post('/alerts/rules', async (req, res) => {
    try {
      const {
        id,
        name,
        condition,
        threshold,
        severity = 'medium',
        enabled = true,
        cooldownMs = 300000
      } = req.body;

      if (!id || !name || !condition || threshold === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: id, name, condition, threshold'
        });
      }

      const rule = {
        id,
        name,
        condition,
        threshold: parseFloat(threshold),
        severity,
        enabled: Boolean(enabled),
        cooldownMs: parseInt(cooldownMs)
      };

      monitoringService.addAlertRule(rule);

      res.status(201).json({
        success: true,
        data: rule,
        message: 'Alert rule added successfully'
      });
    } catch (error) {
      logger.error('Error adding alert rule:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add alert rule'
      });
    }
  });

  // Remove alert rule
  router.delete('/alerts/rules/:ruleId', async (req, res) => {
    try {
      const { ruleId } = req.params;
      
      const removed = monitoringService.removeAlertRule(ruleId);
      
      if (!removed) {
        return res.status(404).json({
          success: false,
          error: 'Alert rule not found'
        });
      }

      res.json({
        success: true,
        message: 'Alert rule removed successfully'
      });
    } catch (error) {
      logger.error('Error removing alert rule:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to remove alert rule'
      });
    }
  });

  // Get monitoring statistics
  router.get('/stats', async (req, res) => {
    try {
      const history = monitoringService.getMetricsHistory(60); // Last hour
      const alerts = monitoringService.getAllAlerts();
      const currentMetrics = monitoringService.getCurrentMetrics();
      
      if (history.length === 0 || !currentMetrics) {
        return res.json({
          success: true,
          data: {
            message: 'No monitoring data available yet',
            uptime: process.uptime()
          }
        });
      }

      // Calculate statistics
      const responseTimes = history.map(m => m.responseTime.avg).filter(t => t > 0);
      const memoryUsages = history.map(m => (m.memoryUsage.heapUsed / m.memoryUsage.heapTotal) * 100);
      const requestCounts = history.map(m => m.requestCount);
      const errorCounts = history.map(m => m.errorCount);

      const stats = {
        current: {
          uptime: currentMetrics.uptime,
          memoryUsagePercent: (currentMetrics.memoryUsage.heapUsed / currentMetrics.memoryUsage.heapTotal) * 100,
          responseTime: currentMetrics.responseTime,
          services: currentMetrics.services
        },
        hourly: {
          avgResponseTime: responseTimes.length > 0 ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : 0,
          maxResponseTime: responseTimes.length > 0 ? Math.max(...responseTimes) : 0,
          avgMemoryUsage: memoryUsages.length > 0 ? memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length : 0,
          maxMemoryUsage: memoryUsages.length > 0 ? Math.max(...memoryUsages) : 0,
          totalRequests: requestCounts.reduce((a, b) => a + b, 0),
          totalErrors: errorCounts.reduce((a, b) => a + b, 0)
        },
        alerts: {
          total: alerts.length,
          active: alerts.filter(a => !a.resolved).length,
          critical: alerts.filter(a => a.severity === 'critical').length,
          lastAlert: alerts.length > 0 ? alerts[alerts.length - 1] : null
        }
      };

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger.error('Error fetching monitoring statistics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch monitoring statistics'
      });
    }
  });

  // Monitoring service control
  router.post('/control/:action', async (req, res) => {
    try {
      const { action } = req.params;
      
      switch (action) {
        case 'start':
          monitoringService.start();
          res.json({
            success: true,
            message: 'Monitoring service started'
          });
          break;
          
        case 'stop':
          monitoringService.stop();
          res.json({
            success: true,
            message: 'Monitoring service stopped'
          });
          break;
          
        default:
          res.status(400).json({
            success: false,
            error: 'Invalid action. Use "start" or "stop"'
          });
      }
    } catch (error) {
      logger.error('Error controlling monitoring service:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to control monitoring service'
      });
    }
  });

  return router;
}