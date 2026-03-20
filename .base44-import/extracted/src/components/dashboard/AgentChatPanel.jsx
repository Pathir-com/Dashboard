import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Send, User, XCircle, Mail, MessageCircle } from "lucide-react";

export default function AgentChatPanel({ conversation, onConversationUpdate }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  // Load messages
  useEffect(() => {
    if (!conversation) return;
    const loadMessages = async () => {
      const msgs = await base44.entities.ChatMessage.filter(
        { conversation_id: conversation.id },
        "created_date",
        200
      );
      setMessages(msgs);
      // Mark as read
      if (conversation.unread_count > 0) {
        await base44.entities.ChatConversation.update(conversation.id, { unread_count: 0 });
        onConversationUpdate?.();
      }
    };
    loadMessages();
  }, [conversation?.id]);

  // Subscribe to new messages
  useEffect(() => {
    if (!conversation) return;
    const unsubscribe = base44.entities.ChatMessage.subscribe((event) => {
      if (event.data?.conversation_id === conversation.id && event.type === "create") {
        setMessages((prev) => {
          if (prev.find((m) => m.id === event.data.id)) return prev;
          return [...prev, event.data];
        });
        // Auto-mark as read for agent
        if (event.data.sender_type === "visitor") {
          base44.entities.ChatConversation.update(conversation.id, { unread_count: 0 });
        }
      }
    });
    return unsubscribe;
  }, [conversation?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    const content = text.trim();
    setText("");
    await base44.entities.ChatMessage.create({
      conversation_id: conversation.id,
      sender_type: "agent",
      sender_name: "Support",
      content,
      read: false,
    });
    await base44.entities.ChatConversation.update(conversation.id, {
      last_message: content,
    });
    onConversationUpdate?.();
    setSending(false);
  };

  const handleClose = async () => {
    await base44.entities.ChatConversation.update(conversation.id, { status: "closed" });
    onConversationUpdate?.();
  };

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
        <MessageCircle className="h-12 w-12 stroke-1 mb-3" />
        <p className="font-medium text-sm">Select a conversation</p>
        <p className="text-xs mt-1">Choose a chat from the left to start responding</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-100 px-5 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-semibold">
            {conversation.visitor_name?.[0]?.toUpperCase() || <User className="h-4 w-4" />}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{conversation.visitor_name}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              {conversation.visitor_dob && (
                <p className="text-[11px] text-gray-400">DOB: {conversation.visitor_dob}</p>
              )}
              {conversation.visitor_postcode && (
                <p className="text-[11px] text-gray-400">Postcode: {conversation.visitor_postcode}</p>
              )}
            </div>
          </div>
        </div>
        {conversation.status === "active" && (
          <Button variant="outline" size="sm" className="text-xs gap-1.5 h-8 text-gray-500" onClick={handleClose}>
            <XCircle className="h-3.5 w-3.5" /> Close
          </Button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {messages.map((msg) => {
          const isAgent = msg.sender_type === "agent";
          return (
            <div key={msg.id} className={cn("flex", isAgent ? "justify-end" : "justify-start")}>
              <div className="max-w-[75%] space-y-1">
                <div
                  className={cn(
                    "px-3.5 py-2 rounded-2xl text-sm leading-relaxed",
                    isAgent
                      ? "bg-blue-600 text-white rounded-br-md"
                      : "bg-gray-100 text-gray-800 rounded-bl-md"
                  )}
                >
                  {msg.content}
                </div>
                <p className={cn("text-[10px] text-gray-400 px-1", isAgent && "text-right")}>
                  {msg.sender_name || (isAgent ? "Agent" : "Visitor")} · {msg.created_date ? format(new Date(msg.created_date), "h:mm a") : ""}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {conversation.status === "active" ? (
        <form onSubmit={handleSend} className="border-t border-gray-100 p-3 flex gap-2 shrink-0">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type your reply..."
            className="flex-1 text-sm px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!text.trim() || sending}
            className="h-9 w-9 rounded-lg bg-blue-600 hover:bg-blue-700 shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      ) : (
        <div className="border-t border-gray-100 px-5 py-3 text-center text-xs text-gray-400">
          This conversation has been closed
        </div>
      )}
    </div>
  );
}