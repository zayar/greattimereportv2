export interface GTUserClaim {
  email?: string;
  name?: string;
  photo?: string;
  userId?: string;
  roles: string[];
  clinics: string[];
}

export interface Company {
  name: string;
}

export interface ClinicCounts {
  members?: number;
  bookings?: number;
  practitioners?: number;
}

export interface Clinic {
  id: string;
  logo?: string | null;
  name: string;
  company_id: string;
  code: string;
  pass?: string | null;
  currency?: string | null;
  company: Company;
  _count?: ClinicCounts;
}

export interface Business {
  id: string;
  name: string;
  clinics: Clinic[];
}

export type AiLanguage = "my-MM" | "en-US";

export type TelegramConnectionStatus = "not_linked" | "pending" | "linked";
export type TelegramReportType = "appointment" | "payment" | "owner_ai" | "weekly_summary";
export type TelegramDeliveryTrigger = "manual_test" | "scheduled" | "resend";
export type TelegramDeliveryOutcome = "sent" | "failed";
export type TelegramOwnerAiTone = "simple" | "professional" | "friendly";
export type TelegramOwnerAiFocusArea = "appointments" | "payments" | "risks" | "actions" | "tomorrow";
export type GtGrowthAiTelegramTargetPurpose =
  | "general_reports"
  | "owner_group"
  | "sales_lead"
  | "reception"
  | "finance"
  | "manager"
  | "other";
export type GtGrowthAiSalesAssistantLanguage = "my-MM" | "en-US";
export type TelegramWeeklySummaryDayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";
export type TelegramWeeklySummarySection =
  | "appointment_summary"
  | "service_summary"
  | "therapist_summary"
  | "payment_summary"
  | "top_services"
  | "busy_hours";

export interface TelegramDeliveryLogEntry {
  id: string;
  clinicId: string;
  clinicCode: string;
  clinicName: string;
  telegramChatId: string;
  reportType: TelegramReportType;
  trigger: TelegramDeliveryTrigger;
  outcome: TelegramDeliveryOutcome;
  attemptedAt: string;
  dateKey: string | null;
  timezone: string;
  appointmentCount: number | null;
  paymentCount: number | null;
  totalPaymentAmount: number | null;
  errorMessage: string | null;
}

export interface TelegramTargetStatus {
  clinicId: string;
  clinicCode: string;
  clinicName: string;
  telegramChatId: string | null;
  telegramChatType: "private" | "group" | "supergroup" | "channel" | null;
  telegramChatTitle: string | null;
  telegramLinkedAt: string | null;
  targetPurpose: GtGrowthAiTelegramTargetPurpose;
  isGtGrowthAiSalesAssistantEnabled: boolean;
  gtGrowthAiSalesAssistantTime: string;
  isGtGrowthAiOwnerProgressSummaryEnabled: boolean;
  gtGrowthAiOwnerProgressSummaryTime: string;
  isTodayAppointmentReportEnabled: boolean;
  reportTime: string;
  isTodayPaymentReportEnabled: boolean;
  paymentReportTime: string;
  isOwnerAiReportEnabled: boolean;
  ownerAiReportTime: string;
  ownerAiLanguage: AiLanguage;
  ownerAiTone: TelegramOwnerAiTone;
  ownerAiFocusAreas: TelegramOwnerAiFocusArea[];
  ownerAiCustomInstruction: string | null;
  isWeeklySummaryReportEnabled: boolean;
  weeklySummaryReportTime: string;
  weeklySummaryDayOfWeek: TelegramWeeklySummaryDayOfWeek;
  weeklySummarySections: TelegramWeeklySummarySection[];
  timezone: string;
  lastTestSentAt: string | null;
  lastScheduledSentAt: string | null;
  lastScheduledDateKey: string | null;
  lastPaymentTestSentAt: string | null;
  lastPaymentScheduledSentAt: string | null;
  lastPaymentScheduledDateKey: string | null;
  lastOwnerAiTestSentAt: string | null;
  lastOwnerAiScheduledSentAt: string | null;
  lastOwnerAiScheduledDateKey: string | null;
  lastWeeklySummaryTestSentAt: string | null;
  lastWeeklySummaryScheduledSentAt: string | null;
  lastWeeklySummaryScheduledDateKey: string | null;
  lastAppointmentFailureAt: string | null;
  lastAppointmentFailureReason: string | null;
  lastPaymentFailureAt: string | null;
  lastPaymentFailureReason: string | null;
  lastOwnerAiFailureAt: string | null;
  lastOwnerAiFailureReason: string | null;
  lastWeeklySummaryFailureAt: string | null;
  lastWeeklySummaryFailureReason: string | null;
  targetLabel: string;
  deliveryHistory: TelegramDeliveryLogEntry[];
}

export interface TelegramIntegrationStatus extends TelegramTargetStatus {
  pendingLinkCode: string | null;
  pendingLinkCodeExpiresAt: string | null;
  connectionStatus: TelegramConnectionStatus;
  linkedTargetLabel: string | null;
  linkedTargetCount: number;
  linkedTargets: TelegramTargetStatus[];
  botUsername: string | null;
  botUrl: string | null;
  botDeepLink: string | null;
  botGroupDeepLink: string | null;
}

export interface AiExecutiveSummaryResponse {
  summaryTitle: string;
  summaryText: string;
  topFindings: string[];
  recommendedActions: string[];
  warningText: string | null;
  languageUsed: AiLanguage;
  generatedAt: string;
}

export interface AiCustomerInsightResponse {
  customerArchetype: string;
  ownerSummary: string;
  businessMeaning: string;
  relationshipNote: string;
  riskNote: string | null;
  opportunityNote: string | null;
  recommendedAction: string;
  suggestedFollowUpMessage: string | null;
  languageUsed: AiLanguage;
  generatedAt: string;
}

export interface AiServiceInsightResponse {
  shortSummary: string;
  growthInsight: string;
  repeatRateInsight: string;
  packageOpportunity: string;
  staffingObservation: string | null;
  recommendedActions: string[];
  languageUsed: AiLanguage;
  generatedAt: string;
}

export type ReportAiReportType = "daily_appointment" | "daily_payment" | "weekly_summary";
export type ReportAiCategory =
  | "revenue"
  | "appointment"
  | "customer"
  | "package"
  | "staff"
  | "operations"
  | "risk"
  | "opportunity";
