import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Search } from "lucide-react";
import ConversationList from "@/components/dashboard/ConversationList";
import AgentChatPanel from "@/components/dashboard/AgentChatPanel";

export default function ChatDashboard() {
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => base44.entities.ChatConversation.list("-updated_date", 100),
    refetchInterval: 5000,
  });

  // Subscribe to conversation updates
  useEffect(() => {
    const unsubscribe = base44.entities.ChatConversation.subscribe((event) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (event.type === "update" && selected?.id === event.data?.id) {
        setSelected(event.data);
      }
    });
    return unsubscribe;
  }, [selected?.id]);

  const filtered = conversations.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.visitor_name?.toLowerCase().includes(q) ||
      c.visitor_email?.toLowerCase().includes(q) ||
      c.last_message?.toLowerCase().includes(q)
    );
  });

  const totalUnread = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);

  return (
    <div className="h-screen bg-white flex flex-col">
      {/* Top bar */}
      <div className="border-b border-gray-100 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-blue-600 flex items-center justify-center">
            <MessageCircle className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900 tracking-tight">Chat Dashboard</h1>
            <p className="text-xs text-gray-400">
              {conversations.length} conversation{conversations.length !== 1 ? "s" : ""}
              {totalUnread > 0 && (
                <span className="ml-1 text-blue-600 font-medium">· {totalUnread} unread</span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-80 border-r border-gray-100 flex flex-col shrink-0">
          <div className="p-3 border-b border-gray-50">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search conversations..."
                className="w-full text-sm pl-9 pr-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse flex gap-3">
                    <div className="h-9 w-9 bg-gray-100 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 bg-gray-100 rounded w-24" />
                      <div className="h-2 bg-gray-50 rounded w-40" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <ConversationList
                conversations={filtered}
                selectedId={selected?.id}
                onSelect={setSelected}
              />
            )}
          </div>
        </div>

        {/* Chat panel */}
        <AgentChatPanel
          conversation={selected}
          onConversationUpdate={() =>
            queryClient.invalidateQueries({ queryKey: ["conversations"] })
          }
        />
      </div>
    </div>
  );
}