import { gql } from "@apollo/client";

export const GET_CHECKIN_OUT_DATA = gql`
  query CheckInOutData(
    $where: CheckInWhereInput
    $orderBy: [CheckInOrderByWithRelationInput!]
    $take: Int
    $skip: Int
    $clinicMembersWhere2: ClinicMemberWhereInput
  ) {
    checkIns(where: $where, orderBy: $orderBy, take: $take, skip: $skip) {
      id
      in_time
      out_time
      status
      created_at
      isUsePurchaseService
      merchant_note
      order_id
      service {
        id
        name
      }
      practitioner {
        id
        name
      }
      member {
        name
        phonenumber
        clinic_members(where: $clinicMembersWhere2) {
          name
          phonenumber
          clinic_id
        }
      }
      booking {
        service_helper {
          id
          name
        }
      }
      orders {
        order_id
        discount
        tax
        total
        net_total
        payment_method
        payment_status
        seller {
          display_name
        }
      }
      helper {
        name
      }
    }
    aggregateCheckIn(where: $where) {
      _count {
        _all
      }
    }
  }
`;

export const GET_CHECKIN_ORDER_ITEMS = gql`
  query CheckInOrderItems($where: OrderItemWhereInput, $orderBy: [OrderItemOrderByWithRelationInput!]) {
    orderItems(where: $where, orderBy: $orderBy) {
      id
      price
      total
      service_id
      order_id
    }
  }
`;

type BuildCheckInOutVariablesParams = {
  clinicId: string;
  fromDate: string;
  toDate: string;
  search: string;
  status?: string;
  take: number;
  skip: number;
};

export function buildCheckInOutVariables(params: BuildCheckInOutVariablesParams) {
  const search = params.search.trim();
  const where: Record<string, unknown> = {
    AND: [
      {
        in_time: {
          gte: new Date(`${params.fromDate}T00:00:00.000Z`).toISOString(),
        },
      },
      {
        in_time: {
          lte: new Date(`${params.toDate}T23:59:59.999Z`).toISOString(),
        },
      },
      {
        clinic_id: {
          equals: params.clinicId,
        },
      },
    ],
  };

  if (params.status) {
    (where.AND as Array<Record<string, unknown>>).push({
      status: {
        in: [params.status],
      },
    });
  }

  if (search) {
    where.OR = [
      {
        member: {
          is: {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { phonenumber: { contains: search, mode: "insensitive" } },
            ],
          },
        },
      },
      {
        practitioner: {
          is: {
            name: { contains: search, mode: "insensitive" },
          },
        },
      },
      {
        booking: {
          is: {
            service_helper: {
              is: {
                name: { contains: search, mode: "insensitive" },
              },
            },
          },
        },
      },
      {
        service: {
          is: {
            name: { contains: search, mode: "insensitive" },
          },
        },
      },
    ];
  }

  return {
    where,
    clinicMembersWhere2: {
      clinic_id: {
        equals: params.clinicId,
      },
    },
    orderBy: [{ in_time: "desc" }],
    take: params.take,
    skip: params.skip,
  };
}

export function buildCheckInOrderItemsVariables(orderIds: string[]) {
  return {
    where: {
      order_id: {
        in: orderIds,
      },
      service_id: {
        not: null,
      },
    },
    orderBy: [{ created_at: "desc" }],
  };
}
