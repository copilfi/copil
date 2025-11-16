/**
 * Enterprise Audit & Monitoring Interface
 * Immutable logging with blockchain anchoring, compliance reporting, and real-time monitoring
 */
import { TimeRange, IntegrityIssue } from '../types/common.types';

export interface IAuditMonitoringService {
  // === Core Audit Operations ===
  logEvent(event: AuditEvent): Promise<string>; // Returns event ID
  logBatch(events: AuditEvent[]): Promise<string[]>; // Returns event IDs
  getAuditTrail(filters: AuditFilters): Promise<AuditTrail>;
  verifyAuditIntegrity(eventId: string): Promise<IntegrityVerification>;
  
  // === Blockchain Anchoring ===
  anchorAuditBatch(eventIds: string[]): Promise<AnchorProof>;
  verifyAnchorProof(proof: AnchorProof): Promise<boolean>;
  getAnchoredBatches(timeRange: TimeRange): Promise<AnchoredBatch[]>;
  
  // === Compliance & Reporting ===
  generateComplianceReport(request: ComplianceReportRequest): Promise<ComplianceReport>;
  exportAuditData(filters: AuditFilters, format: ExportFormat): Promise<ExportResult>;
  attestAuditData(timeRange: TimeRange, attester: string): Promise<Attestation>;
  
  // === Real-time Monitoring ===
  createMonitor(config: MonitorConfig): Promise<Monitor>;
  updateMonitor(monitorId: string, config: Partial<MonitorConfig>): Promise<boolean>;
  deleteMonitor(monitorId: string): Promise<boolean>;
  getMonitorAlerts(monitorId: string, timeRange: TimeRange): Promise<MonitorAlert[]>;
  
  // === Security & Forensics ===
  investigateIncident(incidentId: string): Promise<IncidentReport>;
  correlateEvents(correlationId: string): Promise<CorrelatedEvents>;
  reconstructUserSession(userId: number, sessionId: string): Promise<UserSession>;
  
  // === Data Management ===
  archiveAuditData(timeRange: TimeRange): Promise<ArchiveResult>;
  purgeAuditData(timeRange: TimeRange, justification: string): Promise<PurgeResult>;
  getDataRetentionStatus(): Promise<RetentionStatus>;
}

// === Core Event Types ===

export interface AuditEvent {
  id?: string; // Generated if not provided
  timestamp: Date;
  eventType: AuditEventType;
  category: EventCategory;
  severity: EventSeverity;
  userId?: number;
  sessionId?: string;
  requestId: string;
  correlationId?: string;
  source: EventSource;
  actor: EventActor;
  action: EventAction;
  resource: EventResource;
  outcome: EventOutcome;
  metadata: Record<string, any>;
  piiData?: PIIFields;
  complianceTags: ComplianceTag[];
  riskScore: number;
  immutable: boolean; // Whether this event can be modified
}

export enum AuditEventType {
  // Authentication & Authorization
  USER_LOGIN = 'user_login',
  USER_LOGOUT = 'user_logout',
  MFA_VERIFICATION = 'mfa_verification',
  SESSION_EXPIRED = 'session_expired',
  PRIVILEGE_ESCALATION = 'privilege_escalation',
  
  // Key Management
  KEY_GENERATION = 'key_generation',
  KEY_ROTATION = 'key_rotation',
  KEY_REVOCATION = 'key_revocation',
  KEY_ACCESS = 'key_access',
  THRESHOLD_OPERATION = 'threshold_operation',
  
  // Transaction Operations
  TRANSACTION_INITIATED = 'transaction_initiated',
  TRANSACTION_SIGNED = 'transaction_signed',
  TRANSACTION_SUBMITTED = 'transaction_submitted',
  TRANSACTION_CONFIRMED = 'transaction_confirmed',
  TRANSACTION_FAILED = 'transaction_failed',
  
  // Wallet Operations
  WALLET_CREATED = 'wallet_created',
  WALLET_FROZEN = 'wallet_frozen',
  WALLET_UNFROZEN = 'wallet_unfrozen',
  HOT_COLD_REBALANCE = 'hot_cold_rebalance',
  
  // Compliance & Security
  COMPLIANCE_CHECK = 'compliance_check',
  SANCTIONS_SCREENING = 'sanctions_screening',
  RISK_ASSESSMENT = 'risk_assessment',
  ANOMALY_DETECTED = 'anomaly_detected',
  SECURITY_INCIDENT = 'security_incident',
  
  // System Operations
  SYSTEM_STARTUP = 'system_startup',
  SYSTEM_SHUTDOWN = 'system_shutdown',
  CONFIGURATION_CHANGE = 'configuration_change',
  DEPLOYMENT = 'deployment',
  
