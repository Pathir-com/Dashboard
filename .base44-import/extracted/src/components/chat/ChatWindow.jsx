import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { motion } from "framer-motion";
import { Minus, Send } from "lucide-react";
import ChatMessageList from "./ChatMessageList";
import ChatInput from "./ChatInput";
import InlineDetailsForm from "./InlineDetailsForm";

const POPPY_PHOTO = "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69b04cb7a1570d9772c3e08f/b36761f8c_profilephoto.png";

function getSessionId() {
  let id = localStorage.getItem("chat_session_id");
  if (!id) {
    id = "sess_" + Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem("chat_session_id", id);
  }
  return id;
}

// Stage: "intro" | "collecting_details" | "chatting"
export default function ChatWindow({ onMinimize, onUnread }) {
  const [stage, setStage] = useState("intro");
  const [pendingMessage, setPendingMessage] = useState("");
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [inputText, setInputText] = useState("");
  const sessionId = getSessionId();

  // Load existing conversation on mount
  useEffect(() => {
    const load = async () => {
      const convos = await base44.entities.ChatConversation.filter({ session_id: sessionId });
      if (convos.length > 0) {
        const convo = convos[0];
        setConversation(convo);
        setStage("chatting");
        const msgs = await base44.entities.ChatMessage.filter({ conversation_id: convo.id }, "created_date", 100);
        setMessages(msgs);
      }
    };
    load();
  }, [sessionId]);

  // Subscribe to new messages
  useEffect(() => {
    if (!conversation) return;
    const unsubscribe = base44.entities.ChatMessage.subscribe((event) => {
      if (event.data?.conversation_id === conversation.id && event.type === "create") {
        setMessages((prev) => {
          if (prev.find((m) => m.id === event.data.id)) return prev;
          return [...prev, event.data];
        });
        if (event.data.sender_type === "agent") {
          onUnread?.();
        }
      }
    });
    return unsubscribe;
  }, [conversation?.id]);

  // User types first message on intro screen → move to details form
  const handleIntroSend = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    setPendingMessage(inputText.trim());
    setInputText("");
    setStage("collecting_details");
  };

  // Details submitted → create conversation + send pending message
  const handleDetailsSubmit = async ({ name, dob, postcode }) => {
    const convo = await base44.entities.ChatConversation.create({
      visitor_name: name,
      visitor_email: "",
      visitor_dob: dob,
      visitor_postcode: postcode,
      session_id: sessionId,
      status: "active",
      unread_count: 0,
      last_message: pendingMessage,
    });
    setConversation(convo);

    // Send the pending first message
    await base44.entities.ChatMessage.create({
      conversation_id: convo.id,
      sender_type: "visitor",
      sender_name: name,
      content: pendingMessage,
      read: false,
    });
    await base44.entities.ChatConversation.update(convo.id, {
      last_message: pendingMessage,
      unread_count: 1,
    });

    const msgs = await base44.entities.ChatMessage.filter({ conversation_id: convo.id }, "created_date", 100);
    setMessages(msgs);
    setStage("chatting");
  };

  const handleSend = async (content) => {
    if (!conversation) return;
    setSending(true);
    await base44.entities.ChatMessage.create({
      conversation_id: conversation.id,
      sender_type: "visitor",
      sender_name: conversation.visitor_name,
      content,
      read: false,
    });
    await base44.entities.ChatConversation.update(conversation.id, {
      last_message: content,
      unread_count: (conversation.unread_count || 0) + 1,
    });
    setSending(false);
  };

  const handleReset = () => {
    localStorage.removeItem("chat_session_id");
    setStage("intro");
    setConversation(null);
    setMessages([]);
    setPendingMessage("");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="fixed bottom-24 right-6 z-50 w-[360px] h-[580px] bg-white rounded-2xl shadow-2xl shadow-black/10 border border-gray-200 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-2.5">
          <img src={POPPY_PHOTO} alt="Poppy" className="h-9 w-9 rounded-full object-cover" />
          <div>
            <p className="text-sm font-semibold text-gray-900 leading-tight">Poppy</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onMinimize} className="p-1.5 hover:bg-gray-100 rounded-md transition-colors text-gray-400 hover:text-gray-600">
            <Minus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      {stage === "intro" && (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-5">
            {/* Poppy's greeting bubble */}
            <div className="flex items-start gap-2">
              <img src={POPPY_PHOTO} alt="Poppy" className="h-7 w-7 rounded-full object-cover shrink-0 mt-1" />
              <div className="bg-gray-100 rounded-2xl rounded-tl-md px-4 py-3 max-w-[80%]">
                <p className="text-sm text-gray-800 leading-relaxed">
                  Hi there 👋 I can help you book an appointment or answer any questions about treatments — just like our reception team. Type below to start!
                </p>
              </div>
            </div>
          </div>
          {/* Intro input */}
          <form onSubmit={handleIntroSend} className="border-t border-gray-100 pt-3 px-3 pb-2 flex flex-col gap-2 shrink-0">
            <div className="flex gap-2 items-center">
              <input
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="type here.."
                className="flex-1 text-sm px-4 py-2.5 rounded-full border border-gray-200 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors bg-gray-50"
              />
              <button
                type="submit"
                disabled={!inputText.trim()}
                className="h-9 w-9 rounded-full bg-gray-200 hover:bg-blue-600 hover:text-white disabled:opacity-40 flex items-center justify-center text-gray-600 transition-colors shrink-0"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="text-center text-[10px] text-gray-400 w-full px-2">
              By speaking with Poppy, you agree to{" "}
              <a href="https://pathir.com/legal-pages/terms-conditions" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600 transition-colors">
                Pathir's Terms
              </a>
            </p>
          </form>
        </>
      )}

      {stage === "collecting_details" && (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {/* Show the user's first message */}
            <div className="flex justify-end mb-3">
              <div className="bg-blue-600 text-white rounded-2xl rounded-br-md px-3.5 py-2 text-sm max-w-[75%]">
                {pendingMessage}
              </div>
            </div>
            {/* Inline details form */}
            <InlineDetailsForm onSubmit={handleDetailsSubmit} />
          </div>
          <div className="border-t border-gray-100 px-3 pb-2 pt-2 shrink-0">
            <p className="text-center text-[10px] text-gray-400">
              By speaking with Poppy, you agree to{" "}
              <a href="https://pathir.com/legal-pages/terms-conditions" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600">
                Pathir's Terms
              </a>
            </p>
          </div>
        </>
      )}

      {stage === "chatting" && (
        <>
          <ChatMessageList messages={messages} />
          <ChatInput onSend={handleSend} disabled={sending} />
        </>
      )}
    </motion.div>
  );
}