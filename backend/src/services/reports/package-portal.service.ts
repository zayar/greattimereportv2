import { queryApicoreWithFallback } from "../apicore.service.js";
import {
  differenceInDays,
  getInactivityBucket,
  getPackageStatusPriority,
  getPackageUsageStatus,
  needsPackageFollowUp,
  type InactivityBucket,
  type PackageUsageStatus,
} from "./package-portal-status.js";

const HOLDING_BATCH_SIZE = 500;
const CHECKIN_BATCH_SIZE = 1000;
const MEMBER_CHUNK_SIZE = 250;
const CHECKIN_CHUNK_CONCURRENCY = 3;
const PACKAGE_RECORD_CACHE_TTL_MS = 2 * 60 * 1000;

const PACKAGE_HOLDINGS_QUERY = `
  query PackagePortalHoldings(
    $where: MemberServicePackageWhereInput
    $orderBy: [MemberServicePackageOrderByWithRelationInput!]
    $take: Int
    $skip: Int
    $clinicMembersWhere: ClinicMemberWhereInput
    $memberServiceBagsWhere: MemberServiceBagWhereInput
    $orderItemsWhere: OrderItemWhereInput
  ) {
    memberServicePackages(where: $where, orderBy: $orderBy, take: $take, skip: $skip) {
      id
      count
      status
      created_at
      expired_date
      member_id
      service_package_id
      member {
        id
        name
        phonenumber
        clinic_members(where: $clinicMembersWhere) {
          clinic_id
          member_id
          name
          phonenumber
        }
      }
      service_package {
        id
        name
        status
      }
      member_service_bags(where: $memberServiceBagsWhere) {
        id
        original_count
        remaining_count
        service_id
        service {
          id
          name
        }
      }
      order_items(where: $orderItemsWhere) {
        id
        quantity
        created_at
        order {
          id
          created_at
          seller {
            display_name
          }
        }
      }
    }
  }
`;

const PACKAGE_USAGE_CHECKINS_QUERY = `
  query PackagePortalCheckIns(
    $where: CheckInWhereInput
    $orderBy: [CheckInOrderByWithRelationInput!]
    $take: Int
    $skip: Int
  ) {
    checkIns(where: $where, orderBy: $orderBy, take: $take, skip: $skip) {
      id
      in_time
      member_id
      service_id
      practitioner {
        id
        name
      }
      service {
        id
        name
      }
    }
  }
`;

type PackagePortalParams = {
  clinicId: string;
  fromDate: string;
  toDate: string;
  packageId: string;
  category: string;
  therapist: string;
  salesperson: string;
  status: string;
  inactivityBucket: string;
  onlyRemaining: boolean;
  authorizationHeader?: string;
};

type MemberServicePackageNode = {
  id: string;
  count: number | string | null;
  status: string | null;
  created_at: string;
  expired_date: string | null;
  member_id: string;
  service_package_id: string;
  member: {
    id: string;
    name: string | null;
    phonenumber: string | null;
    clinic_members?: Array<{
      clinic_id?: string | null;
      member_id?: string | null;
      name?: string | null;
      phonenumber?: string | null;
    }> | null;
  } | null;
  service_package: {
    id: string;
    name: string | null;
    status: string | null;
  } | null;
  member_service_bags?: Array<{
    id: string;
    original_count: number | string | null;
    remaining_count: number | string | null;
    service_id: string;
    service?: {
      id: string;
      name: string | null;
    } | null;
  }> | null;
  order_items?: Array<{
    id: string;
    quantity: number | string | null;
    created_at: string;
    order?: {
      id: string;
      created_at: string;
      seller?: {
        display_name?: string | null;
      } | null;
    } | null;
  }> | null;
};

type CheckInNode = {
  id: string;
  in_time: string;
  member_id: string;
  service_id: string;
  practitioner?: {
    id: string;
    name?: string | null;
  } | null;
  service?: {
    id: string;
    name?: string | null;
  } | null;
};

