import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@copil/database';

export interface RiskAssessmentRequest {
  sessionKeyId: string;
  userId: number;
  sourceIp?: string;
  userAgent?: string;
  timestamp: Date;
}

export interface TransactionRiskRequest {
  userId: number;
  amount: string;
  destination: string;
  chain: string;
  tokenAddress?: string;
  sessionKeyId: string;
}

export interface RiskAssessmentResult {
  level: 'low' | 'medium' | 'high' | 'critical';
  score: number; // 0-100
  factors: string[];
  additionalChecks?: string[];
  recommendedAction?: 'allow' | 'manual_review' | 'block';
}

@Injectable()
export class RiskEngine {
  private readonly logger = new Logger(RiskEngine.name);
  private readonly suspiciousIps = new Set<string>();
  private readonly highRiskDestinations = new Set<string>();
  private readonly recentUserRequests = new Map<number, Date[]>();

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    this.initializeRiskLists();
  }

  private initializeRiskLists(): void {
    // Load suspicious IPs from config
    const suspiciousIps = this.configService.get<string>('RISK_SUSPICIOUS_IPS', '');
    if (suspiciousIps) {
      suspiciousIps.split(',').forEach(ip => this.suspiciousIps.add(ip.trim()));
    }

    // Load high-risk destinations from config
    const riskyDests = this.configService.get<string>('RISK_HIGH_RISK_DESTINATIONS', '');
    if (riskyDests) {
      riskyDests.split(',').forEach(dest => this.highRiskDestinations.add(dest.trim()));
    }

    this.logger.log(`Risk engine initialized with ${this.suspiciousIps.size} suspicious IPs and ${this.highRiskDestinations.size} high-risk destinations`);
  }

  async assessTransactionRisk(request: TransactionRiskRequest, wallet?: any): Promise<RiskAssessmentResult> {
    this.logger.debug(`Assessing transaction risk for user ${request.userId}`);

    let riskScore = 0;
    const factors: string[] = [];
    const additionalChecks: string[] = [];

    // Amount-based risk assessment
    const amount = parseFloat(request.amount);
    if (amount > 100000) { // > $100k
      riskScore += 40;
      factors.push('high_amount_transaction');
      additionalChecks.push('manual_review_required');
    } else if (amount > 10000) { // > $10k
      riskScore += 20;
      factors.push('elevated_amount_transaction');
    }

    // Destination-based risk
    if (this.highRiskDestinations.has(request.destination.toLowerCase())) {
      riskScore += 30;
      factors.push('high_risk_destination');
      additionalChecks.push('destination_verification');
    }

    // Chain-based risk
    const highRiskChains = ['arbitrum', 'avalanche', 'bsc'];
    if (highRiskChains.includes(request.chain.toLowerCase())) {
      riskScore += 15;
      factors.push('high_risk_chain');
    }

    // Time-based risk (unusual hours)
    const hour = new Date().getUTCHours();
    if (hour < 6 || hour > 22) {
      riskScore += 10;
      factors.push('unusual_hours');
    }

    // Velocity check (rapid transactions)
    const recentTxCount = this.getRecentTransactionCount(request.userId, 60); // last hour
    if (recentTxCount > 10) {
      riskScore += 25;
      factors.push('high_velocity_transactions');
      additionalChecks.push('velocity_limit_check');
    }

    // New user risk
    const userAge = await this.getUserAccountAge(request.userId);
    if (userAge < 7) { // less than 7 days
      riskScore += 20;
      factors.push('new_user_account');
    }

    const level = this.calculateRiskLevel(riskScore);
    const recommendedAction = this.getRecommendedAction(level, riskScore);

    return {
      level,
      score: riskScore,
      factors,
      additionalChecks: additionalChecks.length > 0 ? additionalChecks : undefined,
      recommendedAction,
    };
  }

  async assessKeyAccessRisk(request: RiskAssessmentRequest): Promise<RiskAssessmentResult> {
    this.logger.debug(`Assessing key access risk for user ${request.userId}`);

    let riskScore = 0;
    const factors: string[] = [];
    const additionalChecks: string[] = [];

    // IP-based risk
    if (request.sourceIp) {
      if (this.suspiciousIps.has(request.sourceIp)) {
        riskScore += 50;
        factors.push('suspicious_ip_address');
        additionalChecks.push('ip_verification_required');
      }

      // Check for Tor exit nodes (simplified)
      if (this.isTorExitNode(request.sourceIp)) {
        riskScore += 40;
        factors.push('tor_exit_node');
        additionalChecks.push('enhanced_authentication');
      }
    }

    // User agent analysis
    if (request.userAgent) {
      const suspiciousUAs = ['bot', 'crawler', 'scraper', 'automated'];
      const uaLower = request.userAgent.toLowerCase();
      
      if (suspiciousUAs.some(sus => uaLower.includes(sus))) {
        riskScore += 30;
        factors.push('suspicious_user_agent');
      }
    }

    // Velocity check for key access
    const recentAccessCount = await this.getRecentKeyAccessCount(request.userId, 300); // last 5 minutes
    if (recentAccessCount > 5) {
      riskScore += 35;
      factors.push('rapid_key_access');
      additionalChecks.push('access throttling');
    }

    // Geolocation risk (simplified)
    if (request.sourceIp && this.isHighRiskGeolocation(request.sourceIp)) {
      riskScore += 20;
      factors.push('high_risk_geolocation');
    }

    // Time-based anomaly
    const hour = new Date().getUTCHours();
    if (hour < 3 || hour > 23) {
      riskScore += 15;
      factors.push('unusual_access_time');
    }

    const level = this.calculateRiskLevel(riskScore);
    const recommendedAction = this.getRecommendedAction(level, riskScore);

    return {
      level,
      score: riskScore,
      factors,
      additionalChecks: additionalChecks.length > 0 ? additionalChecks : undefined,
      recommendedAction,
    };
  }

  // === Private Helper Methods ===

  private calculateRiskLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score >= 80) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 30) return 'medium';
    return 'low';
  }

  private getRecommendedAction(level: 'low' | 'medium' | 'high' | 'critical', score: number): 'allow' | 'manual_review' | 'block' {
    if (level === 'critical' || score >= 90) return 'block';
    if (level === 'high' || score >= 60) return 'manual_review';
    return 'allow';
  }

  private getRecentTransactionCount(userId: number, seconds: number): number {
    const now = new Date();
    const cutoff = new Date(now.getTime() - seconds * 1000);
    
    const userRequests = this.recentUserRequests.get(userId) || [];
    return userRequests.filter(timestamp => timestamp > cutoff).length;
  }

  private async getRecentKeyAccessCount(userId: number, seconds: number): Promise<number> {
    try {
      // Query audit logs for recent key access events
      const cutoffTime = new Date(Date.now() - seconds * 1000);
      
      // This would integrate with AuditService for real implementation
      // For now, we'll implement a basic version using the existing request tracking
      const recentRequests = this.recentUserRequests.get(userId) || [];
      const recentAccessCount = recentRequests.filter(timestamp => timestamp > cutoffTime).length;
      
      return recentAccessCount;
    } catch (error) {
      this.logger.error(`Failed to get recent key access count for user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }

  private async getUserAccountAge(userId: number): Promise<number> {
    try {
      // Query database for user creation date
      const user = await this.userRepository.findOne({ where: { id: userId } });
      
      if (!user) {
        this.logger.warn(`User ${userId} not found for account age calculation`);
        return 0;
      }

      const accountAgeMs = Date.now() - user.createdAt.getTime();
      const accountAgeDays = Math.floor(accountAgeMs / (1000 * 60 * 60 * 24));
      
      return accountAgeDays;
    } catch (error) {
      this.logger.error(`Failed to get account age for user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }

  private isTorExitNode(ip: string): boolean {
    // Simplified Tor detection - in production would use real Tor node lists
    return ip.startsWith('10.') || ip.startsWith('192.168.');
  }

  private isHighRiskGeolocation(ip: string): boolean {
    // Simplified geolocation risk - in production would use GeoIP database
    const highRiskRanges = ['10.0.0.', '192.168.1.'];
    return highRiskRanges.some(range => ip.startsWith(range));
  }

  // Public method to record user requests for velocity checking
  recordUserRequest(userId: number): void {
    const now = new Date();
    const requests = this.recentUserRequests.get(userId) || [];
    requests.push(now);
    
    // Keep only last hour of requests
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const filtered = requests.filter(timestamp => timestamp > oneHourAgo);
    
    this.recentUserRequests.set(userId, filtered);
  }
}
