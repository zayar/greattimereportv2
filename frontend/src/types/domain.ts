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
export type TelegramReportType = "appointment" | "payment";
export type TelegramDeliveryTrigger = "manual_test" | "scheduled" | "resend";
export type TelegramDeliveryOutcome = "sent" | "failed";

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
  isTodayAppointmentReportEnabled: boolean;
  reportTime: string;
  isTodayPaymentReportEnabled: boolean;
  paymentReportTime: string;
  timezone: string;
  lastTestSentAt: string | null;
  lastScheduledSentAt: string | null;
  lastScheduledDateKey: string | null;
  lastPaymentTestSentAt: string | null;
  lastPaymentScheduledSentAt: string | null;
  lastPaymentScheduledDateKey: string | null;
  lastAppointmentFailureAt: string | null;
  lastAppointmentFailureReason: string | null;
  lastPaymentFailureAt: string | null;
  lastPaymentFailureReason: string | null;
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
