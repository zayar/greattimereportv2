import { gql } from "@apollo/client";

export const GET_BOOKING_DETAILS = gql`
  query GetBookingDetails(
    $clinicCode: String!
    $startDate: DateTime!
    $endDate: DateTime!
    $status: BookingStatus
    $skip: Int
    $take: Int
  ) {
    getBookingDetails(
      clinicCode: $clinicCode
      startDate: $startDate
      endDate: $endDate
      status: $status
      skip: $skip
      take: $take
    ) {
      data {
        bookingid
        FromTime
        ToTime
        ServiceName
        MemberName
        MemberPhoneNumber
        PractitionerName
        ClinicName
        ClinicCode
        ClinicID
        HelperName
        status
        member_note
      }
      totalCount
    }
  }
`;

