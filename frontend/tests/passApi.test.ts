import assert from "node:assert/strict"
import test from "node:test"
import { queryPassGraphql } from "../src/api/pass"

test("queryPassGraphql refreshes a PASS token and resolves GraphQL data", async () => {
  const calls: Array<{ url: string; body?: string | null }> = []
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, body: typeof init?.body === "string" ? init.body : null })

    if (url === "https://example.com/refresh") {
      return new Response(JSON.stringify({
        access_token: "token-1",
        expires_in: 3600,
      }), { status: 200 })
    }

    return new Response(JSON.stringify({
      data: {
        accounts: [{ id: "acc-1" }],
      },
    }), { status: 200 })
  }) as typeof fetch

  try {
    const result = await queryPassGraphql<{ accounts: Array<{ id: string }> }>({
      query: "query Accounts { accounts { id } }",
      passConfig: {
        id: "PASS-CODE-1",
        refresh_token: "refresh",
        refresh_token_url: "https://example.com/refresh",
      },
    })

    assert.deepEqual(result, {
      accounts: [{ id: "acc-1" }],
    })
    assert.equal(calls.length, 2)
    assert.equal(calls[0]?.url, "https://example.com/refresh")
    assert.equal(calls[1]?.url, "https://api.pitipass.com/graphql")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("queryPassGraphql retries once when PASS returns an auth error", async () => {
  const originalFetch = globalThis.fetch
  let refreshCount = 0
  let graphqlCount = 0

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)

    if (url === "https://example.com/refresh") {
      refreshCount += 1
      return new Response(JSON.stringify({
        access_token: `token-${refreshCount}`,
        expires_in: 3600,
      }), { status: 200 })
    }

    graphqlCount += 1
    if (graphqlCount === 1) {
      return new Response(JSON.stringify({
        errors: [{ message: "Unauthorized" }],
      }), { status: 200 })
    }

    return new Response(JSON.stringify({
      data: {
        aggregateAccount: {
          _count: {
            id: 3,
          },
        },
      },
    }), { status: 200 })
  }) as typeof fetch

  try {
    const result = await queryPassGraphql<{
      aggregateAccount: {
        _count: {
          id: number
        }
      }
    }>({
      query: "query AggregateAccount { aggregateAccount { _count { id } } }",
      passConfig: {
        id: "PASS-CODE-2",
        refresh_token: "refresh",
        refresh_token_url: "https://example.com/refresh",
      },
    })

    assert.equal(refreshCount, 2)
    assert.equal(graphqlCount, 2)
    assert.equal(result.aggregateAccount._count.id, 3)
  } finally {
    globalThis.fetch = originalFetch
  }
})
