import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

/** The WhatsApp-style voice message player (waveform, seek, speed). Used by the chat page and the ticket page. */
export function VoicePlayer({ src, fromMe }: { src: string; fromMe: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<1 | 1.5 | 2>(1);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  // Lock src for the lifetime of this component. The parent re-signs media
  // URLs on every refetch, so a changing `src` reloads <audio> and cuts
  // playback after ~1s. Keep only the first URL we received.
  const [stableSrc] = useState(src);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => {
      setCurrentTime(a.currentTime);
      setProgress(a.duration ? (a.currentTime / a.duration) * 100 : 0);
    };
    const onMeta = () => setDuration(a.duration || 0);
    const onEnd = () => { setPlaying(false); setProgress(0); setCurrentTime(0); };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("ended", onEnd);
    };
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play(); setPlaying(true); } else { a.pause(); setPlaying(false); }
  };

  const cycleRate = () => {
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const fmt = (s: number) => {
    if (!isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const bars = useMemo(() => {
    // Pseudo-random but stable waveform seeded from the (locked) src.
    let seed = 0;
    for (let i = 0; i < stableSrc.length; i++) seed = (seed * 31 + stableSrc.charCodeAt(i)) >>> 0;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed & 0xffff) / 0xffff;
    };
    return Array.from({ length: 32 }, () => 0.25 + rnd() * 0.75);
  }, [stableSrc]);

  const handleSeek = (e: MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !a.duration || !isFinite(a.duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // RTL layout: seek from the right edge
    const ratio = 1 - (e.clientX - rect.left) / rect.width;
    a.currentTime = Math.max(0, Math.min(a.duration, ratio * a.duration));
  };

  return (
    <div className={cn(
      "flex items-center gap-2 min-w-[240px] py-1",
      fromMe ? "text-white" : "text-foreground"
    )}>
      <audio ref={audioRef} src={stableSrc} preload="auto" className="hidden" />
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "shrink-0 h-9 w-9 rounded-full flex items-center justify-center transition",
          fromMe ? "bg-white/20 hover:bg-white/30" : "bg-emerald-600 text-white hover:bg-emerald-700"
        )}
        aria-label={playing ? "إيقاف" : "تشغيل"}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div
          className="flex items-center gap-[2px] h-6 cursor-pointer"
          onClick={handleSeek}
        >
          {bars.map((h, i) => {
            const played = ((i + 1) / bars.length) * 100 <= progress;
            return (
              <span
                key={i}
                className={cn(
                  "w-[3px] rounded-full transition-colors",
                  played
                    ? (fromMe ? "bg-white" : "bg-emerald-600")
                    : (fromMe ? "bg-white/40" : "bg-muted-foreground/40")
                )}
                style={{ height: `${h * 100}%` }}
              />
            );
          })}
        </div>
        <div className={cn("text-[10px] mt-0.5 tabular-nums", fromMe ? "opacity-80" : "text-muted-foreground")}>
          {fmt(playing || currentTime > 0 ? currentTime : duration)}
        </div>
      </div>
      <button
        type="button"
        onClick={cycleRate}
        className={cn(
          "shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md tabular-nums",
          fromMe ? "bg-white/20 hover:bg-white/30" : "bg-muted hover:bg-muted/80"
        )}
        aria-label="سرعة التشغيل"
      >
        {rate}x
      </button>
    </div>
  );
}