export type ReportAiSeverity = "info" | "warning" | "critical" | "success";
export type ReportAiConfidence = "low" | "medium" | "high";

export interface ReportAiEvidenceItem {
  label: string;
  value: string | number;
  comparison?: string;
}

export interface ReportAiInsight {
  id: string;
  reportType: ReportAiReportType;
  category: ReportAiCategory;
  severity: ReportAiSeverity;
  title: string;
  summary: string;
  evidence: ReportAiEvidenceItem[];
  recommendedAction: string;
  estimatedImpact?: string;
  confidence: ReportAiConfidence;
  createdAt: string;
}

export interface ReportNextAction {
  id: string;
  priority: "high" | "medium" | "low";
  actionType:
    | "call_customer"
    | "send_reminder"
    | "promote_time_slot"
    | "review_staff_utilization"
    | "follow_up_payment"
    | "rebook_customer"
    | "review_revenue_drop";
  title: string;
  description: string;
  reason: string;
  suggestedOwner?: string;
  dueDate?: string;
}

export type ReportBusinessOpportunityType =
  | "revenue_growth"
  | "package_sales"
  | "rebooking"
  | "collection"
  | "schedule_utilization"
  | "staff_performance"
  | "customer_retention";

export interface ReportBusinessOpportunity {
  id: string;
  reportType: ReportAiReportType;
  title: string;
  summary: string;
  opportunityType: ReportBusinessOpportunityType;
  estimatedValue?: number;
  estimatedValueLabel?: string;
  currency?: string;
  confidence: ReportAiConfidence;
  evidence: ReportAiEvidenceItem[];
  recommendedAction: string;
}

export interface GtGrowthAiSalesAssistantSettings {
  clinicId: string;
  language: GtGrowthAiSalesAssistantLanguage;
  maxTasksPerDay: number;
  enabledActionTypes: GtGrowthAiSalesActionType[];
  minPriorityScore: number;
  inactiveVipMinDays: number;
  vipMinLifetimeSpend: number;
  packageFollowUpMinInactiveDays: number;
  includePaymentFollowUp: boolean;
  ownerInstruction: string | null;
  updatedAt: string | null;
  updatedByUserId: string | null;
  updatedByEmail: string | null;
}

export interface ReportPremiumAccess {
  feature: "gt_growth_ai";
  enabled: boolean;
  title: string;
  message: string;
  upgradeMessage?: string;
  lockedReason?: string;
  teaser?: {
    insightCount?: number;
    opportunityCount?: number;
    estimatedOpportunityLabel?: string;
  };
}

export type GtGrowthAiSalesActionType =
  | "rebooking_opportunity"
  | "package_usage_follow_up"
  | "package_upsell_opportunity"
  | "inactive_vip_follow_up"
  | "payment_follow_up";

export type GtGrowthAiSalesActionStatus =
  | "new"
  | "assigned"
  | "contacted"
  | "replied"
  | "booked"
  | "purchased"
  | "skipped"
  | "closed";

export type GtGrowthAiSalesActionUpdateStatus = Exclude<GtGrowthAiSalesActionStatus, "new" | "assigned">;

export type GtGrowthAiActionPriority = "high" | "medium" | "low";

export interface GtGrowthAiSalesActionEvidence {
  label: string;
  value: string | number;
  comparison?: string;
}

export interface GtGrowthAiSalesAction {
  id: string;
  clinicId: string;
  clinicCode?: string;
  dateKey: string;
  actionType: GtGrowthAiSalesActionType;
  priority: GtGrowthAiActionPriority;
  priorityScore: number;
  title: string;
  summary: string;
  reason: string;
  recommendedAction: string;
  customer?: {
    customerKey?: string;
    customerName?: string;
    phoneMasked?: string;
    memberId?: string;
  };
  evidence: GtGrowthAiSalesActionEvidence[];
  suggestedMessage?: {
    language: AiLanguage;
    text: string;
  };
  estimatedValue?: number;
  estimatedValueLabel?: string;
  currency?: "MMK";
  source:
    | "bigquery"
    | "daily_appointment_report"
    | "daily_payment_report"
    | "weekly_summary_report"
    | "customer_portal"
    | "package_portal"
    | "payment_report";
  assignedToTargetId?: string | null;
  assignedToChatId?: string | null;
  assignedToLabel?: string | null;
  status: GtGrowthAiSalesActionStatus;
  statusNote?: string | null;
  createdAt: string;
  updatedAt: string;
  assignedAt?: string | null;
  lastStatusAt?: string | null;
  lastStatusByTelegramUserId?: string | null;
}

export interface GtGrowthAiSalesAssistantSummary {
  totalActions: number;
  highPriorityCount: number;
  rebookingCount: number;
  packageUsageCount: number;
  packageUpsellCount: number;
  inactiveVipCount: number;
  paymentFollowUpCount: number;
  estimatedTotalValue?: number;
  estimatedTotalValueLabel?: string;
  currency?: "MMK";
}

export interface GtGrowthAiSalesAssistantProgress {
  assigned: number;
  contacted: number;
  replied: number;
  booked: number;
  purchased: number;
  skipped: number;
  closed: number;
  pending: number;
  estimatedOpportunityHandled?: number;
  estimatedOpportunityHandledLabel?: string;
  currency?: "MMK";
}

export interface GtGrowthAiSalesAssistantResponse {
  premium: ReportPremiumAccess;
  summary?: GtGrowthAiSalesAssistantSummary;
  actions?: GtGrowthAiSalesAction[];
  lockedPreview?: {
    title: string;
    message: string;
    teaserBullets: string[];
  };
}

export type ClinicFeatureAccessSource = "environment" | "clinic_setting" | "default_locked";

export interface ClinicFeatureAccessStatus {
  clinicId: string;
  feature: "gt_growth_ai";
  enabled: boolean;
  source: ClinicFeatureAccessSource;
  title: string;
  message: string;
  upgradeMessage?: string;
  lockedReason?: string;
  updatedAt?: string | null;
  updatedByUserId?: string | null;
  updatedByEmail?: string | null;
}

export interface ClinicFeatureAccessResponse {
  gtGrowthAi: ClinicFeatureAccessStatus;
}

