import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pencil } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { updateOppNote } from "@/modules/crm";

export type TicketNote = { id: string; body: string; author_name: string | null; created_at?: string; can_edit?: boolean };

/** One note of a ticket, with an «تعديل» button for whoever may change it (its author, or a manager). */
export function NoteItem({ oppId, note, className, bodyClassName, dateText }: {
  oppId: string;
  note: TicketNote;
  className?: string;
  bodyClassName?: string;
  /** Already formatted date, shown beside the author. */
  dateText?: string;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(updateOppNote);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.body);
  const save = useMutation({
    mutationFn: () => saveFn({ data: { noteId: note.id, body: text } }),
    onSuccess: () => {
      toast.success("تم تعديل الملاحظة");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["opp-notes", oppId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className={className}>
      <div className="mb-0.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>{[note.author_name ?? "—", dateText].filter(Boolean).join(" · ")}</span>
        {note.can_edit && !editing && (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded px-1 text-primary hover:bg-primary/10"
            onClick={() => { setText(note.body); setEditing(true); }}
          >
            <Pencil className="h-3 w-3" /> تعديل
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-1.5">
          <Textarea aria-label="تعديل الملاحظة" autoFocus rows={4} className="min-h-24 resize-y text-sm" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={save.isPending || !text.trim() || text.trim() === note.body.trim()} onClick={() => save.mutate()}>
              {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={save.isPending} onClick={() => setEditing(false)}>إلغاء</Button>
          </div>
        </div>
      ) : (
        <div className={cn("whitespace-pre-wrap", bodyClassName)}>{note.body}</div>
      )}
    </div>
  );
}
