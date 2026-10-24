import { test } from "node:test";
import assert from "node:assert/strict";
import { openSecret, sealSecret } from "../src/modules/integrations/secret-box.server.ts";

test("seals with the service key and still opens after META_APP_SECRET is added", async () => {
  for (const name of ["SOCIAL_TOKEN_KEY", "META_APP_SECRET"]) delete process.env[name];
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key-for-test";
  const sealed = await sealSecret("EAAB-secret-token");
  assert.equal(sealed.includes("EAAB"), false);
  assert.equal(await openSecret(sealed), "EAAB-secret-token");
  process.env.META_APP_SECRET = "later-app-secret";
  assert.equal(await openSecret(sealed), "EAAB-secret-token");
  const damaged = (await sealSecret("x")).slice(0, 20);
  await assert.rejects(() => openSecret(damaged));
});