type PackageCustomerRecord = {
  id: string;
  packageId: string;
  packageName: string;
  category: string;
  customerName: string;
  customerPhone: string;
  memberId: string;
  purchaseCount: number;
  purchaseDate: string;
  expiryDate: string | null;
  purchasedUnits: number;
  usedUnits: number;
  remainingUnits: number;
  lastVisitDate: string | null;
  daysSinceLastVisit: number | null;
  daysSinceActivity: number;
  latestTherapist: string;
  latestSalesperson: string;
  status: PackageUsageStatus;
  inactivityBucket: InactivityBucket;
  needsFollowUp: boolean;
  serviceIds: string[];
  serviceNames: string[];
};

type PackageCustomerSeedCacheEntry = {
  expiresAt: number;
  value?: PackageCustomerRecord[];
  promise?: Promise<PackageCustomerRecord[]>;
};

const packageCustomerSeedCache = new Map<string, PackageCustomerSeedCacheEntry>();

function parseNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (value && typeof value === "object" && "value" in value) {
    return Number((value as { value: unknown }).value);
  }

  return Number(value ?? 0);
}

function parseText(value: unknown, fallback = "") {
  if (typeof value === "string") {
    return value;
  }

  if (value == null) {
    return fallback;
  }

  return String(value);
}

function toDateOnly(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value.slice(0, 10);
}

function isWithinDateRange(value: string, fromDate: string, toDate: string) {
  return value >= fromDate && value <= toDate;
}

function compareDateDesc(left: string | null, right: string | null) {
  if (left === right) {
    return 0;
  }

  if (!left) {
    return 1;
  }

  if (!right) {
    return -1;
  }

  return left < right ? 1 : -1;
}

function formatStatusLabel(status: PackageUsageStatus) {
  switch (status) {
    case "new":
      return "New";
    case "in_progress":
      return "In progress";
    case "near_completion":
      return "Near completion";
    case "completed":
      return "Completed";
    case "inactive_30":
      return "Inactive 30+";
    case "inactive_60":
      return "Inactive 60+";
    case "inactive_90":
      return "Inactive 90+";
    case "at_risk":
      return "At risk";
    default:
      return status;
  }
}

function formatInactivityBucketLabel(bucket: InactivityBucket) {
  switch (bucket) {
    case "0_29":
      return "0-29 days";
    case "30_59":
      return "30-59 days";
    case "60_89":
      return "60-89 days";
    case "90_plus":
      return "90+ days";
    case "never_used":
      return "Never used";
    default:
      return bucket;
  }
}

function buildPackageCategory(packageName: string, serviceNames: string[]) {
  const source = `${packageName} ${serviceNames.join(" ")}`.toLowerCase();

  if (/laser|fractional|ipl|hifu|ultraformer|hair removal|lhr|co2|revlite/.test(source)) {
    return "Laser";
  }

  if (/facial|hydra|hydro|skin|peel|aqua|bright|rejuv|glow|oxygen|cleanup|whitening|micro/.test(source)) {
    return "Facial";
  }

  if (/botox|filler|meso|inject|toxin|thread|prp|rejuran|profhilo|collagen stim/.test(source)) {
    return "Injectables";
  }

  if (/body|slim|fat|contour|cellulite|cool|emsculpt|shape|underarm|bikini|thigh/.test(source)) {
    return "Body";
  }

  if (/hair|scalp/.test(source)) {
    return "Hair";
  }

  if (/wellness|vitamin|therapy|drip|massage|lymph/.test(source)) {
    return "Wellness";
  }

  return "Other";
}

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function buildPackageCustomerSeedCacheKey(params: Pick<PackagePortalParams, "clinicId" | "fromDate" | "toDate" | "onlyRemaining">) {
  return JSON.stringify({
    clinicId: params.clinicId,
    fromDate: params.fromDate,
    toDate: params.toDate,
    onlyRemaining: params.onlyRemaining,
  });
}

function prunePackageCustomerSeedCache(now = Date.now()) {
  for (const [key, entry] of packageCustomerSeedCache.entries()) {
    if (!entry.promise && entry.expiresAt <= now) {
      packageCustomerSeedCache.delete(key);
    }
  }
}

