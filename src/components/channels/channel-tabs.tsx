import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

type Tab = { key: string; label: string; to?: "/instances" | "/channels" };

// One tab per channel. Channels without a page yet are listed so people see what is coming.
const TABS: Tab[] = [
  { key: "whatsapp", label: "واتساب", to: "/instances" },
  { key: "instagram", label: "إنستغرام", to: "/channels" },
  { key: "facebook", label: "فيسبوك / ماسنجر" },
  { key: "email", label: "الإيميل" },
  { key: "youtube", label: "يوتيوب" },
  { key: "tiktok", label: "تيك توك" },
  { key: "snapchat", label: "سناب شات" },
];

export function ChannelTabs({ active }: { active: "whatsapp" | "instagram" }) {
  return (
    <nav aria-label="قنوات التواصل" className="mb-6 -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {TABS.map((tab) =>
        tab.to ? (
          <Link
            key={tab.key}
            to={tab.to}
            className={cn(
              "shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
              tab.key === active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
            aria-current={tab.key === active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ) : (
          <span
            key={tab.key}
            className="shrink-0 cursor-not-allowed rounded-full border border-dashed px-4 py-1.5 text-sm text-muted-foreground"
            title="قريباً"
          >
            {tab.label} <span className="text-[10px]">· قريباً</span>
          </span>
        ),
      )}
    </nav>
  );
}
