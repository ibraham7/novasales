import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RotateCcw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  askSerenaFn,
  clearSerenaHistory,
  getSerenaHistory,
} from "@/modules/serena/serena.functions";

const SUGGESTIONS = [
  "شو أكثر بضاعة عليها طلب هالشهر، وشو ما عليها طلب؟",
  "كم ربحنا هالشهر مقارنة بالشهر الماضي، وعلى أي منتجات خسرنا؟",
  "شو لازم نجيب بضاعة بكرا وقديش تقريبًا؟",
  "شو الأشياء اللي بيسألوا عنها الزباين بالواتساب وما عنا ياها؟",
  "اقترح عروض أو باقات تزيد ربحنا",
];

type Turn = { role: "user" | "assistant"; content: string; error?: boolean };

// Minimal markdown (headings, lists, **bold**) rendered as React elements, never as HTML.
function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, index) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={index}>{part.slice(2, -2)}</strong>
      ) : (
        part
      ),
    );
}
function Answer({ text }: { text: string }) {
  return (
    <div className="space-y-1 text-sm leading-7">
      {text.split("\n").map((line, index) => {
        const heading = line.match(/^#{1,4}\s+(.*)/);
        if (heading)
          return (
            <p key={index} className="font-bold pt-2">
              {inline(heading[1])}
            </p>
          );
        const bullet = line.match(/^\s*[-*•]\s+(.*)/);
        if (bullet)
          return (
            <p
              key={index}
              className="ps-4 relative before:content-['•'] before:absolute before:start-0"
            >
              {inline(bullet[1])}
            </p>
          );
        const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)/);
        if (numbered)
          return (
            <p key={index} className="ps-5 relative">
              <span className="absolute start-0 font-semibold">{numbered[1]}.</span>
              {inline(numbered[2])}
            </p>
          );
        if (/^\s*\|?[-:| ]{3,}\|?\s*$/.test(line)) return null;
        if (line.trim().startsWith("|"))
          return (
            <p key={index} className="text-xs">
              {line
                .trim()
                .replace(/^\||\|$/g, "")
                .split("|")
                .map((cell) => cell.trim())
                .join(" · ")}
            </p>
          );
        return line.trim() ? <p key={index}>{inline(line)}</p> : null;
      })}
    </div>
  );
}

/** The conversation with Serena; used on the /serena page and in the floating window. */
export function SerenaChat({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const ask = useServerFn(askSerenaFn);
  const loadHistory = useServerFn(getSerenaHistory);
  const clearHistory = useServerFn(clearSerenaHistory);
  const historyQ = useQuery({
    queryKey: ["serena-history"],
    queryFn: () => loadHistory(),
    staleTime: 60_000,
  });
  const [pending, setPending] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const turns: Turn[] = [...(historyQ.data?.turns ?? []), ...pending];

  const askMut = useMutation({
    mutationFn: (question: string) => ask({ data: { question } }),
    onMutate: (question) => setPending([{ role: "user", content: question }]),
    onSuccess: async (result, question) => {
      if (!result.ok) {
        setPending([
          { role: "user", content: question },
          { role: "assistant", content: result.error, error: true },
        ]);
        return;
      }
      await qc.invalidateQueries({ queryKey: ["serena-history"] });
      setPending([]);
    },
    onError: (error: Error, question) =>
      setPending([
        { role: "user", content: question },
        { role: "assistant", content: error.message || "تعذر الاتصال بسيرينا.", error: true },
      ]),
  });
  const clearMut = useMutation({
    mutationFn: () => clearHistory(),
    onSuccess: async () => {
      setPending([]);
      await qc.invalidateQueries({ queryKey: ["serena-history"] });
    },
  });

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns.length, askMut.isPending]);

  const submit = (question: string) => {
    const text = question.trim();
    if (!text || askMut.isPending) return;
    setInput("");
    askMut.mutate(text);
  };

  return (
    <div
      className={cn("flex flex-col min-h-0", compact ? "h-full" : "h-[calc(100vh-10rem)]")}
      dir="rtl"
    >
      <div className="flex items-center gap-3 pb-3 border-b">
        <div className="h-10 w-10 rounded-full grid place-items-center bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold">سيرينا</p>
          <p className="text-xs text-muted-foreground">
            تحلل مبيعاتك ومخزونك ومحادثات الزباين وتقترح شو تعمل
          </p>
        </div>
        {turns.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            title="محادثة جديدة"
            aria-label="محادثة جديدة"
            disabled={clearMut.isPending || askMut.isPending}
            onClick={() => clearMut.mutate()}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-4 space-y-3" aria-live="polite">
        {!turns.length && !historyQ.isLoading && (
          <div className="text-sm text-muted-foreground space-y-3">
            <p>أهلًا 👋 أنا سيرينا. اسألني عن بضاعتك ومبيعاتك وزباينك، أو اختر سؤالًا:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => submit(suggestion)}
                  className="text-xs rounded-full border px-3 py-1.5 hover:bg-accent transition-colors text-start"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn, index) =>
          turn.role === "user" ? (
            <div
              key={index}
              className="ms-auto max-w-[85%] w-fit rounded-2xl rounded-tl-sm bg-primary text-primary-foreground px-4 py-2 text-sm whitespace-pre-wrap"
            >
              {turn.content}
            </div>
          ) : (
            <div
              key={index}
              className={cn(
                "max-w-[95%] rounded-2xl rounded-tr-sm border px-4 py-3",
                turn.error
                  ? "border-destructive/40 bg-destructive/5 text-destructive"
                  : "bg-muted/40",
              )}
            >
              {turn.error ? (
                <p className="text-sm">{turn.content}</p>
              ) : (
                <Answer text={turn.content} />
              )}
              {turn.error && turn.content.includes("الإعدادات") && (
                <Link to="/settings/serena" className="text-xs underline mt-2 inline-block">
                  فتح إعدادات سيرينا
                </Link>
              )}
            </div>
          ),
        )}
        {askMut.isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> سيرينا تراجع البيانات…
          </div>
        )}
        <div ref={end} />
      </div>

      <form
        className="flex gap-2 items-end pt-3 border-t"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          submit(input);
        }}
      >
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit(input);
            }
          }}
          placeholder="اسأل سيرينا… مثلًا: شو نجيب بضاعة بكرا؟"
          aria-label="سؤالك لسيرينا"
          rows={compact ? 2 : 3}
          maxLength={4000}
          className="resize-none"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!input.trim() || askMut.isPending}
          aria-label="إرسال"
        >
          <Send className="h-4 w-4 -scale-x-100" />
        </Button>
      </form>
    </div>
  );
}
