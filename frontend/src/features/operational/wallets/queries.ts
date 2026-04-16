import { gql } from "@apollo/client";

export type PassAccountQueryRow = {
  id: string;
  balance: number | string | null;
  account_number?: string | null;
  customer?: {
    id: string;
    name?: string | null;
    phone_number?: string | null;
  } | null;
  _count: {
    transactions: number;
  };
};

export type PassAccountsQueryResponse = {
  accounts: PassAccountQueryRow[];
};

export type PassAccountsCountResponse = {
  aggregateAccount: {
    _count: {
      id: number;
    };
  };
};

export type PassTransactionQueryRow = {
  id: string;
  account_id: string;
  transaction_status: string;
  transaction_type?: string | null;
  balance: number | string;
  comment?: string | null;
  transaction_number: string;
  created_at: string;
  transaction_detail?: {
    sender?: {
      id: string;
      customer?: {
        name?: string | null;
      } | null;
    } | null;
    recipient?: {
      id: string;
      customer?: {
        name?: string | null;
      } | null;
    } | null;
  } | null;
};

export type PassTransactionsQueryResponse = {
  transactions: PassTransactionQueryRow[];
};

export type LegacyWalletTransactionRow = {
  transactionNumber?: string | null;
  type?: string | null;
  status?: string | null;
  balance?: number | string | null;
  comment?: string | null;
  accountbalance?: number | string | null;
  mainAccountName?: string | null;
  senderName?: string | null;
  senderPhone?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  createddate_myanmar?: string | null;
};

export type WalletTransactionsByClinicResponse = {
  getWalletTransactionsByClinic: {
    data: LegacyWalletTransactionRow[];
    totalCount: number;
  } | null;
};

export type WalletSummaryQueryResponse = {
  getWalletSummary: {
    totalIn: number;
    totalOut: number;
    transactionCount: number;
    balance: number;
  } | null;
};

export const GET_PASS_ACCOUNTS = gql`
  query Accounts(
    $where: AccountWhereInput
    $orderBy: [AccountOrderByWithRelationInput!]
    $take: Int
    $skip: Int
  ) {
    accounts(where: $where, orderBy: $orderBy, take: $take, skip: $skip) {
      customer {
        id
        name
        phone_number
      }
      id
      balance
      account_number
      _count {
        transactions
      }
    }
  }
`;

export const GET_PASS_ACCOUNTS_COUNT = gql`
  query AggregateAccount($where: AccountWhereInput) {
    aggregateAccount(where: $where) {
      _count {
        id
      }
    }
  }
`;

export const GET_PASS_ACCOUNT_TRANSACTIONS = gql`
  query Transactions(
    $where: TransactionWhereInput
    $take: Int
    $skip: Int
    $orderBy: [TransactionOrderByWithRelationInput!]
  ) {
    transactions(where: $where, take: $take, skip: $skip, orderBy: $orderBy) {
      id
      account_id
      transaction_status
      transaction_type
      balance
      comment
      transaction_number
      created_at
      transaction_detail {
        sender {
          id
          customer {
            name
          }
        }
        recipient {
          id
          customer {
            name
          }
        }
      }
    }
  }
`;

export const GET_WALLET_TRANSACTIONS_BY_CLINIC = gql`
  query GetWalletTransactionsByClinic(
    $clinicCode: String!
    $skip: Int
    $take: Int
    $fromDate: String
    $toDate: String
  ) {
    getWalletTransactionsByClinic(
      clinicCode: $clinicCode
      skip: $skip
      take: $take
      fromDate: $fromDate
      toDate: $toDate
    ) {
      data {
        transactionNumber
        type
        status
        balance
        comment
        accountbalance
        mainAccountName
        senderName
        senderPhone
        recipientName
        recipientPhone
        createddate_myanmar
      }
      totalCount
    }
  }
`;

export const GET_WALLET_SUMMARY = gql`
  query GetWalletSummary($clinicCode: String!, $fromDate: String, $toDate: String) {
    getWalletSummary(clinicCode: $clinicCode, fromDate: $fromDate, toDate: $toDate) {
      totalIn
      totalOut
      transactionCount
      balance
    }
  }
`;

function buildPassAccountWhere(passCode: string, searchText: string) {
  const trimmedSearch = searchText.trim();
  const filters: Array<Record<string, unknown>> = [];

  if (trimmedSearch) {
    filters.push({ account_number: { contains: trimmedSearch } });
    filters.push({
      customer: {
        is: {
          OR: [
            { name: { contains: trimmedSearch } },
            { phone_number: { contains: trimmedSearch } },
          ],
        },
      },
    });
  }

  const baseWhere: Record<string, unknown> = {
    account_type: {
      is: {
        code: {
          equals: passCode,
        },
      },
    },
  };

  if (filters.length === 1) {
    return {
      ...baseWhere,
      ...filters[0],
    };
  }

  if (filters.length > 1) {
    return {
      ...baseWhere,
      OR: filters,
    };
  }

  return baseWhere;
}

export function buildPassAccountsVariables(args: {
  passCode: string;
  searchText: string;
  take: number;
  skip: number;
}) {
  return {
    where: buildPassAccountWhere(args.passCode, args.searchText),
    orderBy: [{ balance: "desc" }],
    take: args.take,
    skip: args.skip,
  };
}

export function buildPassAccountsCountVariables(passCode: string, searchText: string) {
  return {
    where: buildPassAccountWhere(passCode, searchText),
  };
}

export function buildPassAccountTransactionsVariables(args: {
  accountId: string;
  take: number;
  skip: number;
}) {
  return {
    where: {
      account_id: {
        equals: args.accountId,
      },
    },
    orderBy: [{ created_at: "desc" }],
    take: args.take,
    skip: args.skip,
  };
}

export function buildWalletTransactionsVariables(args: {
  clinicCode: string;
  fromDate: string;
  toDate: string;
  take: number;
  skip: number;
}) {
  return {
    clinicCode: args.clinicCode,
    fromDate: args.fromDate,
    toDate: args.toDate,
    take: args.take,
    skip: args.skip,
  };
}

export function buildWalletSummaryVariables(args: {
  clinicCode: string;
  fromDate: string;
  toDate: string;
}) {
  return {
    clinicCode: args.clinicCode,
    fromDate: args.fromDate,
    toDate: args.toDate,
  };
}
