import { gql } from "@apollo/client";

export const GET_SALES = gql`
  query Orders(
    $where: OrderWhereInput
    $orderBy: [OrderOrderByWithRelationInput!]
    $take: Int
    $skip: Int
    $clinicMembersWhere2: ClinicMemberWhereInput
  ) {
    orders(where: $where, orderBy: $orderBy, take: $take, skip: $skip) {
      id
      order_id
      created_at
      net_total
      total
      discount
      tax
      payment_method
      payment_status
      balance
      credit_balance
      member {
        name
        clinic_members(where: $clinicMembersWhere2) {
          name
          clinic_id
        }
      }
      user {
        name
      }
      seller {
        display_name
      }
    }
    aggregateOrder(where: $where) {
      _count {
        id
      }
    }
  }
`;

