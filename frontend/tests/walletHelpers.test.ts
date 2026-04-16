import assert from "node:assert/strict"
import test from "node:test"
import {
  buildWalletAccountKey,
  buildWalletTransactionsExportRows,
  getWalletCounterpartyLabel,
  getWalletDirectionTone,
  walletTransactionExportHeaders,
} from "../src/features/operational/wallets/walletHelpers"

test("builds stable wallet account keys from wallet identity", () => {
  assert.equal(buildWalletAccountKey({ name: "Fancy House", phoneNumber: "09977606777" }), "Fancy House::09977606777")
})

test("derives counterparty text from transfer direction", () => {
  assert.equal(
    getWalletCounterpartyLabel({
      status: "IN",
      senderName: "Aye Mya Hla",
      senderPhone: "095106751",
      recipientName: "Fancy House",
      recipientPhone: "09977606777",
    }),
    "From Aye Mya Hla",
  )

  assert.equal(
    getWalletCounterpartyLabel({
      status: "OUT",
      senderName: "Fancy House",
      senderPhone: "09977606777",
      recipientName: "Tin Zar",
      recipientPhone: "09765419441",
    }),
    "To Tin Zar",
  )
})

test("keeps export rows numeric for wallet amount columns", () => {
  const rows = buildWalletTransactionsExportRows([
    {
      dateLabel: "2026-04-12 13:27:53",
      transactionNumber: "21177597707340431",
      type: "Transfer",
      status: "OUT",
      amount: 530000,
      balance: 20000,
      comment: "",
      accountName: "Aye Mya Hla",
      senderName: "Aye Mya Hla",
      senderPhone: "095106751",
      recipientName: "Fancy House Beaut & Spa",
      recipientPhone: "09977606777",
    },
  ])

  assert.equal(getWalletDirectionTone("IN"), "positive")
  assert.equal(getWalletDirectionTone("OUT"), "attention")
  assert.equal(typeof rows[0]?.[4], "number")
  assert.equal(typeof rows[0]?.[5], "number")
  assert.equal(walletTransactionExportHeaders.length, rows[0]?.length)
})
