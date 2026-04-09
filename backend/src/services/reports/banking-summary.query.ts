export const walletTopupExpression = `
  (
    STARTS_WITH(COALESCE(InvoiceNumber, ''), 'TO')
    OR LOWER(COALESCE(CAST(WalletTopUp AS STRING), '')) LIKE '%point%'
    OR LOWER(COALESCE(CAST(WalletTopUp AS STRING), '')) LIKE '%topup%'
  )
`;

export const bankingSummaryCommonWhere = `
  DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
    AND PaymentStatus = 'PAID'
    AND LOWER(ClinicCode) = LOWER(@clinicCode)
    AND (
      @search = ''
      OR LOWER(COALESCE(InvoiceNumber, '')) LIKE LOWER(CONCAT('%', @search, '%'))
      OR LOWER(COALESCE(CustomerName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
      OR LOWER(COALESCE(CustomerPhoneNumber, '')) LIKE LOWER(CONCAT('%', @search, '%'))
      OR LOWER(COALESCE(MemberId, '')) LIKE LOWER(CONCAT('%', @search, '%'))
      OR LOWER(COALESCE(SellerName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
      OR LOWER(COALESCE(ServiceName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
      OR LOWER(COALESCE(ServicePackageName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
    )
    AND (
      @walletTopupFilter = 'all'
      OR (@walletTopupFilter = 'hide' AND NOT ${walletTopupExpression})
      OR (@walletTopupFilter = 'only' AND ${walletTopupExpression})
    )
`;
