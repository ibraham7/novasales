import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { legalDoc, missingLegalInfo, type Lang, type LegalInfo, type LegalKind } from "@/modules/legal/legal-content";

const LINKS: { kind: LegalKind; to: "/privacy" | "/terms" | "/data-deletion"; ar: string; en: string }[] = [
  { kind: "privacy", to: "/privacy", ar: "الخصوصية", en: "Privacy" },
  { kind: "terms", to: "/terms", ar: "الشروط", en: "Terms" },
  { kind: "deletion", to: "/data-deletion", ar: "حذف البيانات", en: "Data deletion" },
];

/** A public page (no sign-in), in Arabic with an English switch. */
export function LegalPage({ kind, info }: { kind: LegalKind; info: LegalInfo }) {
  const [lang, setLang] = useState<Lang>("ar");
  const doc = legalDoc(kind, lang, info);
  const missing = missingLegalInfo(info);
  return (
    <div className="min-h-screen bg-background text-foreground" dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <nav className="flex flex-wrap gap-1" aria-label="legal">
            {LINKS.map((link) => (
              <Link
                key={link.kind}
                to={link.to}
                className={cn("rounded-full border px-3 py-1 text-sm", link.kind === kind ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}
              >
                {lang === "ar" ? link.ar : link.en}
              </Link>
            ))}
          </nav>
          <button type="button" onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="rounded-full border px-3 py-1 text-sm hover:bg-accent">
            {lang === "ar" ? "English" : "العربية"}
          </button>
        </header>
        {missing.length > 0 && (
          <p role="alert" className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {lang === "ar"
              ? "تنبيه للإدارة: لم تُضبط بيانات الشركة على الخادم (LEGAL_COMPANY_NAME وLEGAL_CONTACT_EMAIL وLEGAL_COUNTRY). تظهر الأقواس [ ] بدلاً منها."
              : "Admin notice: company details are not set on the server (LEGAL_COMPANY_NAME, LEGAL_CONTACT_EMAIL, LEGAL_COUNTRY). Bracketed placeholders are shown."}
          </p>
        )}
        <h1 className="text-3xl font-bold">{doc.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{doc.updated}</p>
        <div className="mt-8 space-y-8">
          {doc.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="mb-2 text-xl font-semibold">{section.heading}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph} className="mb-2 leading-relaxed text-foreground/90">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
