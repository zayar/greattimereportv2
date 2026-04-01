import { ApolloClient, InMemoryCache, createHttpLink, from } from "@apollo/client";
import { setContext } from "@apollo/client/link/context";
import { auth } from "../lib/firebase";
import { env } from "../lib/env";

const httpLink = createHttpLink({
  uri: env.apicoreProxyUrl,
});

const authLink = setContext(async (_, previousContext) => {
  const headers = previousContext.headers ?? {};
  const currentUser = auth.currentUser;

  if (!currentUser) {
    return { headers };
  }

  const token = await currentUser.getIdToken();
  return {
    headers: {
      ...headers,
      Authorization: `Bearer ${token}`,
    },
  };
});

export const apolloClient = new ApolloClient({
  link: from([authLink, httpLink]),
  cache: new InMemoryCache({
    addTypename: false,
  }),
});