async function fetchAllPackageHoldings(params: {
  clinicId: string;
  fromDate: string;
  toDate: string;
  packageId: string;
  onlyRemaining: boolean;
  authorizationHeader?: string;
}) {
  const rows: MemberServicePackageNode[] = [];
  let skip = 0;
  const fromDateIso = new Date(`${params.fromDate}T00:00:00.000Z`).toISOString();
  const toDateIso = new Date(`${params.toDate}T23:59:59.999Z`).toISOString();

  while (true) {
    const data = await queryApicoreWithFallback<{ memberServicePackages?: MemberServicePackageNode[] | null }>({
      query: PACKAGE_HOLDINGS_QUERY,
      variables: {
        where: {
          AND: [
            {
              OR: [
                {
                  order_items: {
                    some: {
                      order: {
                        is: {
                          created_at: {
                            gte: fromDateIso,
                            lte: toDateIso,
                          },
                        },
                      },
                    },
                  },
                },
                {
                  AND: [
                    {
                      order_items: {
                        none: {},
                      },
                    },
                    {
                      created_at: {
                        gte: fromDateIso,
                        lte: toDateIso,
                      },
                    },
                  ],
                },
              ],
            },
          ],
          status: { notIn: ["CANCEL"] },
          service_package: {
            is: {
              clinic_id: { equals: params.clinicId },
              status: { notIn: ["CANCEL"] },
              ...(params.packageId ? { id: { equals: params.packageId } } : {}),
            },
          },
          ...(params.onlyRemaining
            ? {
                member_service_bags: {
                  some: {
                    remaining_count: {
                      gt: 0,
                    },
                  },
                },
              }
            : {}),
        },
        clinicMembersWhere: {
          clinic_id: { equals: params.clinicId },
        },
        memberServiceBagsWhere: {
          service: {
            is: {
              clinic_id: { equals: params.clinicId },
            },
          },
        },
        orderItemsWhere: {
          order: {
            is: {
              created_at: {
                gte: fromDateIso,
                lte: toDateIso,
              },
            },
          },
        },
        orderBy: [{ updated_at: "desc" }],
        take: HOLDING_BATCH_SIZE,
        skip,
      },
      authorizationHeader: params.authorizationHeader,
      errorMessage: "Package holdings query failed.",
    });

    const batch = data?.memberServicePackages ?? [];
    rows.push(...batch);

    if (batch.length < HOLDING_BATCH_SIZE) {
      break;
    }

    skip += batch.length;
  }

  return rows;
}

async function fetchPackageUsageCheckIns(params: {
  clinicId: string;
  memberIds: string[];
  serviceIds: string[];
  minDate: string;
  authorizationHeader?: string;
}) {
  const memberIdChunks = chunkArray(params.memberIds, MEMBER_CHUNK_SIZE);

  async function loadChunk(memberIds: string[]) {
    const chunkRows: CheckInNode[] = [];
    let skip = 0;

    while (true) {
      const data = await queryApicoreWithFallback<{ checkIns?: CheckInNode[] | null }>({
        query: PACKAGE_USAGE_CHECKINS_QUERY,
        variables: {
          where: {
            clinic_id: { equals: params.clinicId },
            isUsePurchaseService: { equals: true },
            member_id: { in: memberIds },
            service_id: { in: params.serviceIds },
            in_time: { gte: new Date(`${params.minDate}T00:00:00.000Z`).toISOString() },
          },
          orderBy: [{ in_time: "desc" }],
          take: CHECKIN_BATCH_SIZE,
          skip,
        },
        authorizationHeader: params.authorizationHeader,
        errorMessage: "Package usage check-ins query failed.",
      });

      const batch = data?.checkIns ?? [];
      chunkRows.push(...batch);

      if (batch.length < CHECKIN_BATCH_SIZE) {
        break;
      }

      skip += batch.length;
    }

    return chunkRows;
  }

  const rows: CheckInNode[] = [];

  for (let index = 0; index < memberIdChunks.length; index += CHECKIN_CHUNK_CONCURRENCY) {
    const window = memberIdChunks.slice(index, index + CHECKIN_CHUNK_CONCURRENCY);
    const results = await Promise.all(window.map((memberIds) => loadChunk(memberIds)));

    for (const batch of results) {
      rows.push(...batch);
    }
  }

  return rows;
}