export interface ReportAiPayload {
  featureGate: "gt_growth_ai";
  isPremiumFeature: true;
  entitlementChecked: boolean;
  generatedAt: string;
  summary: string;
  insights: ReportAiInsight[];
  nextActions: ReportNextAction[];
  businessOpportunity: ReportBusinessOpportunity | null;
  dataQualityNotes: string[];
}

export type CustomerRelationshipSegment =
  | "package_bought_never_came"
  | "package_bought_not_used"
  | "unused_package_balance"
  | "inactive_vip"
  | "treatment_due"
  | "overdue_customer"
  | "high_value_no_recent_visit"
  | "new_customer_no_second_visit"
  | "declining_frequency"
  | "loyal_vip"
  | "healthy_active_customer";

export type CustomerRelationshipRiskLevel = "low" | "medium" | "high";
export type CustomerRelationshipRebookingStatus = "onTrack" | "dueSoon" | "overdue" | "unknown";
export type CustomerRelationshipFeedbackOutcome =
  | "called"
  | "messaged"
  | "booked"
  | "replied"
  | "no_reply"
  | "not_interested"
  | "wrong_number"
  | "other";
export type CustomerRelationshipFollowUpTone = "friendly" | "professional" | "soft" | "promotion";
export type CustomerRelationshipEvidenceType =
  | "package_usage"
  | "visit_pattern"
  | "risk_explanation"
  | "renewal_opportunity"
  | "none";
export type CustomerRelationshipIntent =
  | "package_bought_never_came"
  | "package_bought_not_used"
  | "unused_package_balance"
  | "follow_up_today"
  | "inactive_vip"
  | "churn_risk"
  | "treatment_due"
  | "high_value_no_recent_visit"
  | "customer_search"
  | "general_summary"
  | "unsupported";

export interface CustomerRelationshipPackageHolding {
  serviceName: string;
  packageName: string | null;
  serviceCategory: string;
  packageTotal: number;
  usedCount: number;
  remainingCount: number;
  latestUsageDate: string | null;
  latestTherapist: string | null;
  status?: string | null;
}

export interface CustomerRelationshipPackagePurchase {
  serviceName: string;
  packageName: string | null;
  serviceCategory: string;
  purchaseCount: number;
  latestPurchaseDate: string | null;
  totalAmount: number;
}

export interface CustomerRelationshipServiceUsage {
  serviceName: string;
  serviceCategory: string;
  counts: number[];
  totalUsage: number;
}

export interface CustomerRelationshipEvidenceMetric {
  label: string;
  value: string;
  tone?: "positive" | "neutral" | "attention";
}

export interface CustomerRelationshipJourneyEvent {
  date: string | null;
  title: string;
  detail: string;
  tone?: "positive" | "neutral" | "attention";
}

export interface CustomerRelationshipUsageHeatmap {
  year: number;
  months: string[];
  services: CustomerRelationshipServiceUsage[];
  summary: {
    totalUsage: number;
    distinctServices: number;
  };
}

export interface CustomerRelationshipPaymentEvidence {
  summary: {
    totalSpent: number;
    invoiceCount: number;
    averageInvoice: number;
    outstandingAmount: number;
  };
  rows: Array<{
    dateLabel: string;
    invoiceNumber: string;
    serviceName: string;
    servicePackageName: string | null;
    paymentMethod: string;
    salePerson: string;
    invoiceTotal: number;
    discount: number;
    netAmount: number;
    outstandingAmount: number;
    paymentStatus: string;
  }>;
  totalCount: number;
}

export interface CustomerRelationshipEvidence {
  targetCustomer: {
    customerKey: string;
    customerName: string;
    customerPhoneMasked: string;
  };
  evidenceType: CustomerRelationshipEvidenceType;
  title: string;
  insight: string;
  metrics: CustomerRelationshipEvidenceMetric[];
  packages: CustomerRelationshipPackageHolding[];
  payments: CustomerRelationshipPaymentEvidence | null;
  usageHeatmap: CustomerRelationshipUsageHeatmap | null;
  journey: CustomerRelationshipJourneyEvent[];
}

export interface CustomerRelationshipProfile {
  clinicId: string;
  clinicCode: string;
  customerKey: string;
  customerName: string;
  customerPhoneMasked: string;
  customerPhoneDigitsHash?: string;
  memberId?: string | null;
  firstSeenDate: string | null;
  lastVisitDate: string | null;
  daysSinceLastVisit: number | null;
  lastPaymentDate: string | null;
  lastPackagePurchaseDate: string | null;
  lastPackageServiceName: string | null;
  lastPackageName: string | null;
  totalVisits: number;
  lifetimeSpend: number;
  averageSpend: number;
  recent90DayVisits: number;
  previous90DayVisits: number;
  preferredService: string | null;
  preferredServiceCategory: string | null;
  preferredTherapist: string | null;
  preferredDayOfWeek: string | null;
  preferredHour: number | null;
  lastService: string | null;
  lastPaymentMethod: string | null;
  packagePurchaseCount: number;
  activePackageCount: number;
  totalPackageSessions: number;
  usedPackageSessions: number;
  remainingPackageSessions: number;
  packageHoldings: CustomerRelationshipPackageHolding[];
  packagePurchases: CustomerRelationshipPackagePurchase[];
  serviceUsageByMonth: CustomerRelationshipServiceUsage[];
  packageBoughtNeverCame: boolean;
  packageBoughtButNoUsage: boolean;
  hasUnusedPackageBalance: boolean;
  relationshipHealthScore: number;
  riskLevel: CustomerRelationshipRiskLevel;
  rebookingStatus: CustomerRelationshipRebookingStatus;
  segments: CustomerRelationshipSegment[];
  reasons: string[];
  nextBestAction: string;
  priorityScore: number;
  lastFollowUpAt: string | null;
  lastFollowUpOutcome: string | null;
  followUpCount: number;
  learnedAt: string;
  sourceLookbackDays: number;
}

export interface CustomerRelationshipLearningSummary {
  learnedAt: string;
  totalCustomersAnalyzed: number;
  profilesSaved: number;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
  segmentCounts: Record<string, number>;
}

export interface CustomerRelationshipProfilesResponse {
  rows: CustomerRelationshipProfile[];
  totalCount: number;
  lastLearnedAt: string | null;
  sourceLookbackDays: number | null;
}

