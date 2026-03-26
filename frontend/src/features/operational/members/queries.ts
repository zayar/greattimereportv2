import { gql } from "@apollo/client";

export const GET_MEMBERS = gql`
  query GetMembers(
    $clinicId: String!
    $version: String
    $search: String
    $limit: Int
    $offset: Int
  ) {
    getMembers(
      clinicId: $clinicId
      version: $version
      search: $search
      limit: $limit
      offset: $offset
    ) {
      id
      name
      phonenumber
      member_id
      image
      created_at
      status
    }
  }
`;

