import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

export default function ChatMessageList({ messages }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
      {messages.length === 0 && (
        <div className="text-center text-gray-400 text-sm mt-8">
          Send a message to start the conversation
        </div>
      )}
      {messages.map((msg) => {
        const isVisitor = msg.sender_type === "visitor";
        return (
          <div key={msg.id} className={cn("flex items-end gap-2", isVisitor ? "justify-end" : "justify-start")}>
            {!isVisitor && (
              <img
                src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69b04cb7a1570d9772c3e08f/b36761f8c_profilephoto.png"
                alt="Poppy"
                className="h-7 w-7 rounded-full object-cover shrink-0 mb-4"
              />
            )}
            <div className={cn("max-w-[75%] space-y-1")}>
              {!isVisitor && (
                <p className="text-[10px] text-gray-500 font-medium px-1">Poppy</p>
              )}
              <div
                className={cn(
                  "px-3.5 py-2 rounded-2xl text-sm leading-relaxed",
                  isVisitor
                    ? "bg-blue-600 text-white rounded-br-md"
                    : "bg-gray-100 text-gray-800 rounded-bl-md"
                )}
              >
                {msg.content}
              </div>
              <p className={cn("text-[10px] text-gray-400 px-1", isVisitor && "text-right")}>
                {msg.created_date ? format(new Date(msg.created_date), "h:mm a") : ""}
              </p>
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}