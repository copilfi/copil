/**
 * Enterprise Security Configuration
 * Production-ready security settings with validation
 */

export interface EnterpriseSecurityConfig {
  enabled: boolean;
  aws: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    kmsKeyId?: string;
  };
  risk: {
    suspiciousIps: string[];
    highRiskDestinations: string[];
  };
  monitoring: {
    alertsEnabled: boolean;
    webhookUrl?: string;
  };
  audit: {
    retentionDays: number;
    encryptionEnabled: boolean;
  };
}

export function getEnterpriseSecurityConfig(): EnterpriseSecurityConfig {
  return {
    enabled: process.env.ENTERPRISE_SECURITY_ENABLED === 'true',
    aws: {
      region: process.env.AWS_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      kmsKeyId: process.env.AWS_KMS_KEY_ID,
    },
    risk: {
      suspiciousIps: process.env.RISK_SUSPICIOUS_IPS?.split(',').map(ip => ip.trim()) || [],
      highRiskDestinations: process.env.RISK_HIGH_RISK_DESTINATIONS?.split(',').map(dest => dest.trim()) || [],
    },
    monitoring: {
      alertsEnabled: process.env.SECURITY_ALERTS_ENABLED === 'true',
      webhookUrl: process.env.SECURITY_WEBHOOK_URL,
    },
    audit: {
      retentionDays: parseInt(process.env.AUDIT_RETENTION_DAYS || '365'),
      encryptionEnabled: process.env.AUDIT_ENCRYPTION_ENABLED === 'true',
    },
  };
}

export function validateEnterpriseSecurityConfig(): void {
  const config = getEnterpriseSecurityConfig();
  
  if (config.enabled) {
    if (!config.aws.accessKeyId) {
      throw new Error('AWS_ACCESS_KEY_ID is required when enterprise security is enabled');
    }
    if (!config.aws.secretAccessKey) {
      throw new Error('AWS_SECRET_ACCESS_KEY is required when enterprise security is enabled');
    }
    if (!config.aws.region) {
      throw new Error('AWS_REGION is required when enterprise security is enabled');
    }
  }
}
