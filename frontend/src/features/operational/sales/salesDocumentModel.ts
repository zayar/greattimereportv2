import type { Clinic } from "../../../types/domain";

export type RawSalesOrder = {
  id: string;
  order_id: string;
  created_at: string;
  status: string;
  total: number | string;
  net_total: number | string;
  discount?: number | string | null;
  tax?: number | string | null;
  balance?: number | string | null;
  credit_balance?: number | string | null;
  payment_method?: string | null;
  payment_status?: string | null;
  payment_detail?: string | null;
  metadata?: string | null;
  member_id: string;
  clinic?: {
    name: string;
    code?: string | null;
    description?: string | null;
    address?: string | null;
    phonenumber?: string | null;
    logo?: string | null;
    printer_logo?: string | null;
    currency?: string | null;
  } | null;
  member: {
    name: string;
    phonenumber?: string | null;
    clinic_members?: Array<{
      name: string;
      clinic_id: string;
    }>;
  };
  user?: {
    name: string;
  } | null;
  seller?: {
    display_name?: string | null;
  } | null;
  payments?: Array<{
    payment_amount: number | string;
    payment_method: string;
    payment_note?: string | null;
    payment_date?: string | null;
  }>;
  order_items: Array<{
    id: string;
    quantity: number;
    total: number | string;
    tax?: number | string | null;
    price: number | string;
    original_price?: number | string | null;
    metadata?: string | null;
    service?: {
      name: string;
      image?: string | null;
    } | null;
    service_package?: {
      name: string;
      image?: string | null;
    } | null;
    product_stock_item?: {
      name: string;
    } | null;
    practitioner?: {
      name: string;
    } | null;
  }>;
};

export interface SalesDocumentLineItem {
  id: string;
  name: string;
  detail: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  adjustmentLabel: string | null;
}

export interface SalesDocumentPayment {
  id: string;
  label: string;
  amount: number;
  note: string | null;
  date: string | null;
}

export interface SalesDocumentModel {
  orderId: string;
  invoiceNumber: string;
  createdAt: string;
  status: string;
  paymentStatus: string | null;
  paymentMethod: string | null;
  clinic: {
    name: string;
    description: string | null;
    address: string | null;
    phone: string | null;
    logoUrl: string | null;
  };
  customer: {
    name: string;
    memberId: string;
    phone: string | null;
  };
  salesperson: string | null;
  soldBy: string | null;
  notes: string | null;
  items: SalesDocumentLineItem[];
  payments: SalesDocumentPayment[];
  summary: {
    subtotal: number;
    discount: number;
    tax: number;
    netTotal: number;
    paidAmount: number;
    balanceDue: number;
  };
  currency: string;
}

