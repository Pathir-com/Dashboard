import React, { useState } from "react";
import { AnimatePresence } from "framer-motion";
import ChatBubble from "@/components/chat/ChatBubble";
import ChatWindow from "@/components/chat/ChatWindow";

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(true);
  const [unread, setUnread] = useState(0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
      <div className="text-center space-y-3 px-6">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Chat Widget Preview</h1>
        <p className="text-gray-500 text-sm max-w-md mx-auto">
          This is a preview of the chat widget. Click the blue bubble in the bottom-right corner to start a conversation.
        </p>
      </div>

      <AnimatePresence>
        {isOpen && (
          <ChatWindow
            onMinimize={() => setIsOpen(false)}
            onUnread={() => setUnread((u) => u + 1)}
          />
        )}
      </AnimatePresence>

      <ChatBubble
        isOpen={isOpen}
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) setUnread(0);
        }}
        unreadCount={unread}
      />
    </div>
  );
}