function buildHoldingPurchaseInfo(row: MemberServicePackageNode) {
  const orderItems = row.order_items ?? [];
  let latestPurchaseDate = toDateOnly(row.created_at) ?? "";
  let latestSalesperson = "";
  let purchaseCount = 0;

  for (const orderItem of orderItems) {
    purchaseCount += Math.max(1, parseNumber(orderItem.quantity));
    const purchaseDate = toDateOnly(orderItem.order?.created_at ?? orderItem.created_at) ?? latestPurchaseDate;

    if (purchaseDate >= latestPurchaseDate) {
      latestPurchaseDate = purchaseDate;
      latestSalesperson = parseText(orderItem.order?.seller?.display_name, "");
    }
  }

  return {
    latestPurchaseDate,
    latestSalesperson,
    purchaseCount: purchaseCount > 0 ? purchaseCount : Math.max(1, parseNumber(row.count)),
  };
}

function buildBaseHoldingRecord(row: MemberServicePackageNode) {
  const clinicMember = row.member?.clinic_members?.[0];
  const packageName = parseText(row.service_package?.name, "Unnamed package");
  const serviceIds = (row.member_service_bags ?? []).map((bag) => bag.service_id).filter(Boolean);
  const serviceNames = (row.member_service_bags ?? [])
    .map((bag) => parseText(bag.service?.name, ""))
    .filter((value) => value !== "");
  const purchasedUnits = (row.member_service_bags ?? []).reduce((sum, bag) => sum + Math.max(0, parseNumber(bag.original_count)), 0);
  const remainingUnits = (row.member_service_bags ?? []).reduce((sum, bag) => sum + Math.max(0, parseNumber(bag.remaining_count)), 0);
  const usedUnits = Math.max(purchasedUnits - remainingUnits, 0);
  const purchaseInfo = buildHoldingPurchaseInfo(row);

  return {
    id: row.id,
    packageId: parseText(row.service_package_id, row.id),
    packageName,
    category: buildPackageCategory(packageName, serviceNames),
    customerName: parseText(clinicMember?.name, parseText(row.member?.name, "Unknown customer")),
    customerPhone: parseText(clinicMember?.phonenumber, parseText(row.member?.phonenumber, "")),
    memberId: parseText(clinicMember?.member_id, ""),
    internalMemberId: row.member_id,
    purchaseCount: purchaseInfo.purchaseCount,
    purchaseDate: purchaseInfo.latestPurchaseDate,
    expiryDate: toDateOnly(row.expired_date),
    purchasedUnits,
    usedUnits,
    remainingUnits,
    latestSalesperson: purchaseInfo.latestSalesperson,
    serviceIds,
    serviceNames,
  };
}

function buildLatestUsageLookup(rows: CheckInNode[]) {
  const lookup = new Map<string, CheckInNode>();

  for (const row of rows) {
    const key = `${row.member_id}::${row.service_id}`;

    if (!lookup.has(key)) {
      lookup.set(key, row);
    }
  }

  return lookup;
}