export interface CustomerRelationshipAgentRow {
  customerKey: string;
  customerName: string;
  customerPhoneMasked: string;
  lastVisitDate: string | null;
  daysSinceLastVisit: number | null;
  lastService: string | null;
  lastPackageServiceName: string | null;
  lastPackageName: string | null;
  remainingPackageSessions: number;
  packageHoldings: CustomerRelationshipPackageHolding[];
  packagePurchases: CustomerRelationshipPackagePurchase[];
  lifetimeSpend: number;
  riskLevel: CustomerRelationshipRiskLevel;
  segments: CustomerRelationshipSegment[];
  reasons: string[];
  nextBestAction: string;
  priorityScore: number;
  lastFollowUpAt: string | null;
  lastFollowUpOutcome: string | null;
  followUpCount: number;
}

export interface CustomerRelationshipAgentResponse {
  detectedIntent: CustomerRelationshipIntent;
  answerSummary: string;
  reasonBullets: string[];
  evidenceNarrative: string;
  matchedCount: number;
  recommendedActions: string[];
  rows: CustomerRelationshipAgentRow[];
  evidence?: CustomerRelationshipEvidence | null;
  dataFreshnessNote: string;
  learnedAt: string | null;
  sourceLookbackDays: number | null;
  nextQuestionSuggestions?: string[];
  suggestions?: string[];
  usedFallback: boolean;
}

export interface CustomerRelationshipFollowUpMessage {
  message: string;
  reason: string;
  customerName: string;
  segments: CustomerRelationshipSegment[];
  languageUsed: AiLanguage;
  usedFallback: boolean;
}

export interface AppointmentRow {
  bookingid: string;
  FromTime: string;
  ToTime: string;
  ServiceName: string;
  MemberName: string;
  MemberPhoneNumber: string;
  PractitionerName: string;
  ClinicName: string;
  ClinicCode: string;
  ClinicID: string;
  HelperName?: string | null;
  status: string;
  member_note?: string | null;
}

export interface CheckInOutRow {
  id: string;
  in_time: string;
  out_time?: string | null;
  status: string;
  created_at: string;
  isUsePurchaseService?: boolean | null;
  merchant_note?: string | null;
  order_id?: string | null;
  service?: {
    id: string;
    name: string;
  } | null;
  practitioner?: {
    id: string;
    name: string;
  } | null;
  member?: {
    name: string;
    phonenumber?: string | null;
    clinic_members?: Array<{
      name: string;
      phonenumber?: string | null;
      clinic_id: string;
    }>;
  } | null;
  booking?: {
    service_helper?: {
      id: string;
      name: string;
    } | null;
  } | null;
  helper?: {
    name: string;
  } | null;
  orders?: {
    order_id?: string | null;
    discount?: number | string | null;
    tax?: number | string | null;
    total?: number | string | null;
    net_total?: number | string | null;
    payment_method?: string | null;
    payment_status?: string | null;
    seller?: {
      display_name?: string | null;
    } | null;
  } | null;
}

export interface CheckInOrderItemRow {
  id: string;
  price: number | string;
  total?: number | string | null;
  service_id: string;
  order_id: string;
}

export interface OrderRow {
  id: string;
  order_id: string;
  created_at: string;
  net_total: number | string;
  total: number | string;
  discount?: number | string;
  tax?: number | string;
  payment_method?: string | null;
  payment_status?: string | null;
  balance?: number | string;
  credit_balance?: number | string;
  member: {
    name: string;
    clinic_members?: Array<{
      name: string;
      clinic_id: string;
    }>;
  };
  user?: {
    name: string;
  };
  seller?: {
    display_name?: string | null;
  };
}

export interface MemberRow {
  id: string;
  name: string;
  phonenumber: string;
  member_id?: string | null;
  image?: string | null;
  status: string;
  created_at: string;
}

export interface ServiceRow {
  id: string;
  image?: string | null;
  clinic_id: string;
  name: string;
  original_price?: number | string | null;
  price?: number | string | null;
  description?: string | null;
  status: string;
  created_at: string;
  sort_order?: number | null;
  tax?: number | string | null;
  duration?: number | null;
  interval_day?: number | null;
  max_duration_count?: number | null;
}

export interface ServicePackageRow {
  id: string;
  image?: string | null;
  name: string;
  price?: number | string | null;
  original_price?: number | string | null;
  status: string;
  sort_order?: number | null;
  tax?: number | string | null;
  description?: string | null;
  clinic_id: string;
  expiry_day?: number | null;
  created_at: string;
  isLock?: boolean | null;
}

export interface ServiceTypeCategoryRow {
  id: string;
  is_private?: boolean | null;
  name: string;
  image?: string | null;
  status: string;
  created_at: string;
  description?: string | null;
  order?: number | null;
  sale_channel?: string | null;
}

export interface ServiceFormTerm {
  id: string;
  term: string;
  status?: string | null;
  type: string;
}

export interface ServiceFormRow {
  id: string;
  name: string;
  legal_desc?: string | null;
  form_type: string;
  description?: string | null;
  status: string;
  consent_image?: string | null;
  consent_sign_align?: string | null;
  terms?: ServiceFormTerm[];
}

export interface ProductRow {
  id: string;
  name: string;
  sort_order?: number | null;
  status: string;
  description?: string | null;
  created_at: string;
  clinic_id: string;
  measurement?: {
    id: string;
    name: string;
    description?: string | null;
  } | null;
  images: Array<{
    image?: string | null;
  }>;
  measurement_amount?: number | string | null;
  measurement_id?: string | null;
  brand_id?: string | null;
  brand?: {
    image?: string | null;
    name: string;
    id: string;
  } | null;
}

export interface ProductStockItemRow {
  id: string;
  name: string;
  price?: number | string | null;
  sku?: string | null;
  sort_order?: number | null;
  status: string;
  stock?: number | null;
  stock_control_unit?: string | null;
  supply_price?: number | string | null;
  tax?: number | string | null;
  service_stock?: number | null;
  clinic_id: string;
  created_at: string;
  original_price?: number | string | null;
  images: Array<{
    image?: string | null;
  }>;
  product_id?: string | null;
  product?: {
    name: string;
    id: string;
  } | null;
}

