import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { X, RotateCw, RotateCcw, Crop, Undo2, Send, Plus, FileText, Film, Music } from "lucide-react";

export type MediaKind = "image" | "video" | "audio" | "document";

export interface PreviewItem {
  id: string;
  file: File;
  url: string;
  kind: MediaKind;
  original: File;
}

export function kindOf(mime: string): MediaKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

export function makeItems(files: File[]): PreviewItem[] {
  return files.map((f) => ({
    id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`,
    file: f,
    original: f,
    url: URL.createObjectURL(f),
    kind: kindOf(f.type || "application/octet-stream"),
  }));
}

type Rect = { x: number; y: number; w: number; h: number };

export function MediaPreviewDialog({
  items,
  setItems,
  caption,
  setCaption,
  onCancel,
  onSend,
  sending,
  progress,
  onAddMore,
}: {
  items: PreviewItem[];
  setItems: (updater: (prev: PreviewItem[]) => PreviewItem[]) => void;
  caption: string;
  setCaption: (v: string) => void;
  onCancel: () => void;
  onSend: () => void;
  sending: boolean;
  progress: Record<string, number>;
  onAddMore?: () => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);
  const active = items.find((i) => i.id === activeId) ?? items[0] ?? null;
  const [rect, setRect] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const imgWrapRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!items.some((i) => i.id === activeId)) setActiveId(items[0]?.id ?? null);
  }, [items, activeId]);

  useEffect(() => {
    setRect(null);
  }, [activeId]);

  function replaceActive(blob: Blob, name: string, type: string) {
    if (!active) return;
    const file = new File([blob], name, { type });
    const url = URL.createObjectURL(file);
    setItems((prev) => prev.map((i) => (i.id === active.id ? { ...i, file, url } : i)));
    setRect(null);
  }

  async function loadImage(url: string) {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  }

  async function rotate(dir: 1 | -1) {
    if (!active || active.kind !== "image") return;
    setBusy(true);
    try {
      const img = await loadImage(active.url);
      const c = document.createElement("canvas");
      c.width = img.naturalHeight;
      c.height = img.naturalWidth;
      const ctx = c.getContext("2d")!;
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((dir * 90 * Math.PI) / 180);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      const type = active.file.type.startsWith("image/") && active.file.type !== "image/gif" ? active.file.type : "image/jpeg";
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, type, 0.92));
      if (blob) replaceActive(blob, active.file.name, type);
    } finally {
      setBusy(false);
    }
  }

  async function applyCrop() {
    if (!active || active.kind !== "image" || !rect || rect.w < 0.02 || rect.h < 0.02) return;
    setBusy(true);
    try {
      const img = await loadImage(active.url);
      const sx = Math.round(rect.x * img.naturalWidth);
      const sy = Math.round(rect.y * img.naturalHeight);
      const sw = Math.round(rect.w * img.naturalWidth);
      const sh = Math.round(rect.h * img.naturalHeight);
      const c = document.createElement("canvas");
      c.width = sw;
      c.height = sh;
      c.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const type = active.file.type.startsWith("image/") && active.file.type !== "image/gif" ? active.file.type : "image/jpeg";
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, type, 0.92));
      if (blob) replaceActive(blob, active.file.name, type);
    } finally {
      setBusy(false);
    }
  }

  function resetActive() {
    if (!active) return;
    setItems((prev) =>
      prev.map((i) => (i.id === active.id ? { ...i, file: i.original, url: URL.createObjectURL(i.original) } : i))
    );
    setRect(null);
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!imgWrapRef.current) return;
    const b = imgWrapRef.current.getBoundingClientRect();
    dragStart.current = { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height };
    setRect({ x: dragStart.current.x, y: dragStart.current.y, w: 0, h: 0 });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragStart.current || !imgWrapRef.current) return;
    const b = imgWrapRef.current.getBoundingClientRect();
    const cx = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width));
    const cy = Math.min(1, Math.max(0, (e.clientY - b.top) / b.height));
    const s = dragStart.current;
    setRect({ x: Math.min(s.x, cx), y: Math.min(s.y, cy), w: Math.abs(cx - s.x), h: Math.abs(cy - s.y) });
  }
  function onPointerUp() {
    dragStart.current = null;
  }

  const totalProgress = (() => {
    const vals = items.map((i) => progress[i.id] ?? 0);
    if (vals.length === 0) return 0;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  })();

  return (
    <Dialog open={items.length > 0} onOpenChange={(o) => !o && !sending && onCancel()}>
      <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden" dir="rtl">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="text-base">معاينة قبل الإرسال ({items.length})</DialogTitle>
        </DialogHeader>

        <div className="p-4 space-y-3">
          {/* Main preview */}
          <div className="rounded-lg bg-muted/40 border flex items-center justify-center min-h-[280px] max-h-[46vh] overflow-hidden">
            {!active ? null : active.kind === "image" ? (
              <div
                ref={imgWrapRef}
                className="relative inline-block select-none touch-none cursor-crosshair"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                <img src={active.url} alt="" className="max-h-[46vh] object-contain pointer-events-none" />
                {rect && rect.w > 0.01 && rect.h > 0.01 && (
                  <div
                    className="absolute border-2 border-primary bg-primary/10 pointer-events-none"
                    style={{
                      left: `${rect.x * 100}%`,
                      top: `${rect.y * 100}%`,
                      width: `${rect.w * 100}%`,
                      height: `${rect.h * 100}%`,
                    }}
                  />
                )}
              </div>
            ) : active.kind === "video" ? (
              <video src={active.url} controls className="max-h-[46vh] w-full" />
            ) : active.kind === "audio" ? (
              <div className="p-6 w-full">
                <audio src={active.url} controls className="w-full" />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                <FileText className="h-10 w-10" />
                <span className="text-sm">{active.file.name}</span>
                <span className="text-xs">{(active.file.size / 1024).toFixed(0)} KB</span>
              </div>
            )}
          </div>

          {/* Image tools */}
          {active?.kind === "image" && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button type="button" variant="outline" size="sm" disabled={busy || sending} onClick={() => rotate(-1)}>
                <RotateCcw className="h-3.5 w-3.5 ml-1.5" /> تدوير يسار
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={busy || sending} onClick={() => rotate(1)}>
                <RotateCw className="h-3.5 w-3.5 ml-1.5" /> تدوير يمين
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || sending || !rect || rect.w < 0.02}
                onClick={applyCrop}
              >
                <Crop className="h-3.5 w-3.5 ml-1.5" /> قص التحديد
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy || sending} onClick={resetActive}>
                <Undo2 className="h-3.5 w-3.5 ml-1.5" /> استعادة الأصل
              </Button>
              <span className="text-[11px] text-muted-foreground">اسحب على الصورة لتحديد منطقة القص</span>
            </div>
          )}

          {/* Thumbnails */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {items.map((i) => (
              <div
                key={i.id}
                className={cn(
                  "relative h-16 w-16 shrink-0 rounded-md border overflow-hidden cursor-pointer bg-muted",
                  i.id === active?.id && "ring-2 ring-primary"
                )}
                onClick={() => setActiveId(i.id)}
              >
                {i.kind === "image" ? (
                  <img src={i.url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                    {i.kind === "video" ? <Film className="h-5 w-5" /> : i.kind === "audio" ? <Music className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                  </div>
                )}
                {!sending && (
                  <button
                    type="button"
                    className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-black/60 text-white flex items-center justify-center"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeItem(i.id);
                    }}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
                {sending && (
                  <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[9px] text-center">
                    {progress[i.id] ?? 0}%
                  </div>
                )}
              </div>
            ))}
            {onAddMore && !sending && (
              <button
                type="button"
                onClick={onAddMore}
                className="h-16 w-16 shrink-0 rounded-md border border-dashed flex items-center justify-center text-muted-foreground hover:bg-muted"
              >
                <Plus className="h-5 w-5" />
              </button>
            )}
          </div>

          {/* Caption + progress */}
          <Textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={2}
            disabled={sending}
            placeholder="أضف تعليقاً (اختياري)..."
            className="resize-none"
          />

          {sending && (
            <div className="space-y-1">
              <Progress value={totalProgress} className="h-2" />
              <div className="text-xs text-muted-foreground text-center">جارٍ الرفع... {totalProgress}%</div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t flex justify-end gap-2 bg-muted/30">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={sending}>
            إلغاء
          </Button>
          <Button type="button" onClick={onSend} disabled={sending || items.length === 0 || busy}>
            <Send className="h-4 w-4 ml-1.5" /> {sending ? `${totalProgress}%` : "إرسال"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
