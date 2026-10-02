import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "@/lib/toast";
import { Upload, X, ImageIcon, Play, ChevronLeft, ChevronRight } from "lucide-react";
import { createProductImageUpload } from "@/modules/commerce/product-images.functions";
import { PRODUCT_MEDIA_TYPES } from "@/modules/commerce/product-input";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
export type ProductMedia = { images: string[]; videos: string[] };

export function ProductMediaEditor({
  media,
  onChange,
  onBusyChange,
}: {
  media: ProductMedia;
  onChange: (media: ProductMedia) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const [linkType, setLinkType] = useState<"images" | "videos">("images");
  const createUpload = useServerFn(createProductImageUpload);
  async function upload(files: File[]) {
    if (locked.current || !files.length) return;
    let next = { images: [...media.images], videos: [...media.videos] };
    locked.current = true;
    setBusy(true);
    onBusyChange(true);
    let succeeded = 0;
    try {
      for (const file of files) {
        const isVideo = file.type.startsWith("video/");
        const key = isVideo ? "videos" : "images";
        const limit = isVideo ? 4 : 12;
        if (!(PRODUCT_MEDIA_TYPES as readonly string[]).includes(file.type)) {
          toast.error(`${file.name}: صيغة غير مدعومة`);
          continue;
        }
        if (file.size > (isVideo ? 25 : 5) * 1024 * 1024) {
          toast.error(`${file.name}: الحد الأقصى ${isVideo ? 25 : 5}MB`);
          continue;
        }
        if (next[key].length >= limit) {
          toast.error(`الحد الأقصى ${limit} ${isVideo ? "فيديوهات" : "صور"}`);
          continue;
        }
        try {
          const signed = await createUpload({
            data: {
              fileName: file.name,
              contentType: file.type as (typeof PRODUCT_MEDIA_TYPES)[number],
              size: file.size,
            },
          });
          const { error } = await supabase.storage
            .from(signed.bucket)
            .uploadToSignedUrl(signed.path, signed.token, file, {
              contentType: file.type,
              cacheControl: "3600",
            });
          if (error) throw error;
          const { data } = supabase.storage.from(signed.bucket).getPublicUrl(signed.path);
          next = { ...next, [key]: [...next[key], data.publicUrl] };
          onChange(next);
          succeeded++;
        } catch (error) {
          toast.error(`${file.name}: ${error instanceof Error ? error.message : "تعذر رفع الملف"}`);
        }
      }
      if (succeeded) toast.success(`تم رفع ${succeeded} ملف؛ احفظ المنتج لتثبيت التغييرات`);
    } finally {
      locked.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }
  function addLink() {
    try {
      const url = new URL(link.trim());
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      if (media[linkType].length >= (linkType === "images" ? 12 : 4)) {
        toast.error("وصلت للحد الأقصى");
        return;
      }
      if (media[linkType].includes(url.href)) {
        toast.error("الرابط مضاف بالفعل");
        return;
      }
      onChange({ ...media, [linkType]: [...media[linkType], url.href] });
      setLink("");
    } catch {
      toast.error("أدخل رابط HTTP أو HTTPS مباشرًا للملف");
    }
  }
  return (
    <section className="space-y-3">
      <p className="font-medium">صور وفيديوهات المنتج</p>
      <input
        ref={input}
        type="file"
        multiple
        accept={PRODUCT_MEDIA_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          void upload(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <div
        className="border-2 border-dashed rounded-xl p-5 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void upload(Array.from(e.dataTransfer.files));
        }}
      >
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Upload className="h-4 w-4 ml-2" />
          {busy ? "جارٍ رفع الملفات..." : "إضافة صور أو فيديوهات"}
        </Button>
        <p className="text-xs text-muted-foreground mt-2">
          يمكن اختيار عدة ملفات أو سحبها هنا. حتى 12 صورة (5MB للصورة) و4 فيديوهات MP4 / WebM (25MB
          للفيديو).
        </p>
      </div>
      {(["images", "videos"] as const).map((key) => (
        <div key={key} className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {media[key].map((url, index) => (
            <div key={`${url}-${index}`} className="relative border rounded-lg p-2 space-y-2">
              {key === "images" ? (
                <img src={url} alt={`صورة ${index + 1}`} className="w-full h-28 object-contain" />
              ) : (
                <video
                  src={url}
                  controls
                  preload="metadata"
                  className="w-full h-28 object-contain"
                />
              )}
              <p className="text-xs">
                {key === "images"
                  ? `صورة ${index + 1}${index === 0 ? " — الغلاف" : ""}`
                  : `فيديو ${index + 1}`}
              </p>
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  aria-label={`حذف ${key === "images" ? "الصورة" : "الفيديو"} ${index + 1}`}
                  onClick={() =>
                    onChange({ ...media, [key]: media[key].filter((_, i) => i !== index) })
                  }
                >
                  <X className="h-3 w-3" />
                </Button>
                {key === "images" && index > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      onChange({
                        ...media,
                        images: [url, ...media.images.filter((_, i) => i !== index)],
                      })
                    }
                  >
                    تعيين غلاف
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
      <div className="flex flex-col sm:flex-row gap-2">
        <select
          aria-label="نوع رابط الوسائط"
          className="border rounded-md bg-background p-2 text-sm"
          value={linkType}
          onChange={(e) => setLinkType(e.target.value as typeof linkType)}
          disabled={busy}
        >
          <option value="images">رابط صورة</option>
          <option value="videos">رابط فيديو</option>
        </select>
        <Input
          aria-label="رابط ملف مباشر"
          placeholder="https://..."
          dir="ltr"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          disabled={busy}
        />
        <Button type="button" variant="outline" onClick={addLink} disabled={busy || !link.trim()}>
          إضافة الرابط
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        روابط الفيديو يجب أن تشير إلى ملف MP4 أو WebM مباشر.
      </p>
    </section>
  );
}

export function ProductGallery({
  images = [],
  videos = [],
  name,
}: {
  images?: string[];
  videos?: string[];
  name: string;
}) {
  const entries = [
    ...images.map((url) => ({ url, video: false })),
    ...videos.map((url) => ({ url, video: true })),
  ];
  const [index, setIndex] = useState(0),
    [expanded, setExpanded] = useState(false);
  const activeIndex = Math.min(index, Math.max(entries.length - 1, 0));
  const active = entries[activeIndex];
  function content(large = false) {
    return active?.video ? (
      <video
        key={active.url}
        src={active.url}
        controls
        preload="metadata"
        className={large ? "w-full max-h-[70dvh] object-contain" : "w-full h-full object-contain"}
      />
    ) : active ? (
      <img
        src={active.url}
        alt={name}
        loading="lazy"
        className={large ? "w-full max-h-[70dvh] object-contain" : "w-full h-full object-contain"}
      />
    ) : (
      <ImageIcon className="h-12 w-12 text-muted-foreground/40" />
    );
  }
  return (
    <div className="space-y-2 pb-2">
      <div className="aspect-[16/10] bg-muted flex items-center justify-center">
        {active?.video ? (
          content()
        ) : (
          <button
            type="button"
            aria-label={`تكبير صورة ${name}`}
            className="w-full h-full flex items-center justify-center"
            disabled={!active}
            onClick={() => setExpanded(true)}
          >
            {content()}
          </button>
        )}
      </div>
      {entries.length > 0 && (
        <div className="flex items-center justify-between gap-2 px-2">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="الوسيط السابق"
            disabled={entries.length < 2}
            onClick={() => setIndex((activeIndex - 1 + entries.length) % entries.length)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-xs">
            {active?.video ? "فيديو" : "صورة"} {activeIndex + 1} / {entries.length}
          </span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="الوسيط التالي"
            disabled={entries.length < 2}
            onClick={() => setIndex((activeIndex + 1) % entries.length)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      )}
      {entries.length > 1 && (
        <div className="flex gap-1 px-2 overflow-x-auto">
          {entries.map((entry, i) => (
            <button
              type="button"
              key={`${entry.url}-${i}`}
              aria-label={`عرض ${entry.video ? "فيديو" : "صورة"} ${i + 1}`}
              aria-pressed={activeIndex === i}
              onClick={() => setIndex(i)}
              className={`shrink-0 w-12 h-12 rounded border flex items-center justify-center ${activeIndex === i ? "border-primary ring-1 ring-primary" : ""}`}
            >
              {entry.video ? (
                <Play className="h-4 w-4" />
              ) : (
                <img
                  src={entry.url}
                  alt=""
                  loading="lazy"
                  className="w-full h-full object-contain"
                />
              )}
            </button>
          ))}
        </div>
      )}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="sm:max-w-4xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>{name}</DialogTitle>
          </DialogHeader>
          {content(true)}
        </DialogContent>
      </Dialog>
    </div>
  );
}