export interface InventoryHistoryRow {
  id: string;
  qty: number;
  closing_qty: number;
  stock_date: string;
  transaction_type?: string | null;
  description?: string | null;
  ref_id?: string | null;
  ref_type?: string | null;
  ref_detail_id?: string | null;
  stock_id: string;
  created_at: string;
  stock: {
    id: string;
    name: string;
    product?: {
      id: string;
      name: string;
    } | null;
  };
}

export interface InventoryReportRow {
  id: string;
  name: string;
  current_qty: number;
  received_qty: number;
  sale_qty: number;
  adjustment_in_qty: number;
  adjustment_out_qty: number;
}

export interface StockSummaryRow {
  id: string;
  name: string;
  opening_qty: number;
  in_qty: number;
  out_qty: number;
  closing_qty: number;
}

export interface DashboardMetricValue {
  value: number;
  previousValue: number;
  change: number;
}

export interface DashboardResponse {
  summary: {
    revenue: DashboardMetricValue;
    invoices: DashboardMetricValue;
    customers: DashboardMetricValue;
    appointments: DashboardMetricValue;
    servicesDelivered: DashboardMetricValue;
    averageInvoice: DashboardMetricValue;
  };
  trend: {
    granularity: "day" | "week" | "month";
    points: Array<{
      bucketLabel: string;
      revenue: number;
      previousRevenue: number;
    }>;
  };
  spotlights: Array<{
    title: string;
    value: number;
    change: number;
    detail: string;
  }>;
  topServices: Array<{
    serviceName: string;
    revenue: number;
    bookings: number;
    contributionPct: number;
  }>;
  paymentMix: Array<{
    paymentMethod: string;
    totalAmount: number;
    transactionCount: number;
    contributionPct: number;
  }>;
  topTherapists: Array<{
    therapistName: string;
    completedServices: number;
    serviceValue: number;
    lastVisitDate: string;
  }>;
  insights: Array<{
    title: string;
    detail: string;
    tone: "positive" | "watch" | "neutral";
  }>;
}

export interface CustomerBehaviorResponse {
  summary: {
    uniqueCustomers: number;
    visits: number;
    avgVisitsPerCustomer: number;
  };
  trend: Array<{ bucket: string; uniqueCustomers: number; visits: number }>;
  topCustomers: Array<{ customerName: string; visitCount: number; lastVisitDate: string }>;
}

export interface ServiceBehaviorResponse {
  summary: {
    totalBookings: number;
    distinctServices: number;
    avgBookingsPerService: number;
  };
  trend: Array<{ bucket: string; totalBookings: number }>;
  topServices: Array<{ serviceName: string; bookingCount: number }>;
  practitionerServices: Array<{
    practitionerName: string;
    serviceName: string;
    bookingCount: number;
  }>;
}

export interface TherapistPortalResponse {
  summary: {
    totalTherapists: number;
    activeTherapists: number;
    totalTreatments: number;
    customersServed: number;
    averageTreatmentsPerTherapist: number;
    repeatCustomerContribution: number;
    averageUtilizationScore: number;
  };
  highlight: {
    therapistName: string;
    treatmentsCompleted: number;
    customersServed: number;
    repeatCustomerRate: number;
    estimatedTreatmentValue: number;
    topService: string;
    growthRate: number;
    utilizationScore: number;
    topTherapistShare: number;
  } | null;
  trend: Array<{
    bucket: string;
    treatmentsCompleted: number;
    customersServed: number;
    estimatedTreatmentValue: number;
  }>;
  leaderboard: Array<{
    therapistName: string;
    treatmentsCompleted: number;
    customersServed: number;
    repeatCustomers: number;
    repeatCustomerRate: number;
    estimatedTreatmentValue: number;
    averageTreatmentValue: number;
    activeDays: number;
    lastTreatmentDate: string | null;
    topService: string;
    topServiceShare: number;
    topCategory: string;
    growthRate: number;
    utilizationScore: number;
    workloadBand: string;
  }>;
  topServices: Array<{
    serviceName: string;
    treatmentsCompleted: number;
    therapistCount: number;
    estimatedTreatmentValue: number;
  }>;
  serviceMix: Array<{
    serviceCategory: string;
    treatmentsCompleted: number;
    estimatedTreatmentValue: number;
  }>;
  filterOptions: {
    serviceCategories: string[];
  };
  insights: Array<{
    id: string;
    tone: "positive" | "attention" | "neutral";
    title: string;
    detail: string;
  }>;
  assumptions: string[];
}

export interface TherapistPortalOverviewResponse {
  therapist: {
    therapistName: string;
    treatmentsCompleted: number;
    customersServed: number;
    repeatCustomers: number;
    repeatCustomerRate: number;
    estimatedTreatmentValue: number;
    averageTreatmentValue: number;
    activeDays: number;
    averageTreatmentsPerActiveDay: number;
    topService: string;
    topServiceShare: number;
    topCategory: string;
    serviceBreadth: number;
    lastTreatmentDate: string | null;
    growthRate: number;
    utilizationScore: number;
    workloadBand: string;
  };
  trend: Array<{
    bucket: string;
    treatmentsCompleted: number;
    customersServed: number;
    estimatedTreatmentValue: number;
  }>;
  topServices: Array<{
    serviceName: string;
    serviceCategory: string;
    treatmentsCompleted: number;
    customersServed: number;
    repeatCustomers: number;
    repeatCustomerRate: number;
    estimatedTreatmentValue: number;
  }>;
  serviceMix: Array<{
    serviceCategory: string;
    treatmentsCompleted: number;
    estimatedTreatmentValue: number;
  }>;
  recentCustomers: Array<{
    customerName: string;
    phoneNumber: string;
    memberId: string;
    visitCount: number;
    estimatedTreatmentValue: number;
    lastVisitDate: string | null;
    lastService: string;
    relationship: string;
  }>;
  busiestPeriods: {
    weekdays: Array<{
      label: string;
      treatmentCount: number;
    }>;
    hours: Array<{
      label: string;
      treatmentCount: number;
    }>;
  };
  insights: Array<{
    id: string;
    tone: "positive" | "attention" | "neutral";
    title: string;
    detail: string;
  }>;
  recommendedAction: string;
  assumptions: string[];
}

