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
  currency?: string | null;
  company: Company;
  _count?: ClinicCounts;
}

export interface Business {
  id: string;
  name: string;
  clinics: Clinic[];
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

export interface DashboardSummary {
  revenue: number;
  revenueChange: number;
  invoices: number;
  invoicesChange: number;
  customers: number;
  customersChange: number;
  appointments: number;
  appointmentsChange: number;
  activeServices: number;
  activeServicesChange: number;
}

export interface DashboardResponse {
  summary: DashboardSummary;
  revenueTrend: Array<{ dateLabel: string; revenue: number }>;
  paymentMix: Array<{ paymentMethod: string; totalAmount: number }>;
  topServices: Array<{ serviceName: string; revenue: number; invoices: number }>;
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
