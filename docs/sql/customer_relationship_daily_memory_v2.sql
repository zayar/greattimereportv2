-- Customer Relationship Daily Memory V2 provisioning.
-- Replace `PROJECT_ID.DATASET` with the deployment BigQuery project and dataset.
-- This script is idempotent and safe to rerun.

CREATE TABLE IF NOT EXISTS `PROJECT_ID.DATASET.gt_ai_customer_package_daily`
(
  snapshotDate DATE NOT NULL,
  learningRunId STRING NOT NULL,
  computedAt TIMESTAMP NOT NULL,
  sourceWatermark TIMESTAMP,
  ruleVersion STRING NOT NULL,
  clinicId STRING NOT NULL,
  clinicCode STRING,
  customerKey STRING NOT NULL,
  customerName STRING,
  customerPhoneMasked STRING,
  memberId STRING,
  customerIdentityConfidence FLOAT64,
  purchaseKey STRING NOT NULL,
  invoiceNumber STRING,
  purchaseLineKey STRING,
  serviceId STRING,
  serviceName STRING,
  packageId STRING,
  packageName STRING,
  purchaseDate DATE,
  purchaseAgeDays INT64,
  purchasedSessions INT64,
  usedSessions INT64,
  remainingSessions INT64,
  balanceStatus STRING,
  firstMatchingUsageDate DATE,
  lastMatchingUsageDate DATE,
  lastCustomerVisitDate DATE,
  daysSinceMatchingUsage INT64,
  activationStatus STRING,
  matchMethod STRING,
  matchConfidence FLOAT64,
  dataStatus STRING,
  evidenceReason STRING
)
PARTITION BY snapshotDate
CLUSTER BY clinicId, activationStatus, customerKey, packageId
OPTIONS (
  partition_expiration_days = 540,
  require_partition_filter = TRUE,
  description = "Daily package/service purchase lifecycle memory for Customer Relationship Agent V2."
);

CREATE TABLE IF NOT EXISTS `PROJECT_ID.DATASET.gt_ai_customer_relationship_daily`
(
  snapshotDate DATE NOT NULL,
  learningRunId STRING NOT NULL,
  computedAt TIMESTAMP NOT NULL,
  sourceWatermark TIMESTAMP,
  ruleVersion STRING NOT NULL,
  clinicId STRING NOT NULL,
  clinicCode STRING,
  customerKey STRING NOT NULL,
  customerName STRING,
  customerPhoneMasked STRING,
  memberId STRING,
  firstVisitDate DATE,
  lastVisitDate DATE,
  daysSinceLastVisit INT64,
  lifetimeSpend FLOAT64,
  totalVisits INT64,
  recent90DayVisits INT64,
  previous90DayVisits INT64,
  activePackageCount INT64,
  remainingPackageSessions INT64,
  unactivatedPurchaseCount INT64,
  dormantActiveBalanceCount INT64,
  primarySegment STRING,
  segments ARRAY<STRING>,
  riskLevel STRING,
  relationshipHealthScore INT64,
  priorityScore INT64,
  reasons ARRAY<STRING>,
  nextBestAction STRING,
  dataStatus STRING
)
PARTITION BY snapshotDate
CLUSTER BY clinicId, primarySegment, riskLevel, customerKey
OPTIONS (
  partition_expiration_days = 540,
  require_partition_filter = TRUE,
  description = "Daily customer-level relationship serving memory for Customer Relationship Agent V2."
);