export interface TherapistPortalCustomersResponse {
  summary: {
    customersServed: number;
    repeatCustomers: number;
    averageTreatmentValuePerCustomer: number;
  };
  rows: Array<{
    customerName: string;
    phoneNumber: string;
    memberId: string;
    visitCount: number;
    estimatedTreatmentValue: number;
    lastVisitDate: string | null;
    lastService: string;
    relationship: string;
  }>;
  totalCount: number;
}

export interface TherapistPortalTreatmentsResponse {
  rows: Array<{
    checkInTime: string;
    customerName: string;
    phoneNumber: string;
    memberId: string;
    serviceName: string;
    serviceCategory: string;
    estimatedTreatmentValue: number;
  }>;
  totalCount: number;
}

export interface ServicePortalListResponse {
  summary: {
    serviceCount: number;
    totalRevenue: number;
    totalBookings: number;
    totalCustomers: number;
    averageRepeatRate: number;
    averagePrice: number;
    packageRevenueShare: number;
  };
  filterOptions: {
    serviceCategories: string[];
  };
  rows: Array<{
    serviceName: string;
    serviceCategory: string;
    totalRevenue: number;
    bookingCount: number;
    customerCount: number;
    averageSellingPrice: number;
    repeatPurchaseRate: number;
    lastBookedDate: string | null;
    topTherapist: string;
    packageMixPct: number;
    oneOffMixPct: number;
    growthRate: number;
    highValueCustomers: number;
  }>;
}

export interface ServicePortalOverviewResponse {
  service: {
    serviceName: string;
    serviceCategory: string;
    totalRevenue: number;
    bookingCount: number;
    customerCount: number;
    averageSellingPrice: number;
    repeatPurchaseRate: number;
    lastBookedDate: string | null;
    topTherapist: string;
    topTherapistShare: number;
    packageMixPct: number;
    oneOffMixPct: number;
    growthRate: number;
    averageDiscountRate: number;
    packageRemainingUsage: number;
    revenuePerCustomer: number;
    status: string;
  };
  trend: Array<{
    bucket: string;
    revenue: number;
    bookings: number;
    customers: number;
    averagePrice: number;
    discountRate: number;
  }>;
  therapistPerformance: Array<{
    therapistName: string;
    bookingCount: number;
    customerCount: number;
    revenue: number;
    averagePrice: number;
    latestVisitDate: string | null;
  }>;
  paymentMix: Array<{
    paymentMethod: string;
    totalAmount: number;
    transactionCount: number;
    contributionPct: number;
  }>;
  topCustomers: Array<{
    customerName: string;
    phoneNumber: string;
    memberId: string;
    totalRevenue: number;
    visitCount: number;
    lastVisitDate: string | null;
    relationship: string;
    rank: number;
  }>;
  relatedServices: Array<{
    serviceName: string;
    serviceCategory: string;
    sharedCustomerCount: number;
    pairCount: number;
  }>;
  peakPeriods: {
    weekdays: Array<{
      label: string;
      bookingCount: number;
    }>;
    hours: Array<{
      label: string;
      bookingCount: number;
    }>;
  };
  insights: Array<{
    id: string;
    tone: "positive" | "attention" | "neutral";
    title: string;
    detail: string;
  }>;
  recommendedAction: string;
  assumptions: string[];
}

export interface ServicePortalCustomersResponse {
  summary: {
    customerCount: number;
    repeatCustomers: number;
    averageRevenuePerCustomer: number;
  };
  rows: Array<{
    customerName: string;
    phoneNumber: string;
    memberId: string;
    totalRevenue: number;
    visitCount: number;
    lastVisitDate: string | null;
    relationship: string;
  }>;
  totalCount: number;
}

export interface ServicePortalPaymentsResponse {
  summary: {
    totalRevenue: number;
    invoiceCount: number;
    averageLineValue: number;
    averageDiscountRate: number;
  };
  rows: Array<{
    dateLabel: string;
    invoiceNumber: string;
    customerName: string;
    phoneNumber: string;
    memberId: string;
    servicePackageName: string | null;
    paymentMethod: string;
    salePerson: string;
    itemQuantity: number;
    unitPrice: number;
    lineTotal: number;
    discountAmount: number;
    outstandingAmount: number;
  }>;
  totalCount: number;
}

export interface PackagePortalResponse {
  summary: {
    totalPackagesSold: number;
    activePackageCustomers: number;
    totalUnitsSold: number;
    totalUnitsUsed: number;
    totalUnitsRemaining: number;
    customersNeedingFollowUp: number;
    inactive30Count: number;
    inactive60Count: number;
    inactive90Count: number;
  };
  filterOptions: {
    packages: Array<{
      id: string;
      name: string;
    }>;
    categories: string[];
    therapists: string[];
    salespeople: string[];
    statuses: string[];
    inactivityBuckets: string[];
  };
  performanceRows: Array<{
    packageId: string;
    packageName: string;
    category: string;
    soldCount: number;
    totalSoldUnits: number;
    usedUnits: number;
    remainingUnits: number;
    activeCustomers: number;
    completedCustomers: number;
    inactiveCustomers: number;
    latestPurchaseDate: string | null;
    latestUsageDate: string | null;
    usageRatePct: number;
    followUpSummary: string;
    followUpCount: number;
    atRiskCount: number;
  }>;
  followUpRows: Array<{
    id: string;
    packageId: string;
    customerName: string;
    customerPhone: string;
    memberId: string;
    packageName: string;
    category: string;
    purchaseDate: string;
    purchaseCount: number;
    purchasedUnits: number;
    usedUnits: number;
    remainingUnits: number;
    lastVisitDate: string | null;
    daysSinceLastVisit: number | null;
    daysSinceActivity: number;
    therapist: string;
    salesperson: string;
    status: string;
    statusLabel: string;
    inactivityBucket: string;
    inactivityLabel: string;
    needsFollowUp: boolean;
  }>;
  assumptions: string[];
}

export interface PackagePortalDetailResponse {
  package: {
    packageId: string;
    packageName: string;
    category: string;
    soldCount: number;
    totalSoldUnits: number;
    totalUsedUnits: number;
    totalRemainingUnits: number;
    averageUsageRatePct: number;
    activeCustomers: number;
    completedCustomers: number;
    inactiveCustomers: number;
  } | null;
  customers: PackagePortalResponse["followUpRows"];
  assumptions: string[];
}

