import { runAnalyticsQuery } from "../bigquery.service.js";
import { walletAccountSearchClause, walletTransactionSearchClause } from "./wallet-report.query.js";

const walletTransactionTable = "`piti-pass.passdb_prod.wallettransaction`";
const walletQueryLocation = "us-central1";
const walletCreatedDateExpression = "SAFE_CAST(SUBSTR(COALESCE(createddate_myanmar, ''), 1, 10) AS DATE)";

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
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "object" && "value" in value) {
    return parseText((value as { value: unknown }).value, fallback);
  }
  return fallback;
}

function buildWalletRowsCte(extraWhere = "TRUE") {
  return `
    WITH WalletRows AS (
      SELECT
        COALESCE(MainAccountName, '') AS accountName,
        CASE
          WHEN UPPER(COALESCE(status, '')) = 'OUT' THEN COALESCE(NULLIF(senderPhone, ''), NULLIF(recipientPhone, ''))
          WHEN UPPER(COALESCE(status, '')) = 'IN' THEN COALESCE(NULLIF(recipientPhone, ''), NULLIF(senderPhone, ''))
          ELSE COALESCE(NULLIF(senderPhone, ''), NULLIF(recipientPhone, ''))
        END AS accountPhone,
        COALESCE(transactionNumber, '') AS transactionNumber,
        COALESCE(type, 'Transfer') AS type,
        UPPER(COALESCE(status, '')) AS status,
        CAST(COALESCE(balance, 0) AS FLOAT64) AS amount,
        CAST(COALESCE(accountbalance, 0) AS FLOAT64) AS accountBalance,
        COALESCE(comment, '') AS comment,
        COALESCE(MainAccountName, '') AS mainAccountName,
        COALESCE(senderName, '') AS senderName,
        COALESCE(senderPhone, '') AS senderPhone,
        COALESCE(recipientName, '') AS recipientName,
        COALESCE(recipientPhone, '') AS recipientPhone,
        COALESCE(createddate_myanmar, '') AS dateLabel,
        ${walletCreatedDateExpression} AS createdDate
      FROM ${walletTransactionTable}
      WHERE LOWER(ClinicCode) = LOWER(@clinicCode)
        AND COALESCE(MainAccountName, '') != ''
        AND ${extraWhere}
    )
  `;
}

export async function getWalletAccountsReport(params: {
  clinicCode: string;
  search: string;
  limit: number;
  offset: number;
}) {
  const baseCte = `
    ${buildWalletRowsCte()}
    ,
    LatestAccountRows AS (
      SELECT
        accountName,
        accountPhone,
        accountBalance,
        transactionNumber,
        dateLabel,
        ROW_NUMBER() OVER (
          PARTITION BY accountName
          ORDER BY dateLabel DESC, transactionNumber DESC
        ) AS rowRank
      FROM WalletRows
    ),
    AccountCounts AS (
      SELECT
        accountName,
        COUNT(DISTINCT transactionNumber) AS transactionCount
      FROM WalletRows
      GROUP BY accountName
    ),
    Joined AS (
      SELECT
        latest.accountName AS name,
        latest.accountPhone AS phoneNumber,
        latest.accountBalance AS balance,
        counts.transactionCount AS transactionCount
      FROM LatestAccountRows AS latest
      JOIN AccountCounts AS counts
        ON counts.accountName = latest.accountName
      WHERE latest.rowRank = 1
        AND ${walletAccountSearchClause}
    )
  `;

  const [summaryRows, rows] = await Promise.all([
    runAnalyticsQuery<{
      accountCount: number;
      totalBalance: number;
      totalTransactionCount: number;
      averageBalance: number;
      highestBalance: number;
    }>(
      `
        ${baseCte}
        SELECT
          COUNT(*) AS accountCount,
          COALESCE(SUM(balance), 0) AS totalBalance,
          COALESCE(SUM(transactionCount), 0) AS totalTransactionCount,
          COALESCE(AVG(balance), 0) AS averageBalance,
          COALESCE(MAX(balance), 0) AS highestBalance
        FROM Joined
      `,
      params,
      { location: walletQueryLocation },
    ),
    runAnalyticsQuery<{
      name: string;
      phoneNumber: string | null;
      balance: number;
      transactionCount: number;
    }>(
      `
        ${baseCte}
        SELECT
          name,
          phoneNumber,
          balance,
          transactionCount
        FROM Joined
        ORDER BY balance DESC, transactionCount DESC, name ASC
        LIMIT @limit
        OFFSET @offset
      `,
      params,
      { location: walletQueryLocation },
    ),
  ]);

  const summary = summaryRows[0];

  return {
    summary: {
      accountCount: parseNumber(summary?.accountCount),
      totalBalance: parseNumber(summary?.totalBalance),
      totalTransactionCount: parseNumber(summary?.totalTransactionCount),
      averageBalance: parseNumber(summary?.averageBalance),
      highestBalance: parseNumber(summary?.highestBalance),
    },
    rows: rows.map((row) => ({
      name: parseText(row.name, "—"),
      phoneNumber: parseText(row.phoneNumber, ""),
      balance: parseNumber(row.balance),
      transactionCount: parseNumber(row.transactionCount),
    })),
    totalCount: parseNumber(summary?.accountCount),
  };
}

