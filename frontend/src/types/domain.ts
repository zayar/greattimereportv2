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
    paymentMethod?: string | null;
    paymentStatus?: string | null;
    walletTopUp?: string | null;
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
    sellerName: string;
    totalAmount: number;
  }>;
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
  dailyCollections: Array<{
    dateLabel: string;
    totalAmount: number;
    transactionCount: number;
  }>;
  recentRows: Array<{
    dateLabel: string;
    invoiceNumber: string;
    customerName: string;
    salePerson: string;
    paymentMethod: string;
    totalAmount: number;
  }>;
}
