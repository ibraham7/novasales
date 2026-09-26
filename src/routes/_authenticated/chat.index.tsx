import {
  createFileRoute,
} from "@tanstack/react-router";

import {
  MessagesSquare,
} from "lucide-react";

export const Route =
  createFileRoute(
    "/_authenticated/chat/",
  )({
    component:
      ChatEmptyState,
  });

function ChatEmptyState() {
  return (
    <div className="hidden md:flex flex-1 items-center justify-center text-muted-foreground">
      <div className="text-center max-w-sm px-6">
        <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-5">
          <MessagesSquare className="h-9 w-9 opacity-50" />
        </div>

        <h2 className="text-lg font-semibold text-foreground">
          اختر محادثة
        </h2>

        <p className="text-sm mt-2 leading-6">
          اختر عميلًا من قائمة
          المحادثات لعرض الرسائل
          وبيانات الفرصة وبدء
          التواصل.
        </p>
      </div>
    </div>
  );
}