  // Data Operations
  DATA_EXPORT = 'data_export',
  DATA_ARCHIVAL = 'data_archival',
  DATA_PURGE = 'data_purge',
  RETENTION_POLICY_APPLIED = 'retention_policy_applied',
}

export enum EventCategory {
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  CRYPTOGRAPHIC = 'cryptographic',
  TRANSACTION = 'transaction',
  COMPLIANCE = 'compliance',
  SECURITY = 'security',
  SYSTEM = 'system',
  DATA = 'data',
  OPERATIONAL = 'operational',
}

export enum EventSeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
  INFO = 'info',
}

export interface EventSource {
  service: string;
  component: string;
  version: string;
  environment: string;
  hostname: string;
  ipAddress: string;
}

export interface EventActor {
  type: 'user' | 'service' | 'system' | 'api_key';
  id: string;
  name?: string;
  permissions: string[];
  jurisdiction?: string;
}

export interface EventAction {
  type: string;
  method: string;
  parameters: Record<string, any>;
  apiEndpoint?: string;
}

export interface EventResource {
  type: string;
  id: string;
  name?: string;
  location?: string;
  sensitivity: 'public' | 'internal' | 'confidential' | 'restricted';
}

export interface EventOutcome {
  status: 'success' | 'failure' | 'partial' | 'timeout';
  errorCode?: string;
  errorMessage?: string;
  duration?: number; // ms
  affectedRecords?: number;
}

export interface PIIFields {
  email?: string;
  phone?: string;
  address?: string;
  ssn?: string;
  taxId?: string;
  // Tokenized versions for search
  emailToken?: string;
  phoneToken?: string;
}

export interface ComplianceTag {
  standard: 'SOX' | 'GDPR' | 'MiCA' | 'KYC' | 'AML' | 'SOC2' | 'ISO27001';
  requirement: string;
  category: string;
  evidence?: string;
}

// === Audit Trail & Filtering ===

export interface AuditTrail {
  events: AuditEvent[];
  totalCount: number;
  hasMore: boolean;
  nextCursor?: string;
  integrityHash: string;
  generatedAt: Date;
}

export interface AuditFilters {
  timeRange?: TimeRange;
  userIds?: number[];
  eventTypes?: AuditEventType[];
  categories?: EventCategory[];
  severities?: EventSeverity[];
  sources?: string[];
  actors?: string[];
  resources?: string[];
  outcomes?: EventOutcome['status'][];
  complianceTags?: string[];
  riskScoreRange?: { min: number; max: number };
  searchText?: string;
  includePII?: boolean;
  limit?: number;
  cursor?: string;
  customFilters?: any;
}

// === Blockchain Anchoring ===

export interface AnchorProof {
  batchId: string;
  eventIds: string[];
  merkleRoot: string;
  transactionHash: string;
  blockNumber: number;
  blockTimestamp: Date;
  network: string;
  anchoringTimestamp: Date;
  confirmations: number;
  previousAnchor?: string; // For chain verification
}

export interface AnchoredBatch {
  batchId: string;
  eventCount: number;
  merkleRoot: string;
  anchorProof: AnchorProof;
  integrityVerified: boolean;
  archivedAt: Date;
}

export interface IntegrityVerification {
  eventId: string;
  valid: boolean;
  merkleProof?: MerkleProof;
  anchorProof?: AnchorProof;
  verificationTimestamp: Date;
  issues: IntegrityIssue[];
}

export interface MerkleProof {
  root: string;
  leaf: string;
  proof: string[];
  path: number[];
}

// === Compliance & Reporting ===

export interface ComplianceReportRequest {
  standard: ComplianceTag['standard'];
  timeRange: TimeRange;
  format: 'PDF' | 'JSON' | 'XML' | 'CSV';
  includeEvidence: boolean;
  signReport: boolean;
  recipientEmail?: string;
  customFilters?: AuditFilters;
}

export interface ComplianceReport {
  id: string;
  standard: ComplianceTag['standard'];
  timeRange: TimeRange;
  generatedAt: Date;
  generatedBy: string;
  executiveSummary: ReportSummary;
  detailedFindings: ReportFinding[];
  evidence: ReportEvidence[];
  recommendations: string[];
  signature?: DigitalSignature;
  downloadUrl?: string;
}

export interface ReportSummary {
  totalEvents: number;
  criticalEvents: number;
  highRiskEvents: number;
  complianceScore: number; // 0-100
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  keyMetrics: Record<string, number>;
}

export interface ReportFinding {
  category: string;
  severity: EventSeverity;
  description: string;
  affectedEvents: number;
  recommendations: string[];
  evidenceReferences: string[];
}

export interface ReportEvidence {
  eventId: string;
  eventType: AuditEventType;
  timestamp: Date;
  description: string;
  dataUrl?: string;
  hash: string;
}

