type SalesOrderWhereParams = {
  clinicId: string;
  fromDate: string;
  toDate: string;
  search: string;
  showZeroValue: boolean;
  showCoOrders: boolean;
};

const ZERO_DECIMAL = "0";

function parseInputDate(value: string, endOfDay = false) {
  const [year, month, day] = value.split("-").map(Number);

  return endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
}

export function buildSalesOrderWhere(params: SalesOrderWhereParams) {
  const search = params.search.trim();
  const where: Record<string, unknown> = {
    clinic_id: { equals: params.clinicId },
    created_at: {
      gte: parseInputDate(params.fromDate).toISOString(),
      lte: parseInputDate(params.toDate, true).toISOString(),
    },
  };
  const andClauses: Record<string, unknown>[] = [];

  if (!params.showZeroValue) {
    andClauses.push({
      net_total: {
        not: {
          equals: ZERO_DECIMAL,
        },
      },
    });
  }

  if (!params.showCoOrders) {
    andClauses.push({
      order_id: {
        not: {
          startsWith: "CO-",
        },
      },
    });
  }

  if (search) {
    andClauses.push({
      OR: [
        {
          member: {
            is: {
              OR: [{ name: { contains: search } }, { phonenumber: { contains: search } }],
            },
          },
        },
        {
          user: {
            is: {
              name: { contains: search },
            },
          },
        },
        {
          order_id: {
            contains: search,
          },
        },
      ],
    });
  }

  if (andClauses.length > 0) {
    where.AND = andClauses;
  }

  return where;
}
