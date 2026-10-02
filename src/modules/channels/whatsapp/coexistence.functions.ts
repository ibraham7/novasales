import { createServerFn } from "@tanstack/react-start";
import { z } from "@/lib/validation";

/** إعدادات الربط الرسمي المطلوبة للواجهة (لا تحتوي أي سر). */
export const getCoexistenceSetupFn = createServerFn({ method: "GET" }).handler(async () => {
  const { coexistenceSetup } = await import("./coexistence.server");
  return coexistenceSetup();
});

/** يكمل الربط بعد نجاح Embedded Signup في نافذة Meta. */
export const linkCoexistenceFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        code: z.string().trim().min(10).max(2000),
        redirectUri: z.string().trim().min(1).max(500),
        // بيانات تشخيص غير حساسة لقياس عمر الرمز ومطابقة التطبيق بين المتصفح والخادم.
        codeReceivedAt: z.number().int().positive().optional(),
        browserAppId: z.string().trim().min(3).max(64).optional(),
        wabaId: z.string().trim().min(3).max(64).optional(),
        phoneNumberId: z.string().trim().min(3).max(64).optional(),
        displayName: z.string().trim().min(1).max(80).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { getWorkspace } = await import("@/platform/workspace/workspace.server");
    const { linkCoexistenceNumber } = await import("./coexistence.server");
    const { userId, organizationId } = await getWorkspace();
    return linkCoexistenceNumber(userId, organizationId, {
      code: data.code,
      redirectUri: data.redirectUri,
      codeReceivedAt: data.codeReceivedAt,
      browserAppId: data.browserAppId,
      wabaId: data.wabaId,
      phoneNumberId: data.phoneNumberId,
      displayName: data.displayName,
    });
  });


