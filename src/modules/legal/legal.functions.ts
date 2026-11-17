import { createServerFn } from "@tanstack/react-start";

/** The company details printed on the public legal pages. Public on purpose: it holds no secret. */
export const getLegalInfoFn = createServerFn({ method: "GET" }).handler(async () => {
  const { legalInfoFromEnv } = await import("./legal-content");
  return legalInfoFromEnv();
});