function buildPackageCustomerRecord(params: {
  base: ReturnType<typeof buildBaseHoldingRecord>;
  usageLookup: Map<string, CheckInNode>;
  todayDate: string;
}) {
  let latestUsage: CheckInNode | null = null;

  for (const serviceId of params.base.serviceIds) {
    const candidate = params.usageLookup.get(`${params.base.internalMemberId}::${serviceId}`);

    if (candidate && (!latestUsage || candidate.in_time > latestUsage.in_time)) {
      latestUsage = candidate;
    }
  }

  const lastVisitDate = toDateOnly(latestUsage?.in_time) ?? null;
  const daysSinceLastVisit = lastVisitDate ? differenceInDays(lastVisitDate, params.todayDate) : null;
  const daysSinceActivity = lastVisitDate
    ? daysSinceLastVisit ?? 0
    : differenceInDays(params.base.purchaseDate, params.todayDate);
  const status = getPackageUsageStatus({
    usedUnits: params.base.usedUnits,
    remainingUnits: params.base.remainingUnits,
    daysSinceActivity,
  });
  const inactivityBucket = getInactivityBucket({
    usedUnits: params.base.usedUnits,
    remainingUnits: params.base.remainingUnits,
    daysSinceActivity,
  });

  return {
    id: params.base.id,
    packageId: params.base.packageId,
    packageName: params.base.packageName,
    category: params.base.category,
    customerName: params.base.customerName,
    customerPhone: params.base.customerPhone,
    memberId: params.base.memberId,
    purchaseCount: params.base.purchaseCount,
    purchaseDate: params.base.purchaseDate,
    expiryDate: params.base.expiryDate,
    purchasedUnits: params.base.purchasedUnits,
    usedUnits: params.base.usedUnits,
    remainingUnits: params.base.remainingUnits,
    lastVisitDate,
    daysSinceLastVisit,
    daysSinceActivity,
    latestTherapist: parseText(latestUsage?.practitioner?.name, ""),
    latestSalesperson: params.base.latestSalesperson,
    status,
    inactivityBucket,
    needsFollowUp: needsPackageFollowUp({
      remainingUnits: params.base.remainingUnits,
      daysSinceActivity,
      status,
    }),
    serviceIds: params.base.serviceIds,
    serviceNames: params.base.serviceNames,
  } satisfies PackageCustomerRecord;
}

function buildPackageFollowUpSummary(rows: PackageCustomerRecord[]) {
  const followUpCount = rows.filter((row) => row.needsFollowUp).length;
  const atRiskCount = rows.filter((row) => row.status === "at_risk").length;
  const completedCount = rows.filter((row) => row.status === "completed").length;

  if (atRiskCount > 0) {
    return `${atRiskCount} at risk`;
  }

  if (followUpCount > 0) {
    return `${followUpCount} follow-up`;
  }

  if (completedCount === rows.length && completedCount > 0) {
    return "All completed";
  }

  return "Healthy";
}

async function buildPackageCustomerSeed(params: Pick<
  PackagePortalParams,
  "clinicId" | "fromDate" | "toDate" | "packageId" | "category" | "salesperson" | "onlyRemaining" | "authorizationHeader"
>) {
  const rawHoldings = await fetchAllPackageHoldings({
    clinicId: params.clinicId,
    fromDate: params.fromDate,
    toDate: params.toDate,
    packageId: params.packageId,
    onlyRemaining: params.onlyRemaining,
    authorizationHeader: params.authorizationHeader,
  });

  const baseRows = rawHoldings
    .map(buildBaseHoldingRecord)
    .filter((row) => row.purchaseDate !== "")
    .filter((row) => isWithinDateRange(row.purchaseDate, params.fromDate, params.toDate));

  const dateScopedRows = baseRows.filter((row) => {
    if (params.packageId && row.packageId !== params.packageId) {
      return false;
    }

    if (params.category && row.category.toLowerCase() !== params.category.toLowerCase()) {
      return false;
    }

    if (
      params.salesperson &&
      parseText(row.latestSalesperson, "").toLowerCase() !== params.salesperson.toLowerCase()
    ) {
      return false;
    }

    if (params.onlyRemaining && row.remainingUnits <= 0) {
      return false;
    }

    return true;
  });

  if (dateScopedRows.length === 0) {
    return [] as PackageCustomerRecord[];
  }

  const minDate = dateScopedRows.reduce((earliest, row) => (row.purchaseDate < earliest ? row.purchaseDate : earliest), dateScopedRows[0]!.purchaseDate);
  const memberIds = Array.from(new Set(dateScopedRows.map((row) => row.internalMemberId)));
  const serviceIds = Array.from(new Set(dateScopedRows.flatMap((row) => row.serviceIds)));
  const usageRows = await fetchPackageUsageCheckIns({
    clinicId: params.clinicId,
    memberIds,
    serviceIds,
    minDate,
    authorizationHeader: params.authorizationHeader,
  });
  const usageLookup = buildLatestUsageLookup(usageRows);
  const todayDate = new Date().toISOString().slice(0, 10);
  return dateScopedRows.map((row) =>
    buildPackageCustomerRecord({
      base: row,
      usageLookup,
      todayDate,
    }),
  );
}