export async function getWalletAccountTransactions(params: {
  clinicCode: string;
  accountName: string;
  accountPhone: string;
  search: string;
  limit: number;
  offset: number;
}) {
  const baseCte = `
    ${buildWalletRowsCte()}
    ,
    Filtered AS (
      SELECT *
      FROM WalletRows
      WHERE LOWER(accountName) = LOWER(@accountName)
        AND (@accountPhone = '' OR COALESCE(accountPhone, '') = @accountPhone)
        AND ${walletTransactionSearchClause}
    )
  `;

  const [rows, totalRows] = await Promise.all([
    runAnalyticsQuery<{
      dateLabel: string;
      transactionNumber: string;
      type: string;
      status: string;
      amount: number;
      accountBalance: number;
      comment: string;
      mainAccountName: string;
      senderName: string;
      senderPhone: string;
      recipientName: string;
      recipientPhone: string;
    }>(
      `
        ${baseCte}
        SELECT
          dateLabel,
          transactionNumber,
          type,
          status,
          amount,
          accountBalance,
          comment,
          mainAccountName,
          senderName,
          senderPhone,
          recipientName,
          recipientPhone
        FROM Filtered
        ORDER BY dateLabel DESC, transactionNumber DESC, status DESC
        LIMIT @limit
        OFFSET @offset
      `,
      params,
      { location: walletQueryLocation },
    ),
    runAnalyticsQuery<{
      totalCount: number;
    }>(
      `
        ${baseCte}
        SELECT COUNT(*) AS totalCount
        FROM Filtered
      `,
      params,
      { location: walletQueryLocation },
    ),
  ]);

  return {
    rows: rows.map((row) => ({
      dateLabel: parseText(row.dateLabel),
      transactionNumber: parseText(row.transactionNumber),
      type: parseText(row.type, "Transfer"),
      status: parseText(row.status),
      amount: parseNumber(row.amount),
      balance: parseNumber(row.accountBalance),
      comment: parseText(row.comment),
      accountName: parseText(row.mainAccountName),
      senderName: parseText(row.senderName),
      senderPhone: parseText(row.senderPhone),
      recipientName: parseText(row.recipientName),
      recipientPhone: parseText(row.recipientPhone),
    })),
    totalCount: parseNumber(totalRows[0]?.totalCount),
  };
}

export async function getWalletTransactionsReport(params: {
  clinicCode: string;
  fromDate: string;
  toDate: string;
  search: string;
  limit: number;
  offset: number;
}) {
  const baseCte = `
    ${buildWalletRowsCte(`
      (@fromDate = '' OR ${walletCreatedDateExpression} >= @fromDate)
      AND (@toDate = '' OR ${walletCreatedDateExpression} <= @toDate)
      AND ${walletTransactionSearchClause}
    `)}
  `;

  const [summaryRows, rows] = await Promise.all([
    runAnalyticsQuery<{
      totalIn: number;
      totalOut: number;
      transactionCount: number;
      netMovement: number;
    }>(
      `
        ${baseCte}
        SELECT
          COALESCE(SUM(IF(status = 'IN', amount, 0)), 0) AS totalIn,
          COALESCE(SUM(IF(status = 'OUT', amount, 0)), 0) AS totalOut,
          COUNT(*) AS transactionCount,
          COALESCE(SUM(IF(status = 'IN', amount, 0)), 0) - COALESCE(SUM(IF(status = 'OUT', amount, 0)), 0) AS netMovement
        FROM WalletRows
      `,
      params,
      { location: walletQueryLocation },
    ),
    runAnalyticsQuery<{
      dateLabel: string;
      transactionNumber: string;
      type: string;
      status: string;
      amount: number;
      accountBalance: number;
      comment: string;
      mainAccountName: string;
      senderName: string;
      senderPhone: string;
      recipientName: string;
      recipientPhone: string;
    }>(
      `
        ${baseCte}
        SELECT
          dateLabel,
          transactionNumber,
          type,
          status,
          amount,
          accountBalance,
          comment,
          mainAccountName,
          senderName,
          senderPhone,
          recipientName,
          recipientPhone
        FROM WalletRows
        ORDER BY dateLabel DESC, transactionNumber DESC, status DESC, mainAccountName ASC
        LIMIT @limit
        OFFSET @offset
      `,
      params,
      { location: walletQueryLocation },
    ),
  ]);

  const summary = summaryRows[0];

  return {
    summary: {
      totalIn: parseNumber(summary?.totalIn),
      totalOut: parseNumber(summary?.totalOut),
      transactionCount: parseNumber(summary?.transactionCount),
      netMovement: parseNumber(summary?.netMovement),
    },
    rows: rows.map((row) => ({
      dateLabel: parseText(row.dateLabel),
      transactionNumber: parseText(row.transactionNumber),
      type: parseText(row.type, "Transfer"),
      status: parseText(row.status),
      amount: parseNumber(row.amount),
      balance: parseNumber(row.accountBalance),
      comment: parseText(row.comment),
      accountName: parseText(row.mainAccountName),
      senderName: parseText(row.senderName),
      senderPhone: parseText(row.senderPhone),
      recipientName: parseText(row.recipientName),
      recipientPhone: parseText(row.recipientPhone),
    })),
    totalCount: parseNumber(summary?.transactionCount),
  };
}
