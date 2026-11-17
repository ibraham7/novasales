// The public legal pages (privacy, terms, data deletion), in Arabic and English. Required by Meta for
// an app that reads messages. The company details come from the server's environment, so the same
// code serves whichever company runs the platform. General wording, not legal advice: have a lawyer
// read it before relying on it.

export type LegalInfo = { company: string | null; email: string | null; country: string | null };

export function legalInfoFromEnv(env: Record<string, string | undefined> = process.env): LegalInfo {
  const clean = (value: string | undefined) => value?.trim() || null;
  return { company: clean(env.LEGAL_COMPANY_NAME), email: clean(env.LEGAL_CONTACT_EMAIL), country: clean(env.LEGAL_COUNTRY) };
}

export function missingLegalInfo(info: LegalInfo) {
  return (["company", "email", "country"] as const).filter((key) => !info[key]);
}

export type LegalSection = { heading: string; paragraphs: string[] };
export type LegalDoc = { title: string; updated: string; sections: LegalSection[] };
export type LegalKind = "privacy" | "terms" | "deletion";
export type Lang = "ar" | "en";

const UPDATED = { ar: "آخر تحديث: 18 نوفمبر 2026", en: "Last updated: 18 November 2026" };

export function legalDoc(kind: LegalKind, lang: Lang, info: LegalInfo): LegalDoc {
  const company = info.company ?? (lang === "ar" ? "[اسم الشركة]" : "[Company name]");
  const email = info.email ?? (lang === "ar" ? "[البريد الإلكتروني]" : "[contact email]");
  const country = info.country ?? (lang === "ar" ? "[البلد]" : "[country]");
  const ar = lang === "ar";

  if (kind === "privacy") {
    return {
      title: ar ? "سياسة الخصوصية" : "Privacy Policy",
      updated: UPDATED[lang],
      sections: ar
        ? [
            { heading: "من نحن", paragraphs: [`تدير ${company} (${country}) منصة NovaSales لإدارة المبيعات والمحادثات. تشرح هذه السياسة كيف نتعامل مع البيانات عندما تربط شركتك حساباتها على إنستغرام وواتساب وغيرهما بالمنصة.`] },
            { heading: "البيانات التي نعالجها", paragraphs: ["عند ربط حساب إنستغرام: معرّف الحساب واسم المستخدم، ورمز وصول يمنحه إنستغرام للمنصة بموافقتك.", "الرسائل التي يرسلها عملاء شركتك إلى الحساب المربوط والرسائل التي يرد بها فريقها، مع معرّف العميل في إنستغرام واسمه إن توفّر، والصور المرفقة.", "لا نرى كلمة سر حسابك في إنستغرام ولا نطلبها. تسجيل الدخول يتم في صفحة إنستغرام الرسمية."] },
            { heading: "كيف نستخدمها", paragraphs: ["لعرض الرسائل لفريق الشركة المالكة للحساب فقط، وإتاحة الرد عليها، وربطها بسجلات العملاء والصفقات داخل المنصة. لا نبيع البيانات ولا نستخدمها للإعلانات."] },
            { heading: "الفصل بين الشركات", paragraphs: ["كل شركة تستخدم المنصة تملك بياناتها وحدها. لا تظهر رسائل حساب لأي شركة أخرى ولا لأي مستخدم خارج الشركة التي ربطته."] },
            { heading: "الحفظ والأمان", paragraphs: ["تُحفظ رموز الوصول مشفّرة، وتُنقل البيانات عبر اتصال مشفّر. نحفظ الرسائل ما دام حساب الشركة نشطاً، أو حتى تطلب الشركة حذفها. عند فصل الحساب يُحذف رمز الوصول فوراً."] },
            { heading: "المشاركة", paragraphs: ["لا نشارك البيانات إلا مع مزوّدي الخدمة الذين يشغّلون المنصة (الاستضافة وقاعدة البيانات) وبالقدر اللازم للتشغيل، أو عند وجود التزام قانوني."] },
            { heading: "حقوقك", paragraphs: [`يمكنك طلب الاطلاع على بياناتك أو تصحيحها أو حذفها في أي وقت. تفاصيل الحذف في صفحة «حذف البيانات». للتواصل: ${email}.`] },
          ]
        : [
            { heading: "Who we are", paragraphs: [`${company} (${country}) operates NovaSales, a platform for managing sales and conversations. This policy explains how data is handled when your company links its Instagram, WhatsApp and other accounts to the platform.`] },
            { heading: "Data we process", paragraphs: ["When an Instagram account is linked: the account id and username, and an access token that Instagram grants the platform with your consent.", "Messages that your company's customers send to the linked account and the replies its team sends, with the customer's Instagram-scoped id and name where available, and attached photos.", "We never see or ask for your Instagram password. You sign in on Instagram's own page."] },
            { heading: "How we use it", paragraphs: ["To show messages to the team of the company that owns the account only, let them reply, and connect conversations to customer and deal records in the platform. We do not sell data or use it for advertising."] },
            { heading: "Separation between companies", paragraphs: ["Each company using the platform owns its data alone. One company's messages are never visible to another company or to any user outside the company that linked the account."] },
            { heading: "Storage and security", paragraphs: ["Access tokens are stored encrypted and data travels over encrypted connections. We keep messages while the company's account is active, or until the company asks for deletion. Disconnecting an account deletes its access token immediately."] },
            { heading: "Sharing", paragraphs: ["We share data only with the service providers that run the platform (hosting and database) as needed to operate it, or when the law requires."] },
            { heading: "Your rights", paragraphs: [`You may ask to see, correct or delete your data at any time. Deletion steps are on the Data Deletion page. Contact: ${email}.`] },
          ],
    };
  }

  if (kind === "terms") {
    return {
      title: ar ? "شروط الاستخدام" : "Terms of Service",
      updated: UPDATED[lang],
      sections: ar
        ? [
            { heading: "القبول", paragraphs: [`باستخدامك منصة NovaSales التي تديرها ${company} فإنك توافق على هذه الشروط.`] },
            { heading: "الخدمة", paragraphs: ["تتيح المنصة للشركات ربط حسابات التواصل (مثل إنستغرام وواتساب) واستقبال رسائل العملاء والرد عليها وإدارة المبيعات."] },
            { heading: "مسؤوليتك", paragraphs: ["أنت مسؤول عن الحسابات التي تربطها وعن المحتوى الذي ترسله، وعن الالتزام بشروط المنصات المرتبطة، ومنها قاعدة الرد خلال 24 ساعة من آخر رسالة للعميل في إنستغرام، ومنع الرسائل غير المرغوبة."] },
            { heading: "الاستخدام المسموح", paragraphs: ["لا يجوز استخدام المنصة للاحتيال أو الإزعاج أو مخالفة القانون أو شروط إنستغرام وميتا. يحق لنا إيقاف الحساب عند المخالفة."] },
            { heading: "التوفّر والمسؤولية", paragraphs: ["نبذل جهدنا لاستمرار الخدمة، لكنها تعتمد على منصات خارجية قد تتغير أو تتعطل خارج سيطرتنا. تُقدَّم الخدمة كما هي ضمن الحد الذي يسمح به القانون."] },
            { heading: "إنهاء الخدمة", paragraphs: ["يمكنك فصل أي حساب أو إغلاق حسابك في أي وقت، وفق صفحة «حذف البيانات»."] },
            { heading: "التواصل", paragraphs: [`للاستفسار: ${email} — ${company}، ${country}.`] },
          ]
        : [
            { heading: "Acceptance", paragraphs: [`By using the NovaSales platform operated by ${company} you agree to these terms.`] },
            { heading: "The service", paragraphs: ["The platform lets companies link messaging accounts (such as Instagram and WhatsApp), receive and answer customer messages, and manage sales."] },
            { heading: "Your responsibility", paragraphs: ["You are responsible for the accounts you link, the content you send, and following the linked platforms' rules, including Instagram's rule of replying within 24 hours of a customer's last message and avoiding unwanted messages."] },
            { heading: "Acceptable use", paragraphs: ["Do not use the platform for fraud, harassment, or anything that breaks the law or Instagram and Meta terms. We may suspend an account that does."] },
            { heading: "Availability and liability", paragraphs: ["We work to keep the service running, but it depends on third-party platforms that may change or fail outside our control. The service is provided as is, to the extent the law allows."] },
            { heading: "Ending the service", paragraphs: ["You may disconnect any account or close yours at any time, as described on the Data Deletion page."] },
            { heading: "Contact", paragraphs: [`Questions: ${email} — ${company}, ${country}.`] },
          ],
    };
  }

  return {
    title: ar ? "حذف البيانات" : "Data Deletion",
    updated: UPDATED[lang],
    sections: ar
      ? [
          { heading: "فصل حساب إنستغرام", paragraphs: ["من داخل المنصة: الجلسات ← إنستغرام ← «فصل». يُحذف رمز الوصول فوراً ولا تصل رسائل الحساب بعد ذلك."] },
          { heading: "حذف بياناتك نهائياً", paragraphs: [`أرسل طلباً إلى ${email} من البريد المسجّل في حسابك، مع اسم المستخدم في إنستغرام. نحذف الرسائل والبيانات المرتبطة بالحساب خلال 30 يوماً ونؤكد لك بالبريد.`] },
          { heading: "إذا كنت عميلاً راسل إحدى الشركات", paragraphs: [`يمكنك طلب حذف رسائلك وبياناتك التي تحتفظ بها الشركة عبر المنصة بمراسلتنا على ${email} مع اسم حسابك في إنستغرام واسم الشركة التي راسلتها.`] },
          { heading: "إزالة التطبيق من إنستغرام", paragraphs: ["يمكنك أيضاً إزالة صلاحية التطبيق من إنستغرام: الإعدادات ← التطبيقات والمواقع الإلكترونية. عندها يتوقف وصول المنصة إلى الحساب."] },
        ]
      : [
          { heading: "Disconnect an Instagram account", paragraphs: ["Inside the platform: Sessions → Instagram → Disconnect. The access token is deleted immediately and the account's messages stop arriving."] },
          { heading: "Delete your data permanently", paragraphs: [`Email ${email} from the address registered on your account, with your Instagram username. We delete the messages and data tied to the account within 30 days and confirm by email.`] },
          { heading: "If you are a customer who messaged a company", paragraphs: [`You can ask for your messages and data held by the company through the platform to be deleted by writing to ${email} with your Instagram username and the company you messaged.`] },
          { heading: "Remove the app from Instagram", paragraphs: ["You can also remove the app's access in Instagram: Settings → Apps and websites. The platform then loses access to the account."] },
        ],
  };
}