async function getCachedPackageCustomerSeed(
  params: Pick<PackagePortalParams, "clinicId" | "fromDate" | "toDate" | "onlyRemaining" | "authorizationHeader">,
) {
  const key = buildPackageCustomerSeedCacheKey(params);
  const now = Date.now();
  const cached = packageCustomerSeedCache.get(key);

  if (cached) {
    if (cached.value && cached.expiresAt > now) {
      return cached.value;
    }

    if (cached.promise) {
      return cached.promise;
    }
  }

  prunePackageCustomerSeedCache(now);

  const promise = buildPackageCustomerSeed({
    clinicId: params.clinicId,
    fromDate: params.fromDate,
    toDate: params.toDate,
    packageId: "",
    category: "",
    salesperson: "",
    onlyRemaining: params.onlyRemaining,
    authorizationHeader: params.authorizationHeader,
  })
    .then((rows) => {
      packageCustomerSeedCache.set(key, {
        value: rows,
        expiresAt: Date.now() + PACKAGE_RECORD_CACHE_TTL_MS,
      });
      return rows;
    })
    .catch((error) => {
      packageCustomerSeedCache.delete(key);
      throw error;
    });

  packageCustomerSeedCache.set(key, {
    promise,
    expiresAt: now + PACKAGE_RECORD_CACHE_TTL_MS,
  });

  return promise;
}

function applyPackageScopeFilters(
  rows: PackageCustomerRecord[],
  params: Pick<PackagePortalParams, "packageId" | "category" | "salesperson" | "onlyRemaining">,
) {
  return rows.filter((row) => {
    if (params.packageId && row.packageId !== params.packageId) {
      return false;
    }

    if (params.category && row.category.toLowerCase() !== params.category.toLowerCase()) {
      return false;
    }

    if (
      params.salesperson &&
      parseText(row.latestSalesperson, "").toLowerCase() !== params.salesperson.toLowerCase()
    ) {
      return false;
    }

    if (params.onlyRemaining && row.remainingUnits <= 0) {
      return false;
    }

    return true;
  });
}

async function buildPackageCustomerRecords(params: PackagePortalParams) {
  const cacheKey = buildPackageCustomerSeedCacheKey(params);
  const hasSharedSeedCache = packageCustomerSeedCache.has(cacheKey);
  const shouldBuildSharedSeed = !params.packageId && !params.category && !params.salesperson;
  const seedRows =
    hasSharedSeedCache || shouldBuildSharedSeed
      ? await getCachedPackageCustomerSeed({
          clinicId: params.clinicId,
          fromDate: params.fromDate,
          toDate: params.toDate,
          onlyRemaining: params.onlyRemaining,
          authorizationHeader: params.authorizationHeader,
        })
      : await buildPackageCustomerSeed({
          clinicId: params.clinicId,
          fromDate: params.fromDate,
          toDate: params.toDate,
          packageId: params.packageId,
          category: params.category,
          salesperson: params.salesperson,
          onlyRemaining: params.onlyRemaining,
          authorizationHeader: params.authorizationHeader,
        });
  const filterSeed = applyPackageScopeFilters(seedRows, params);

  const records = filterSeed.filter((row) => {
    if (
      params.therapist &&
      parseText(row.latestTherapist, "").toLowerCase() !== params.therapist.toLowerCase()
    ) {
      return false;
    }

    if (params.status && row.status !== params.status) {
      return false;
    }

    if (params.inactivityBucket && row.inactivityBucket !== params.inactivityBucket) {
      return false;
    }

    return true;
  });

  return { records, filterSeed };
}

