import assert from "node:assert/strict"
import test from "node:test"
import {
  getClinicPassConfig,
  getClinicPassCode,
  mapLegacyWalletTransaction,
  mapPassAccountRow,
  matchesWalletTransactionSearch,
  summarizeWalletTransactions,
} from "../src/features/operational/wallets/walletData"

test("extracts pass code from clinic pass config JSON", () => {
  assert.deepEqual(getClinicPassConfig({
    pass: JSON.stringify({
      id: "GTTHEQUEEN",
      refresh_token: "refresh",
      refresh_token_url: "https://example.com/refresh",
    }),
  }), {
    id: "GTTHEQUEEN",
    refresh_token: "refresh",
    refresh_token_url: "https://example.com/refresh",
  })
  assert.equal(getClinicPassCode({ pass: JSON.stringify({ id: "GTTHEQUEEN" }) }), "GTTHEQUEEN")
  assert.equal(getClinicPassCode({ pass: "DIRECTCODE" }), "DIRECTCODE")
  assert.equal(getClinicPassCode({ pass: "" }), "")
})

test("maps pass account and legacy transaction rows into wallet models", () => {
  const account = mapPassAccountRow({
    id: "account-1",
    balance: "530000",
    account_number: "ACC-1",
    customer: { id: "customer-1", name: "Aye Mya Hla", phone_number: "095106751" },
    _count: { transactions: 5 },
  })

  const transaction = mapLegacyWalletTransaction({
    transactionNumber: "21177597707340431",
    type: "Transfer",
    status: "OUT",
    balance: "530000",
    accountbalance: "20000",
    comment: "Promo wallet",
    mainAccountName: "Fancy House",
    senderName: "Aye Mya Hla",
    senderPhone: "095106751",
    recipientName: "Fancy House",
    recipientPhone: "09977606777",
    createddate_myanmar: "2026-04-12 13:27:53",
  })

  assert.equal(account.name, "Aye Mya Hla")
  assert.equal(account.transactionCount, 5)
  assert.equal(transaction.amount, 530000)
  assert.equal(transaction.balance, 20000)
})

test("filters and summarizes wallet transaction search results", () => {
  const rows = [
    {
      dateLabel: "2026-04-12 13:27:53",
      transactionNumber: "21177597707340431",
      type: "Transfer",
      status: "IN",
      amount: 530000,
      balance: 193010700,
      comment: "From Aye Mya Hla",
      accountName: "Fancy House",
      senderName: "Aye Mya Hla",
      senderPhone: "095106751",
      recipientName: "Fancy House",
      recipientPhone: "09977606777",
    },
    {
      dateLabel: "2026-04-11 13:26:00",
      transactionNumber: "21177589056076931",
      type: "Transfer",
      status: "OUT",
      amount: 160000,
      balance: 10000,
      comment: "To Tin Zar",
      accountName: "Fancy House",
      senderName: "Fancy House",
      senderPhone: "09977606777",
      recipientName: "Tin Zar",
      recipientPhone: "09765419441",
    },
  ]

  assert.equal(matchesWalletTransactionSearch(rows[0], "aye mya"), true)
  assert.equal(matchesWalletTransactionSearch(rows[1], "promo"), false)
  assert.deepEqual(summarizeWalletTransactions(rows), {
    totalIn: 530000,
    totalOut: 160000,
    transactionCount: 2,
    netMovement: 370000,
  })
})
