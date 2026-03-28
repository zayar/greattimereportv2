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

export const GET_SALE_DETAIL = gql`
  query Orders($where: OrderWhereInput, $take: Int, $clinicMembersWhere2: ClinicMemberWhereInput) {
    orders(where: $where, take: $take) {
      id
      order_id
      created_at
      status
      total
      net_total
      discount
      tax
      balance
      credit_balance
      payment_method
      payment_status
      payment_detail
      metadata
      member_id
      clinic {
        name
        code
        description
        address
        phonenumber
        logo
        printer_logo
        currency
      }
      member {
        name
        phonenumber
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
      payments {
        payment_amount
        payment_method
        payment_note
        payment_date
      }
      order_items {
        id
        quantity
        total
        tax
        price
        original_price
        metadata
        service {
          name
          image
        }
        service_package {
          name
          image
        }
        product_stock_item {
          name
        }
        practitioner {
          name
        }
      }
    }
  }
`;
