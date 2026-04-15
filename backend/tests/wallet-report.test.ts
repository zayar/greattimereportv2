import assert from "node:assert/strict"
import test from "node:test"
import {
  walletAccountSearchClause,
  walletTransactionSearchClause,
} from "../src/services/reports/wallet-report.query.ts"

test("wallet account search matches both wallet name and phone number", () => {
  assert.match(walletAccountSearchClause, /COALESCE\(name, ''\)/)
  assert.match(walletAccountSearchClause, /COALESCE\(phoneNumber, ''\)/)
})

test("wallet transaction search spans transaction, comment, and participant identity fields", () => {
  assert.match(walletTransactionSearchClause, /transactionNumber/)
  assert.match(walletTransactionSearchClause, /comment/)
  assert.match(walletTransactionSearchClause, /senderName/)
  assert.match(walletTransactionSearchClause, /senderPhone/)
  assert.match(walletTransactionSearchClause, /recipientName/)
  assert.match(walletTransactionSearchClause, /recipientPhone/)
  assert.match(walletTransactionSearchClause, /mainAccountName/)
})