export interface PaymentReportResponse {
  summary: {
    totalAmount: number;
    invoiceCount: number;
    methodsCount: number;
    averageInvoice: number;
  };
  methods: Array<{
    paymentMethod: string;
    totalAmount: number;
    transactionCount: number;
  }>;
  rows: Array<{
    dateLabel: string;
    invoiceNumber: string;
    customerName: string;
    memberId: string;
    salePerson: string;
    serviceName: string;
    servicePackageName?: string | null;
    itemQuantity?: number | null;
    itemPrice?: number | null;
    itemTotal?: number | null;
    subTotal?: number | null;
    total?: number | null;
    discount?: number | null;
    netTotal?: number | null;
    orderBalance?: number | null;
    orderCreditBalance?: number | null;
    tax?: number | null;
    paymentMethod?: string | null;
    paymentStatus?: string | null;
    paymentType?: string | null;
    paymentAmount?: number | null;
    paymentNote?: string | null;
    walletTopUp?: string | number | null;
    invoiceNetTotal: number;
  }>;
  totalCount: number;
  premium?: ReportPremiumAccess;
  gtGrowthAi?: ReportAiPayload;
}

export interface AppointmentReportResponse {
  clinicName: string;
  dateKey: string;
  timezone: string;
  totalAppointments: number;
  upcomingCount: number;
  completedCount: number;
  cancelledCount: number;
  noShowCount: number;
  cancellationRatePercent: number | null;
  noShowRatePercent: number | null;
  appointments: Array<{
    time: string;
    customerName: string;
    serviceName: string;
    therapistName: string;
    status: string;
  }>;
  topServices: Array<{ serviceName: string; count: number }>;
  therapistLoad: Array<{ therapistName: string; count: number }>;
  busyHours: Array<{ label: string; count: number }>;
  underutilizedHours: Array<{ label: string; count: number }>;
  completedCustomersWithoutFutureBookingCount: number | null;
  premium?: ReportPremiumAccess;
  gtGrowthAi?: ReportAiPayload;
}

export interface WeeklySummaryReportResponse {
  clinicName: string;
  dateKey: string;
  weekStartDateKey: string;
  weekEndDateKey: string;
  timezone: string;
  selectedSections: TelegramWeeklySummarySection[];
  appointmentSummary: {
    totalAppointments: number;
    completedAppointments: number;
    cancelledAppointments: number;
    noShowAppointments: number;
    completionRatePercent: number | null;
    cancellationRatePercent: number | null;
    noShowRatePercent: number | null;
  };
  serviceSummary: Array<{ name: string; count: number }>;
  therapistSummary: Array<{ name: string; count: number }>;
  paymentSummary: {
    totalPaymentAmount: number;
    paymentCount: number;
    paymentMethods: Array<{ paymentMethod: string; count: number; amount: number }>;
    previousWeekTotalPaymentAmount: number | null;
    weekOverWeekRevenueChangePercent: number | null;
  };
  topServices: Array<{ name: string; count: number; percentage: number | null }>;
  busyHours: Array<{ label: string; count: number }>;
  busyDays: Array<{ label: string; count: number }>;
  underutilizedDays: Array<{ label: string; count: number }>;
  underutilizedHours: Array<{ label: string; count: number }>;
  weekOverWeekAppointmentChangePercent: number | null;
  previousWeekAppointmentCount: number | null;
  previousWeekCancelledAppointments: number | null;
  packageSalesSummary: string | null;
  customerRetentionOpportunityCount: number | null;
  premium?: ReportPremiumAccess;
  gtGrowthAi?: ReportAiPayload;
}

export interface WalletAccountSummaryRow {
  id?: string;
  name: string;
  phoneNumber: string;
  balance: number;
  transactionCount: number;
}

export interface WalletAccountsResponse {
  summary: {
    accountCount: number;
    totalBalance: number;
    totalTransactionCount: number;
    averageBalance: number;
    highestBalance: number;
  };
  rows: WalletAccountSummaryRow[];
  totalCount: number;
}

export interface WalletTransactionRow {
  dateLabel: string;
  transactionNumber: string;
  type: string;
  status: string;
  amount: number;
  balance: number;
  comment: string;
  accountName: string;
  senderName: string;
  senderPhone: string;
  recipientName: string;
  recipientPhone: string;
}

export interface WalletAccountTransactionsResponse {
  rows: WalletTransactionRow[];
  totalCount: number;
}

export interface WalletTransactionsResponse {
  summary: {
    totalIn: number;
    totalOut: number;
    transactionCount: number;
    netMovement: number;
  };
  rows: WalletTransactionRow[];
  totalCount: number;
}

export interface OfferCategoryRow {
  id: string;
  image?: string | null;
  name: string;
  sort_order?: number | null;
  status: string;
  description?: string | null;
  clinic_id: string;
  created_at: string;
}

export interface OfferImageRow {
  id: string;
  name?: string | null;
  image?: string | null;
}

export interface OfferRow {
  id: string;
  image?: string | null;
  name: string;
  sort_order?: number | null;
  hight_light?: string | null;
  expired_date?: string | null;
  description?: string | null;
  clinic_id: string;
  category_id?: string | null;
  category?: {
    id: string;
    name: string;
  } | null;
  term_and_condition?: string | null;
  status: string;
  images?: OfferImageRow[];
  metadata?: string | null;
  created_at: string;
}

export interface SalesBySellerResponse {
  sellers: Array<{
    sellerName: string;
    invoiceCount: number;
    totalAmount: number;
  }>;
  recentTransactions: Array<{
    dateLabel: string;
    invoiceNumber: string;
    customerName: string;
    serviceName: string;
    servicePackageName?: string | null;
    sellerName: string;
    paymentMethod?: string;
    paymentStatus?: string;
    totalAmount: number;
  }>;
  totalCount: number;
}

export interface DailyTreatmentResponse {
  selectedDate: string;
  summary: {
    totalTreatments: number;
    therapists: number;
    uniqueServices: number;
  };
  uniqueServices: string[];
  serviceTotals: Array<{
    serviceName: string;
    totalServices: number;
  }>;
  matrix: Array<{
    therapistName: string;
    services: Record<string, number>;
    totalServices: number;
  }>;
  records: Array<{
    checkInTime: string;
    therapistName: string;
    serviceName: string;
    customerName: string;
    customerPhone?: string | null;
  }>;
}

