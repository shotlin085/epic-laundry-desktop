export type LaundryState =
  | "Booked"
  | "Picked Up"
  | "In Process"
  | "Ready"
  | "Out for Delivery"
  | "Delivered"
  | "Cancelled";

export type LaundryCatalogue = {
  categories: Array<{
    id: string;
    name: string;
    color?: string;
    image?: string;
    sort_order?: number;
    active?: boolean;
  }>;
  services: Array<{
    id: string;
    name: string;
    description?: string;
    units?: string[];
    active?: boolean;
  }>;
  garments: Array<{
    id: string;
    name: string;
    code?: string;
    category: string;
    categoryName: string;
    unit: string;
    photo?: string;
    visual_key?: string;
  }>;
  prices: Array<{
    id: string;
    garment: string;
    service: string;
    customer?: string;
    garmentName: string;
    serviceName: string;
    rate: number;
    active?: boolean;
  }>;
  chargeRules: Array<{
    id: string;
    name: string;
    type: "Flat" | "Percentage";
    amount: number;
    description?: string;
    active?: boolean;
  }>;
  discountRules: Array<{
    id: string;
    name: string;
    type: "Flat" | "Percentage";
    amount: number;
    description?: string;
    active?: boolean;
  }>;
  taxRules: Array<{ id: string; name: string; rate: number; active?: boolean }>;
  serviceUnits: string[];
};

export type LaundryOrder = {
  id: string;
  orderNumber: string;
  invoiceNumber?: string;
  customer: { id?: string; name: string; phone: string };
  orderDate: string;
  expectedDeliveryDate: string;
  fulfillmentMode: string;
  deliveryAddress?: string;
  serviceZone?: string;
  state: LaundryState;
  version?: number;
  itemCount: number;
  subtotal: number;
  charges: number;
  discounts: number;
  taxRate: number;
  taxAmount: number;
  grandTotal: number;
  paymentMode: string;
  paymentStatus: string;
  source: string;
  pickupRider?: { id: string; name: string; phone: string };
  deliveryRider?: { id: string; name: string; phone: string };
  pickupSlot: string;
  deliverySlot: string;
  items: Array<{
    garment?: string;
    service?: string;
    garmentName: string;
    serviceName: string;
    unit: string;
    qty: number;
    rate: number;
    amount: number;
    fulfilment?: {
      ordered: number;
      received: number;
      delivered: number;
      pending: number;
      pickedUp: number;
      inProcess: number;
      ready: number;
    };
  }>;
  physicalUnits?: Array<{
    id: string;
    code: string;
    tagCode: string;
    orderId: string;
    orderNumber: string;
    customer: { name: string; phone: string };
    garment: { name: string };
    service: { name: string };
    unit: string;
    sequence: number;
    itemIndex: number;
    state: string;
    location: string;
    condition: string;
    expectedDeliveryDate?: string;
    isOverdue?: boolean;
  }>;
  containers?: Array<{
    id: string;
    tagCode: string;
    tagPayload: string;
    orderId: string;
    orderNumber: string;
    customer: { name: string; phone: string };
    sequence: number;
    total: number;
    weightKg?: number;
    state: string;
    location: string;
    condition: string;
    expectedDeliveryDate?: string;
    createdAt: string;
    updatedAt: string;
    deliveredAt?: string;
  }>;
  notes: string;
  photoPaths: string;
  createdAt: string;
  updatedAt: string;
};

export type LaundryDashboard = {
  asOf: string;
  kpis: {
    collection: number;
    orderRequests: number;
    pendingOrders: number;
    booking: number;
    delivery: number;
    delivered: number;
    todayRevenue: number;
    upcomingDeliveries: number;
  };
  attention: Array<{ id: string; label: string; count: number; tone: string }>;
  trend: Array<{
    date: string;
    orders: number;
    orderValue: number;
    collected: number;
    expenses: number;
  }>;
  fulfillmentBreakdown: Array<{ mode: string; count: number; amount: number }>;
  topGarments: Array<{ name: string; quantity: number; amount: number }>;
  topServices: Array<{ name: string; quantity: number; amount: number }>;
  recent: LaundryOrder[];
  marketplace: {
    configured: boolean;
    newOrders: number;
    awaitingAcceptance: number;
    pickupToday: number;
    intakePending: number;
    customerApprovalRequired: number;
    overdue: number;
    productionRisk: number;
    ready: number;
    deliveryToday: number;
    paymentAttention: number;
    syncIssues: number;
    channelBreakdown: Record<string, number>;
  };
  // Real online (marketplace-pulled) order figures — deliberately separate
  // from `kpis`/`topGarments`/`topServices` above, which are counter-sales
  // only. `estimatedRevenue` is pre-finalization (not yet reconciled), so
  // it's never blended into one combined total.
  online: {
    count: number;
    todayCount: number;
    estimatedRevenue: number;
    topGarments: Array<{ name: string; quantity: number; amount: number }>;
  };
};

export type LaundryQuote = {
  items: LaundryOrder["items"];
  subtotal: number;
  charges: number;
  discounts: number;
  taxable: number;
  taxRate: number;
  taxAmount: number;
  grandTotal: number;
};

export type LaundryPaymentSummary = {
  orderId: string;
  invoiceId: string;
  invoiceNumber: string;
  total: number;
  paid: number;
  outstanding: number;
  status: "Paid" | "Part Paid" | "Unpaid";
  payments: Array<{
    id: string;
    amount: number;
    mode: string;
    reference: string;
    providerStatus: string;
    postingDate: string;
    remarks: string;
  }>;
  provider: { mode: string; onlineConfirmation: boolean; note: string };
};

export type LaundryFulfillmentEvent = {
  id: string;
  itemIndex: number;
  stage: "Picked Up" | "In Process" | "Ready" | "Delivered";
  quantity: number;
  unit: string;
  note: string;
  eventDate: string;
  createdAt: string;
  actor: string;
};

export const nextLaundryState: Partial<Record<LaundryState, LaundryState>> = {
  Booked: "In Process",
  "Picked Up": "In Process",
  "In Process": "Ready",
  Ready: "Out for Delivery",
  "Out for Delivery": "Delivered",
};

export const stateTone: Record<LaundryState, string> = {
  Booked: "bg-sky-100 text-sky-800 ring-sky-200",
  "Picked Up": "bg-amber-100 text-amber-800 ring-amber-200",
  "In Process": "bg-violet-100 text-violet-800 ring-violet-200",
  Ready: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  "Out for Delivery": "bg-orange-100 text-orange-800 ring-orange-200",
  Delivered: "bg-slate-200 text-slate-700 ring-slate-300",
  Cancelled: "bg-rose-100 text-rose-800 ring-rose-200",
};
