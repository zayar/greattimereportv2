import { gql, useMutation, useQuery } from "@apollo/client";
import { useCallback, useMemo } from "react";
import {
  defaultSalesDocumentConfig,
  getSalesDocumentConfigCode,
  normalizeSalesDocumentConfig,
  parseSalesDocumentConfig,
  type SalesDocumentConfig,
} from "./salesDocumentConfig";

type SystemDataRecord = {
  id: string;
  code: string;
  metadata: string | null;
  description?: string | null;
};

type FindSystemDataResponse = {
  findUniqueSystemData: SystemDataRecord | null;
};

type UpsertSystemDataResponse = {
  upsertOneSystemData: {
    id: string;
  };
};

const FIND_SYSTEM_DATA = gql`
  query FindUniqueSystemData($where: SystemDataWhereUniqueInput!) {
    findUniqueSystemData(where: $where) {
      id
      code
      metadata
      description
    }
  }
`;

const UPSERT_SYSTEM_DATA = gql`
  mutation UpsertOneSystemData(
    $where: SystemDataWhereUniqueInput!
    $create: SystemDataCreateInput!
    $update: SystemDataUpdateInput!
  ) {
    upsertOneSystemData(where: $where, create: $create, update: $update) {
      id
    }
  }
`;

function buildFindVariables(code: string) {
  return {
    where: {
      code,
    },
  };
}

function buildUpsertVariables(code: string, metadata: string) {
  const description = "GT V2 sales document template";

  return {
    where: { code },
    create: {
      code,
      metadata,
      description,
    },
    update: {
      metadata: {
        set: metadata,
      },
      description: {
        set: description,
      },
    },
  };
}

export function useSalesDocumentConfig(clinicId?: string | null) {
  const code = clinicId ? getSalesDocumentConfigCode(clinicId) : null;
  const { data, loading, error, refetch } = useQuery<FindSystemDataResponse>(FIND_SYSTEM_DATA, {
    variables: code ? buildFindVariables(code) : undefined,
    skip: !code,
  });
  const [upsertConfigMutation, { loading: saving }] = useMutation<UpsertSystemDataResponse>(UPSERT_SYSTEM_DATA);

  const config = useMemo(() => {
    return parseSalesDocumentConfig(data?.findUniqueSystemData?.metadata);
  }, [data?.findUniqueSystemData?.metadata]);

  const saveConfig = useCallback(
    async (nextConfig: SalesDocumentConfig) => {
      if (!code) {
        return defaultSalesDocumentConfig;
      }

      const normalizedConfig = normalizeSalesDocumentConfig(nextConfig);
      const metadata = JSON.stringify(normalizedConfig);
      await upsertConfigMutation({
        variables: buildUpsertVariables(code, metadata),
      });
      await refetch();

      return normalizedConfig;
    },
    [code, refetch, upsertConfigMutation],
  );

  return {
    config,
    loading,
    saving,
    errorMessage: error instanceof Error ? error.message : null,
    hasSavedConfig: Boolean(data?.findUniqueSystemData),
    saveConfig,
  };
}