export interface DigitalSignature {
  algorithm: string;
  publicKey: string;
  signature: string;
  timestamp: Date;
  signerCertificate: string;
}

export enum ExportFormat {
  JSON = 'json',
  CSV = 'csv',
  XML = 'xml',
  PARQUET = 'parquet',
  PDF = 'pdf',
}

export interface ExportResult {
  exportId: string;
  format: ExportFormat;
  recordCount: number;
  fileSize: number;
  downloadUrl: string;
  expiresAt: Date;
  encryptionKey?: string;
  checksum: string;
}

export interface Attestation {
  id: string;
  timeRange: TimeRange;
  attester: string;
  attestationType: 'data_integrity' | 'compliance' | 'security' | 'operational';
  statement: string;
  evidenceHash: string;
  signature: DigitalSignature;
  timestamp: Date;
  blockchainAnchored: boolean;
}

// === Real-time Monitoring ===

export interface MonitorConfig {
  name: string;
  description: string;
  eventType: AuditEventType;
  filters: AuditFilters;
  conditions: MonitorCondition[];
  actions: MonitorAction[];
  enabled: boolean;
  throttlePeriod?: number; // seconds
  escalationPolicy?: EscalationPolicy;
}

export interface MonitorCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'matches';
  value: any;
  aggregation?: 'count' | 'sum' | 'avg' | 'max' | 'min';
  timeWindow?: number; // seconds
}

export interface MonitorAction {
  type: 'alert' | 'webhook' | 'email' | 'slack' | 'pagerduty' | 'block_operation';
  config: Record<string, any>;
  delay?: number; // seconds
}

export interface EscalationPolicy {
  levels: EscalationLevel[];
  autoResolveTimeout?: number; // seconds
}

export interface EscalationLevel {
  delay: number; // seconds
  actions: MonitorAction[];
}

export interface Monitor {
  id: string;
  config: MonitorConfig;
  status: 'active' | 'paused' | 'disabled';
  created: Date;
  updated: Date;
  lastTriggered?: Date;
  triggerCount: number;
  errorCount: number;
}

export interface MonitorAlert {
  id: string;
  monitorId: string;
  severity: EventSeverity;
  message: string;
  details: Record<string, any>;
  triggeredEvents: string[];
  triggeredAt: Date;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  escalated: boolean;
}

// === Security & Forensics ===

export interface IncidentReport {
  incidentId: string;
  severity: EventSeverity;
  type: string;
  description: string;
  timeline: IncidentTimeline[];
  affectedAssets: string[];
  rootCauseAnalysis: RootCauseAnalysis;
  impactAssessment: ImpactAssessment;
  recommendations: string[];
  status: 'investigating' | 'contained' | 'resolved' | 'closed';
}

export interface IncidentTimeline {
  timestamp: Date;
  event: string;
  severity: EventSeverity;
  details: Record<string, any>;
}

export interface RootCauseAnalysis {
  primaryCause: string;
  contributingFactors: string[];
  evidence: string[];
  confidenceLevel: number; // 0-100
}

export interface ImpactAssessment {
  financialImpact?: number;
  usersAffected: number;
  systemsAffected: string[];
  dataCompromised: boolean;
  regulatoryImpact: string[];
}

export interface CorrelatedEvents {
  correlationId: string;
  events: AuditEvent[];
  patterns: CorrelationPattern[];
  timeline: TimelineEntry[];
  summary: string;
}

export interface CorrelationPattern {
  type: string;
  description: string;
  confidence: number;
  events: string[];
}

export interface TimelineEntry {
  timestamp: Date;
  eventId: string;
  description: string;
}

export interface UserSession {
  sessionId: string;
  userId: number;
  startTime: Date;
  endTime?: Date;
  events: AuditEvent[];
  ipAddresses: string[];
  userAgents: string[];
  locations: string[];
  riskScore: number;
  anomalies: string[];
}

// === Data Management ===

export interface ArchiveResult {
  archiveId: string;
  eventCount: number;
  compressedSize: number;
  location: string;
  encryptionKey: string;
  checksum: string;
  archivedAt: Date;
  retentionUntil: Date;
}

export interface PurgeResult {
  purgeId: string;
  eventCount: number;
  justification: string;
  approvedBy: string;
  executedAt: Date;
  verificationHash: string;
}

export interface RetentionStatus {
  totalEvents: number;
  activeEvents: number;
  archivedEvents: number;
  pendingPurge: number;
  storageUtilization: {
    used: number;
    available: number;
    percentage: number;
  };
  policies: RetentionPolicy[];
}

export interface RetentionPolicy {
  category: EventCategory;
  retentionPeriod: number; // days
  archivalPeriod: number; // days
  autoPurge: boolean;
  complianceRequirements: string[];
}
