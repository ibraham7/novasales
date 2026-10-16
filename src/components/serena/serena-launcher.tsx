import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SerenaChat } from "./serena-chat";

/** Floating "ask Serena" button, like a support chat bubble, available on every page. */
export function SerenaLauncher() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="اسأل سيرينا"
        title="اسأل سيرينا"
        className="fixed bottom-5 left-5 z-40 h-14 w-14 rounded-full grid place-items-center text-white shadow-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 hover:scale-105 transition-transform"
      >
        <Sparkles className="h-6 w-6" />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-full sm:max-w-md p-4 flex flex-col">
          <SheetTitle className="sr-only">سيرينا</SheetTitle>
          {open && <SerenaChat compact />}
        </SheetContent>
      </Sheet>
    </>
  );
}
