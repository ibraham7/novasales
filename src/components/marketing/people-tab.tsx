import { Lock, Users } from "lucide-react";
import { PRESETS } from "@/modules/marketing/filters";
import { LockedFilters } from "./filters-sidebar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";

const PEOPLE_FILTERS = [
  ["Job Titles", "المسمى الوظيفي (مع «المسميات المشابهة»)"],
  ["Seniority", "Owner, Founder, C-Suite, Partner, VP, Head, Director, Manager, Senior, Entry, Intern"],
  ["Departments", "Marketing, Sales, Engineering, IT, HR, Finance, Operations, Legal…"],
  ["Person Location", "الدولة والمنطقة والمدينة ونطاق بالكيلومتر"],
  ["Email / Phone Status", "Verified, Unverified, Likely to Engage · جوال، مباشر"],
  ["Experience", "المدة بالوظيفة، سنوات الخبرة، تغيير الوظيفة مؤخراً، اللغات"],
] as const;

/** People search needs a person-level data source. Until one is connected the filters are listed, not faked. */
export function PeopleTab() {
  const preset = PRESETS[0]!;
  return (
    <div className="grid gap-4 lg:grid-cols-[17rem_1fr]">
      <Card className="h-fit p-4">
        <p className="pb-2 text-sm font-semibold">فلاتر الأشخاص</p>
        <LockedFilters groups={["people", "company", "signals"]} />
      </Card>
      <div className="space-y-3">
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertTitle>البحث عن الأشخاص يتطلب مصدر بيانات</AlertTitle>
          <AlertDescription>
            خرائط Google تعطي بيانات المنشآت فقط (الاسم، الهاتف، الموقع…)، ولا تعطي أشخاصاً ولا مسمياتهم الوظيفية. عند ربط مصدر بيانات أشخاص (مثل Apollo) تتفعّل الفلاتر التالية هنا بنفس شكل فلاتر الشركات (تضمين/استثناء، اختيار متعدد، حفظ وروابط).
          </AlertDescription>
        </Alert>
        <Card className="space-y-2 p-4">
          <p className="flex items-center gap-2 text-sm font-medium"><Users className="h-4 w-4" /> الفلاتر المخطط لها</p>
          <ul className="space-y-1 text-sm">
            {PEOPLE_FILTERS.map(([title, text]) => (
              <li key={title}>
                <span dir="ltr" className="font-medium">{title}</span> <span className="text-muted-foreground">— {text}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="space-y-1 p-4 text-sm">
          <p className="font-medium">قالب «{preset.name}»</p>
          <p className="text-muted-foreground">يُطبَّق الآن من تبويب «الشركات» (الموقع: السعودية، الرياض/جدة/الدمام). وهذه الشروط تُضاف عند توفر مصدر الأشخاص:</p>
          <ul className="list-disc pr-5 text-muted-foreground">
            {preset.needsData.map((t) => (
              <li key={t} dir="auto">{t}</li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