function buildFilterOptions(rows: PackageCustomerRecord[]) {
  const packageMap = new Map<string, string>();
  const categories = new Set<string>();
  const therapists = new Set<string>();
  const salespeople = new Set<string>();
  const statuses = new Set<string>();
  const inactivityBuckets = new Set<string>();

  for (const row of rows) {
    packageMap.set(row.packageId, row.packageName);
    categories.add(row.category);

    if (row.latestTherapist) {
      therapists.add(row.latestTherapist);
    }

    if (row.latestSalesperson) {
      salespeople.add(row.latestSalesperson);
    }

    statuses.add(row.status);
    inactivityBuckets.add(row.inactivityBucket);
  }

  return {
    packages: Array.from(packageMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    categories: Array.from(categories).sort((left, right) => left.localeCompare(right)),
    therapists: Array.from(therapists).sort((left, right) => left.localeCompare(right)),
    salespeople: Array.from(salespeople).sort((left, right) => left.localeCompare(right)),
    statuses: Array.from(statuses).sort((left, right) => left.localeCompare(right)),
    inactivityBuckets: Array.from(inactivityBuckets).sort((left, right) => left.localeCompare(right)),
  };
}

function buildAssumptions() {
  return [
    "Date range filters customer-package records by latest package purchase date; used and remaining units are the current operational balances for those records.",
    "Usage recency and therapist are inferred from package-use check-ins (`isUsePurchaseService = true`) on services included in each package.",
    "The source system rolls repeat purchases of the same package into one customer-package holding, so this report treats that as a single owner-facing record with cumulative balances.",
    "When a package has never been redeemed, inactivity is measured from the latest purchase date.",
    "If the same customer uses overlapping packages that share the same service, latest usage can only be inferred at the service level.",
  ];
}

function buildPerformanceRows(rows: PackageCustomerRecord[]) {
  const buckets = new Map<
    string,
    {
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
      followUpCount: number;
      atRiskCount: number;
      customerRows: PackageCustomerRecord[];
    }
  >();

  for (const row of rows) {
    const current =
      buckets.get(row.packageId) ??
      {
        packageId: row.packageId,
        packageName: row.packageName,
        category: row.category,
        soldCount: 0,
        totalSoldUnits: 0,
        usedUnits: 0,
        remainingUnits: 0,
        activeCustomers: 0,
        completedCustomers: 0,
        inactiveCustomers: 0,
        latestPurchaseDate: null,
        latestUsageDate: null,
        followUpCount: 0,
        atRiskCount: 0,
        customerRows: [],
      };

    current.soldCount += row.purchaseCount;
    current.totalSoldUnits += row.purchasedUnits;
    current.usedUnits += row.usedUnits;
    current.remainingUnits += row.remainingUnits;
    current.latestPurchaseDate =
      !current.latestPurchaseDate || row.purchaseDate > current.latestPurchaseDate
        ? row.purchaseDate
        : current.latestPurchaseDate;
    current.latestUsageDate =
      !current.latestUsageDate || (row.lastVisitDate && row.lastVisitDate > current.latestUsageDate)
        ? row.lastVisitDate
        : current.latestUsageDate;

    if (row.remainingUnits <= 0) {
      current.completedCustomers += 1;
    } else if (row.daysSinceActivity >= 30) {
      current.inactiveCustomers += 1;
    } else {
      current.activeCustomers += 1;
    }

    if (row.needsFollowUp) {
      current.followUpCount += 1;
    }

    if (row.status === "at_risk") {
      current.atRiskCount += 1;
    }

    current.customerRows.push(row);
    buckets.set(row.packageId, current);
  }

  return Array.from(buckets.values())
    .map((row) => ({
      packageId: row.packageId,
      packageName: row.packageName,
      category: row.category,
      soldCount: row.soldCount,
      totalSoldUnits: row.totalSoldUnits,
      usedUnits: row.usedUnits,
      remainingUnits: row.remainingUnits,
      activeCustomers: row.activeCustomers,
      completedCustomers: row.completedCustomers,
      inactiveCustomers: row.inactiveCustomers,
      latestPurchaseDate: row.latestPurchaseDate,
      latestUsageDate: row.latestUsageDate,
      usageRatePct: row.totalSoldUnits > 0 ? (row.usedUnits / row.totalSoldUnits) * 100 : 0,
      followUpSummary: buildPackageFollowUpSummary(row.customerRows),
      followUpCount: row.followUpCount,
      atRiskCount: row.atRiskCount,
    }))
    .sort((left, right) => {
      if (right.followUpCount !== left.followUpCount) {
        return right.followUpCount - left.followUpCount;
      }

      if (right.remainingUnits !== left.remainingUnits) {
        return right.remainingUnits - left.remainingUnits;
      }

      return left.packageName.localeCompare(right.packageName);
    });
}

function buildSummary(rows: PackageCustomerRecord[]) {
  return {
    totalPackagesSold: rows.reduce((sum, row) => sum + row.purchaseCount, 0),
    activePackageCustomers: rows.filter((row) => row.remainingUnits > 0).length,
    totalUnitsSold: rows.reduce((sum, row) => sum + row.purchasedUnits, 0),
    totalUnitsUsed: rows.reduce((sum, row) => sum + row.usedUnits, 0),
    totalUnitsRemaining: rows.reduce((sum, row) => sum + row.remainingUnits, 0),
    customersNeedingFollowUp: rows.filter((row) => row.needsFollowUp).length,
    inactive30Count: rows.filter((row) => row.inactivityBucket === "30_59").length,
    inactive60Count: rows.filter((row) => row.inactivityBucket === "60_89").length,
    inactive90Count: rows.filter((row) => row.inactivityBucket === "90_plus").length,
  };
}

function buildCustomerRows(rows: PackageCustomerRecord[]) {
  return [...rows]
    .sort((left, right) => {
      const statusDelta = getPackageStatusPriority(left.status) - getPackageStatusPriority(right.status);

      if (statusDelta !== 0) {
        return statusDelta;
      }

      if (right.remainingUnits !== left.remainingUnits) {
        return right.remainingUnits - left.remainingUnits;
      }

      if (right.daysSinceActivity !== left.daysSinceActivity) {
        return right.daysSinceActivity - left.daysSinceActivity;
      }

      return left.customerName.localeCompare(right.customerName);
    })
    .map((row) => ({
      id: row.id,
      packageId: row.packageId,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      memberId: row.memberId,
      packageName: row.packageName,
      category: row.category,
      purchaseDate: row.purchaseDate,
      purchaseCount: row.purchaseCount,
      purchasedUnits: row.purchasedUnits,
      usedUnits: row.usedUnits,
      remainingUnits: row.remainingUnits,
      lastVisitDate: row.lastVisitDate,
      daysSinceLastVisit: row.daysSinceLastVisit,
      daysSinceActivity: row.daysSinceActivity,
      therapist: row.latestTherapist,
      salesperson: row.latestSalesperson,
      status: row.status,
      statusLabel: formatStatusLabel(row.status),
      inactivityBucket: row.inactivityBucket,
      inactivityLabel: formatInactivityBucketLabel(row.inactivityBucket),
      needsFollowUp: row.needsFollowUp,
    }));
}

export async function getPackagePortalReport(params: PackagePortalParams) {
  const { records, filterSeed } = await buildPackageCustomerRecords(params);

  return {
    summary: buildSummary(records),
    filterOptions: buildFilterOptions(filterSeed),
    performanceRows: buildPerformanceRows(records),
    followUpRows: buildCustomerRows(records).filter((row) => row.remainingUnits > 0),
    assumptions: buildAssumptions(),
  };
}

export async function getPackagePortalDetail(
  params: PackagePortalParams & {
    packageId: string;
  },
) {
  const { records } = await buildPackageCustomerRecords(params);
  const packageRows = records.filter((row) => row.packageId === params.packageId);

  if (packageRows.length === 0) {
    return {
      package: null,
      customers: [],
      assumptions: buildAssumptions(),
    };
  }

  const packageSummary = buildPerformanceRows(packageRows)[0];

  return {
    package: packageSummary
      ? {
          packageId: packageSummary.packageId,
          packageName: packageSummary.packageName,
          category: packageSummary.category,
          soldCount: packageSummary.soldCount,
          totalSoldUnits: packageSummary.totalSoldUnits,
          totalUsedUnits: packageSummary.usedUnits,
          totalRemainingUnits: packageSummary.remainingUnits,
          averageUsageRatePct: packageSummary.usageRatePct,
          activeCustomers: packageSummary.activeCustomers,
          completedCustomers: packageSummary.completedCustomers,
          inactiveCustomers: packageSummary.inactiveCustomers,
        }
      : null,
    customers: buildCustomerRows(packageRows),
    assumptions: buildAssumptions(),
  };
}
