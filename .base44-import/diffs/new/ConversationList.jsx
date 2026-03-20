import React from "react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { MessageCircle, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function ConversationList({ conversations, selectedId, onSelect }) {
  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 px-6">
        <MessageCircle className="h-10 w-10 mb-3 stroke-1" />
        <p className="text-sm font-medium">No conversations yet</p>
        <p className="text-xs mt-1 text-center">Conversations will appear here when visitors start chatting.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {conversations.map((convo) => (
        <button
          key={convo.id}
          onClick={() => onSelect(convo)}
          className={cn(
            "w-full text-left px-4 py-3.5 hover:bg-gray-50 transition-colors flex gap-3",
            selectedId === convo.id && "bg-blue-50 hover:bg-blue-50"
          )}
        >
          <div className="h-9 w-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 text-sm font-semibold">
            {convo.visitor_name?.[0]?.toUpperCase() || <User className="h-4 w-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900 truncate">{convo.visitor_name}</p>
              {convo.unread_count > 0 && (
                <Badge className="bg-blue-600 text-white text-[10px] h-5 min-w-[20px] flex items-center justify-center">
                  {convo.unread_count}
                </Badge>
              )}
            </div>
            <p className="text-xs text-gray-500 truncate mt-0.5">{convo.last_message || "No messages yet"}</p>
            <p className="text-[10px] text-gray-400 mt-1">
              {convo.created_date ? format(new Date(convo.created_date), "MMM d, h:mm a") : ""}
              {convo.status === "closed" && (
                <span className="ml-2 text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded text-[9px] uppercase font-medium">
                  Closed
                </span>
              )}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}