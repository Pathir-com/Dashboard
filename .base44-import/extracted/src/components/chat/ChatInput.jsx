import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";

export default function ChatInput({ onSend, disabled }) {
  const [text, setText] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText("");
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-gray-100 pt-3 px-3 pb-2 flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message..."
          disabled={disabled}
          className="flex-1 text-sm px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors disabled:opacity-50"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!text.trim() || disabled}
          className="h-9 w-9 rounded-lg bg-blue-600 hover:bg-blue-700 shrink-0"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-center text-[10px] text-gray-400 w-full px-2">
        By speaking with Poppy, you agree to{" "}
        <a
          href="https://pathir.com/legal-pages/terms-conditions"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-600 transition-colors"
        >
          Pathir's Terms
        </a>
      </p>
    </form>
  );
}