function parseJson(value: string | null | undefined) {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getClinicMemberName(order: RawSalesOrder) {
  return order.member.clinic_members?.[0]?.name || order.member.name;
}

function getLineItemName(item: RawSalesOrder["order_items"][number]) {
  const metadata = parseJson(item.metadata);

  return (
    (typeof metadata.name === "string" ? metadata.name : null) ||
    item.service?.name ||
    item.service_package?.name ||
    item.product_stock_item?.name ||
    "Sales item"
  );
}

function getLineItemAdjustmentLabel(item: RawSalesOrder["order_items"][number], currency: string) {
  const metadata = parseJson(item.metadata);
  const discount = toNumber(metadata.discount as number | string | undefined);
  const markup = toNumber(metadata.markup as number | string | undefined);

  if (discount > 0) {
    return `Discount ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(discount)} ${currency}`;
  }

  if (markup > 0) {
    return `Markup ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(markup)} ${currency}`;
  }

  const originalPrice = toNumber(item.original_price);
  const price = toNumber(item.price);

  if (originalPrice > 0 && originalPrice !== price) {
    const difference = originalPrice - price;

    if (difference > 0) {
      return `Discount ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(difference)} ${currency}`;
    }

    return `Markup ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.abs(difference))} ${currency}`;
  }

  return null;
}

export function buildSalesDocumentModel(order: RawSalesOrder, fallbackCurrency = "MMK"): SalesDocumentModel {
  const metadata = parseJson(order.metadata);
  const currency = order.clinic?.currency || fallbackCurrency;
  const payments = (order.payments ?? [])
    .filter((payment) => toNumber(payment.payment_amount) > 0)
    .map((payment, index) => ({
      id: `${payment.payment_method}-${index}`,
      label: payment.payment_method,
      amount: toNumber(payment.payment_amount),
      note: payment.payment_note || null,
      date: payment.payment_date || null,
    }));

  const paidAmount = payments.length > 0 ? payments.reduce((sum, payment) => sum + payment.amount, 0) : toNumber(order.balance);

  return {
    orderId: order.id,
    invoiceNumber: order.order_id,
    createdAt: order.created_at,
    status: order.status,
    paymentStatus: order.payment_status || null,
    paymentMethod: order.payment_method || null,
    clinic: {
      name: order.clinic?.name || "Clinic",
      description: order.clinic?.description || null,
      address: order.clinic?.address || null,
      phone: order.clinic?.phonenumber || null,
      logoUrl: order.clinic?.printer_logo || order.clinic?.logo || null,
    },
    customer: {
      name: getClinicMemberName(order),
      memberId: order.member_id,
      phone: order.member.phonenumber || null,
    },
    salesperson: order.seller?.display_name || null,
    soldBy: order.user?.name || null,
    notes: typeof metadata.merchant_note === "string" ? metadata.merchant_note : null,
    items: order.order_items.map((item) => {
      const detailBits = [item.practitioner?.name ? `Practitioner: ${item.practitioner.name}` : null].filter(Boolean);

      return {
        id: item.id,
        name: getLineItemName(item),
        detail: detailBits.length > 0 ? detailBits.join(" · ") : null,
        quantity: item.quantity,
        unitPrice: toNumber(item.price),
        total: toNumber(item.total),
        adjustmentLabel: getLineItemAdjustmentLabel(item, currency),
      };
    }),
    payments:
      payments.length > 0
        ? payments
        : order.payment_method && paidAmount > 0
          ? [
              {
                id: order.payment_method,
                label: order.payment_method,
                amount: paidAmount,
                note: null,
                date: order.created_at,
              },
            ]
          : [],
    summary: {
      subtotal: toNumber(order.total),
      discount: toNumber(order.discount),
      tax: toNumber(order.tax),
      netTotal: toNumber(order.net_total),
      paidAmount,
      balanceDue: toNumber(order.credit_balance),
    },
    currency,
  };
}

export function buildSampleSalesDocumentModel(clinic: Clinic | null): SalesDocumentModel {
  const currency = clinic?.currency || "MMK";

  return {
    orderId: "sample-sales-document",
    invoiceNumber: "INV-240328-018",
    createdAt: new Date().toISOString(),
    status: "ACTIVE",
    paymentStatus: "PAID",
    paymentMethod: "CARD",
    clinic: {
      name: clinic?.name || "GreatTime Signature Clinic",
      description: "Premium skin, laser, and wellness care",
      address: "No. 12 Premium Avenue, Bahan Township, Yangon",
      phone: "+95 9 765 432 100",
      logoUrl: clinic?.logo || null,
    },
    customer: {
      name: "Daw Su Mon",
      memberId: "MBR-10291",
      phone: "+95 9 444 222 119",
    },
    salesperson: "Senior Beauty Advisor",
    soldBy: "Front Desk Team",
    notes: "Please arrive 15 minutes early for the next follow-up session and keep the aftercare instructions for the first 48 hours.",
    items: [
      {
        id: "sample-item-1",
        name: "Laser Toning Session",
        detail: "Practitioner: Dr. Hnin Wut Yee",
        quantity: 1,
        unitPrice: 120000,
        total: 120000,
        adjustmentLabel: null,
      },
      {
        id: "sample-item-2",
        name: "Soothing Recovery Ampoule",
        detail: null,
        quantity: 2,
        unitPrice: 28000,
        total: 56000,
        adjustmentLabel: "Discount 4,000 MMK",
      },
    ],
    payments: [
      {
        id: "sample-payment-1",
        label: "CARD",
        amount: 171000,
        note: "Terminal payment approved",
        date: new Date().toISOString(),
      },
    ],
    summary: {
      subtotal: 176000,
      discount: 5000,
      tax: 0,
      netTotal: 171000,
      paidAmount: 171000,
      balanceDue: 0,
    },
    currency,
  };
}
