import { gql } from "@apollo/client";

export const GET_ALLOWED_CLINICS = gql`
  query Clinics($where: ClinicWhereInput) {
    clinics(where: $where) {
      id
      logo
      name
      company_id
      code
      currency
      company {
        name
      }
      _count {
        members
        bookings
        practitioners
      }
    }
  }
`;