export interface SalesReportResponse {
  summary: {
    totalRevenue: number;
    invoiceCount: number;
    customerCount: number;
    averageInvoice: number;
  };
  trend: Array<{
    dateLabel: string;
    totalRevenue: number;
    invoiceCount: number;
  }>;
  topServices: Array<{
    serviceName: string;
    totalRevenue: number;
    invoiceCount: number;
  }>;
  rows: Array<{
    dateLabel: string;
    invoiceNumber: string;
    customerName: string;
    salePerson: string;
    serviceName: string;
    paymentMethod: string;
    totalAmount: number;
  }>;
  totalCount: number;
}

export interface BankingSummaryResponse {
  summary: {
    totalRevenue: number;
    transactionCount: number;
    methodsCount: number;
    averageTicket: number;
  };
  methods: Array<{
    paymentMethod: string;
    totalAmount: number;
    transactionCount: number;
    averageTicket: number;
  }>;
  rows: Array<{
    dateLabel: string;
    invoiceNumber: string;
    customerName: string;
    memberId: string;
    salePerson: string;
    serviceName: string;
    servicePackageName?: string | null;
    paymentMethod: string;
    paymentStatus: string;
    walletTopUp?: string | number | null;
    invoiceNetTotal: number;
  }>;
  totalCount: number;
}

export interface CustomersBySalespersonResponse {
  sellers: string[];
  summary: {
    customerCount: number;
    totalSpend: number;
    averageSpend: number;
  };
  customers: Array<{
    name: string;
    phoneNumber: string;
    memberId: string;
    totalSpend: number;
    lastInvoiceNumber: string;
    lastPurchaseDate: string;
  }>;
  totalCount: number;
}

export interface CustomerPortalListResponse {
  summary: {
    totalCustomers: number;
    activeCustomers: number;
    returningCustomers: number;
    atRiskCustomers: number;
    dormantCustomers: number;
    totalRevenue: number;
    averageSpend: number;
    averageVisits: number;
  };
  filterOptions: {
    therapists: string[];
    serviceCategories: string[];
    spendTiers: string[];
    statuses: string[];
  };
  rows: Array<{
    customerName: string;
    phoneNumber: string;
    memberId: string;
    lifetimeSpend: number;
    averageSpend: number;
    joinedDate: string | null;
    lastVisitDate: string | null;
    daysSinceLastVisit: number | null;
    visitCount: number;
    lastService: string;
    primaryTherapist: string;
    lastPaymentMethod: string;
    status: string;
    spendTier: string;
    packageStatus: string;
    remainingSessions: number;
    serviceCategory: string;
    churnRiskLevel: "low" | "medium" | "high";
    rebookingStatus: "dueSoon" | "overdue" | "onTrack" | "unknown";
    healthScore: number;
  }>;
  totalCount: number;
}

export interface CustomerPortalOverviewResponse {
  customer: {
    customerName: string;
    phoneNumber: string;
    memberId: string;
    joinedDate: string | null;
    dateOfBirth: string | null;
    lastVisitDate: string | null;
    lifetimeSpend: number;
    totalVisits: number;
    averageSpendPerVisit: number;
    preferredService: string;
    preferredServiceCategory: string;
    preferredTherapist: string;
    lastPaymentMethod: string;
    daysSinceLastVisit: number | null;
    remainingSessions: number;
    recent3MonthVisits: number;
    previous3MonthVisits: number;
    avgVisitIntervalDays: number | null;
    categoryBreadth: number;
    spendTier: string;
    status: string;
    badges: string[];
  };
  trend: Array<{
    bucket: string;
    revenue: number;
    visits: number;
  }>;
  therapistRelationship: Array<{
    therapistName: string;
    visitCount: number;
    serviceValue: number;
    latestVisitDate: string;
  }>;
  serviceMix: Array<{
    serviceCategory: string;
    visitCount: number;
    serviceValue: number;
  }>;
  recentServices: Array<{
    serviceName: string;
    lastUsedDate: string;
    visitCount: number;
  }>;
  insights: Array<{
    id: string;
    tone: "positive" | "attention" | "neutral";
    title: string;
    detail: string;
  }>;
  recommendedAction: string;
  assumptions: string[];
}

export interface CustomerQuickViewResponse {
  customer: CustomerPortalOverviewResponse["customer"];
  insights: CustomerPortalOverviewResponse["insights"];
  recommendedAction: string;
  recentServices: CustomerPortalOverviewResponse["recentServices"];
  therapistRelationship: CustomerPortalOverviewResponse["therapistRelationship"];
  serviceMix: CustomerPortalOverviewResponse["serviceMix"];
  packageSummary: {
    activePackages: number;
    remainingSessions: number;
    lowBalancePackages: number;
  };
  packages: CustomerPortalPackagesResponse["packages"];
  recentBookings: CustomerPortalBookingsResponse["rows"];
  assumptions: string[];
}

export interface CustomerPortalPackagesResponse {
  packages: Array<{
    id: string;
    serviceName: string;
    packageName: string | null;
    serviceCategory: string;
    packageTotal: number;
    usedCount: number;
    remainingCount: number;
    latestUsageDate: string;
    latestTherapist: string;
    status: string;
    expiryDate: string | null;
  }>;
}

export interface CustomerPortalBookingsResponse {
  rows: Array<{
    bookingId: string;
    checkInTime: string;
    serviceName: string;
    therapistName: string;
    serviceCategory: string;
    clinicCode: string;
    status: string;
    notes: string | null;
  }>;
  totalCount: number;
}

export interface CustomerPortalPaymentsResponse {
  summary: {
    totalSpent: number;
    invoiceCount: number;
    averageInvoice: number;
    outstandingAmount: number;
  };
  rows: Array<{
    dateLabel: string;
    invoiceNumber: string;
    serviceName: string;
    servicePackageName: string | null;
    paymentMethod: string;
    salePerson: string;
    invoiceTotal: number;
    discount: number;
    netAmount: number;
    outstandingAmount: number;
    paymentStatus: string;
  }>;
  totalCount: number;
}

export interface CustomerPortalUsageResponse {
  year: number;
  months: string[];
  categories: string[];
  summary: {
    totalUsage: number;
    distinctServices: number;
  };
  services: Array<{
    serviceName: string;
    serviceCategory: string;
    counts: number[];
    totalUsage: number;
  }>;
}
