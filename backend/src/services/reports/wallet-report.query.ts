export const walletAccountSearchClause = `
  (
    @search = ''
    OR LOWER(COALESCE(name, '')) LIKE LOWER(CONCAT('%', @search, '%'))
    OR LOWER(COALESCE(phoneNumber, '')) LIKE LOWER(CONCAT('%', @search, '%'))
  )
`;

export const walletTransactionSearchClause = `
  (
    @search = ''
    OR LOWER(COALESCE(transactionNumber, '')) LIKE LOWER(CONCAT('%', @search, '%'))
    OR LOWER(COALESCE(comment, '')) LIKE LOWER(CONCAT('%', @search, '%'))
    OR LOWER(COALESCE(mainAccountName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
    OR LOWER(COALESCE(senderName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
    OR LOWER(COALESCE(senderPhone, '')) LIKE LOWER(CONCAT('%', @search, '%'))
    OR LOWER(COALESCE(recipientName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
    OR LOWER(COALESCE(recipientPhone, '')) LIKE LOWER(CONCAT('%', @search, '%'))
  )
`;
