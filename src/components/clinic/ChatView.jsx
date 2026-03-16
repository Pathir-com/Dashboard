/**
 * Purpose:
 *   Chat dashboard showing web chat conversations handled by the AI agent
 *   (Poppy). Left panel lists conversations; right panel shows the selected
 *   conversation's transcript as chat bubbles.
 *
 * Dependencies:
 *   - @/lib/supabaseData (listWebChatConversations)
 *   - @tanstack/react-query (data fetching + caching)
 *   - date-fns (relative timestamps, date formatting)
 *   - lucide-react (icons)
 *
 * Used by:
 *   - src/pages/Clinic.jsx (rendered when currentView === 'chat')
 *
 * Changes:
 *   2026-03-16: Initial creation — read-only web chat conversation viewer.
 */

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Clock, User } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { listWebChatConversations } from '@/lib/supabaseData';

/* ------------------------------------------------------------------ */
/*  Status badge configuration                                        */
/* ------------------------------------------------------------------ */

const STATUS_STYLES = {
  completed: { label: 'Completed', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  active:    { label: 'Active',    bg: 'bg-blue-100',    text: 'text-blue-700'    },
  missed:    { label: 'Missed',    bg: 'bg-amber-100',   text: 'text-amber-700'   },
  failed:    { label: 'Failed',    bg: 'bg-red-100',     text: 'text-red-700'     },
};

function statusStyle(status) {
  return STATUS_STYLES[status] || { label: status || 'Unknown', bg: 'bg-slate-100', text: 'text-slate-600' };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Return a display name for a conversation, preferring contact over caller_name. */
function visitorName(conversation) {
  return conversation.contact?.name || conversation.caller_name || 'Website Visitor';
}

/** Truncate text to a maximum character length, appending ellipsis if needed. */
function truncate(text, maxLength) {
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

/** Format duration_seconds into a human-readable string. */
function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '--';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

/**
 * Parse the transcript field into an array of message objects.
 * Supports both array-of-objects and newline-delimited text formats.
 *
 * Normalised shape: { role: 'agent' | 'user', text: string, timestamp?: string }
 */
function parseTranscript(transcript) {
  if (!transcript) return [];

  // Already an array (structured transcript)
  if (Array.isArray(transcript)) {
    return transcript.map((msg) => ({
      role: normaliseRole(msg.role || msg.sender || msg.type),
      text: msg.text || msg.message || msg.content || '',
      timestamp: msg.timestamp || msg.time || null,
    }));
  }

  // JSON string of an array
  if (typeof transcript === 'string' && transcript.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(transcript);
      if (Array.isArray(parsed)) return parseTranscript(parsed);
    } catch {
      /* fall through to plain-text parsing */
    }
  }

  // Plain-text: split on newlines, attempt to detect role prefixes
  if (typeof transcript === 'string') {
    return transcript
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const agentMatch = line.match(/^(agent|assistant|poppy|bot)\s*:\s*/i);
        if (agentMatch) {
          return { role: 'agent', text: line.slice(agentMatch[0].length).trim() };
        }
        const userMatch = line.match(/^(user|patient|visitor|caller)\s*:\s*/i);
        if (userMatch) {
          return { role: 'user', text: line.slice(userMatch[0].length).trim() };
        }
        // Default to agent if we cannot determine the role
        return { role: 'agent', text: line.trim() };
      });
  }

  return [];
}

function normaliseRole(role) {
  if (!role) return 'agent';
  const lower = role.toLowerCase();
  if (['user', 'patient', 'visitor', 'caller', 'human'].includes(lower)) return 'user';
  return 'agent';
}

/* ------------------------------------------------------------------ */
/*  Glass card style (shared across the app)                          */
/* ------------------------------------------------------------------ */

const glassStyle = {
  backgroundColor: 'rgba(255, 255, 255, 0.6)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
};

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }) {
  const s = statusStyle(status);
  return (
    <span className={`inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function ConversationRow({ conversation, isSelected, onSelect }) {
  const name = visitorName(conversation);
  const timeAgo = conversation.started_at
    ? formatDistanceToNow(new Date(conversation.started_at), { addSuffix: true })
    : '';

  return (
    <button
      onClick={() => onSelect(conversation)}
      className={`
        w-full text-left rounded-xl px-3.5 py-3 transition-all
        ${isSelected
          ? 'bg-slate-900 text-white shadow-md'
          : 'hover:bg-white/80 text-slate-700'
        }
      `}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`
            w-7 h-7 rounded-full flex items-center justify-center shrink-0
            ${isSelected ? 'bg-white/20' : 'bg-slate-100'}
          `}>
            <User className={`w-3.5 h-3.5 ${isSelected ? 'text-white/70' : 'text-slate-400'}`} />
          </div>
          <span className={`text-sm font-medium truncate ${isSelected ? 'text-white' : 'text-slate-800'}`}>
            {name}
          </span>
        </div>
        <StatusBadge status={conversation.status} />
      </div>

      {conversation.summary && (
        <p className={`text-xs leading-relaxed mt-1 ${isSelected ? 'text-white/60' : 'text-slate-400'}`}>
          {truncate(conversation.summary, 80)}
        </p>
      )}

      <div className={`flex items-center gap-1 mt-1.5 text-[10px] ${isSelected ? 'text-white/40' : 'text-slate-300'}`}>
        <Clock className="w-3 h-3" />
        <span>{timeAgo}</span>
      </div>
    </button>
  );
}

function TranscriptBubble({ message }) {
  const isAgent = message.role === 'agent';

  return (
    <div className={`flex ${isAgent ? 'justify-start' : 'justify-end'} mb-3`}>
      <div
        className={`
          max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed
          ${isAgent
            ? 'bg-white border border-slate-100 text-slate-700 rounded-bl-md'
            : 'bg-slate-800 text-white rounded-br-md'
          }
        `}
      >
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
        {message.timestamp && (
          <p className={`text-[10px] mt-1 ${isAgent ? 'text-slate-300' : 'text-white/40'}`}>
            {message.timestamp}
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function ChatView({ practice }) {
  const [selectedId, setSelectedId] = useState(null);
  const practiceId = practice?.id;

  // ---- Data fetching ----
  const {
    data: conversations = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['web-chat-conversations', practiceId],
    queryFn: () => listWebChatConversations(practiceId),
    enabled: !!practiceId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  // ---- Derived state ----
  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) || null,
    [conversations, selectedId],
  );

  const messages = useMemo(() => (selected ? parseTranscript(selected.transcript) : []), [selected]);

  // ---- Handlers ----
  function handleSelect(conversation) {
    setSelectedId(conversation.id);
  }

  // ---- Render ----
  return (
    <div className="flex h-full overflow-hidden">
      {/* ===== Left panel: conversation list ===== */}
      <div
        className="w-80 shrink-0 border-r border-slate-100 flex flex-col overflow-hidden"
        style={glassStyle}
      >
        {/* Header */}
        <div className="px-5 pt-8 pb-4 shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <MessageCircle className="w-5 h-5 text-slate-700" />
            <h1 className="text-base font-semibold text-slate-900">Web Chat</h1>
          </div>
          <p className="text-xs text-slate-400">Conversations handled by Poppy</p>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-300">
              <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-500 rounded-full animate-spin mb-3" />
              <p className="text-xs">Loading conversations...</p>
            </div>
          )}

          {isError && (
            <div className="text-center py-16">
              <p className="text-xs text-red-400">Failed to load conversations.</p>
            </div>
          )}

          {!isLoading && !isError && conversations.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-300">
              <MessageCircle className="w-8 h-8 mb-3 text-slate-200" />
              <p className="text-sm font-medium text-slate-400">No conversations yet</p>
              <p className="text-xs text-slate-300 mt-1">
                Web chat conversations will appear here.
              </p>
            </div>
          )}

          {conversations.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              isSelected={selectedId === conversation.id}
              onSelect={handleSelect}
            />
          ))}
        </div>
      </div>

      {/* ===== Right panel: transcript viewer ===== */}
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
        {!selected ? (
          /* Empty state — no conversation selected */
          <div className="flex-1 flex flex-col items-center justify-center text-slate-300 px-6">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
              style={{ ...glassStyle, backgroundColor: 'rgba(255, 255, 255, 0.8)' }}
            >
              <MessageCircle className="w-7 h-7 text-slate-300" />
            </div>
            <p className="text-sm font-medium text-slate-400">Select a conversation</p>
            <p className="text-xs text-slate-300 mt-1">
              Choose a chat from the left to view the transcript.
            </p>
          </div>
        ) : (
          <>
            {/* Conversation header */}
            <div
              className="shrink-0 border-b border-slate-100 px-6 py-4"
              style={glassStyle}
            >
              {/* Read-only note */}
              <div className="flex items-center gap-1.5 mb-3">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                  Responses handled by Poppy
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center">
                    <User className="w-4 h-4 text-slate-400" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      {visitorName(selected)}
                    </h2>
                    <div className="flex items-center gap-3 mt-0.5 text-[11px] text-slate-400">
                      {selected.contact?.date_of_birth && (
                        <span>
                          DOB: {format(new Date(selected.contact.date_of_birth), 'd MMM yyyy')}
                        </span>
                      )}
                      {selected.contact?.postcode && (
                        <span>{selected.contact.postcode}</span>
                      )}
                      {selected.duration_seconds != null && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDuration(selected.duration_seconds)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <StatusBadge status={selected.status} />
              </div>
            </div>

            {/* Transcript messages */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-300">
                  <MessageCircle className="w-6 h-6 mb-2 text-slate-200" />
                  <p className="text-xs text-slate-400">No transcript available for this conversation.</p>
                </div>
              ) : (
                <div className="max-w-2xl mx-auto">
                  {/* Conversation start timestamp */}
                  {selected.started_at && (
                    <p className="text-center text-[10px] text-slate-300 mb-6">
                      {format(new Date(selected.started_at), 'EEEE, d MMMM yyyy · h:mm a')}
                    </p>
                  )}

                  {messages.map((msg, idx) => (
                    <TranscriptBubble key={idx} message={msg} />
                  ))}

                  {/* Conversation end marker */}
                  {selected.ended_at && (
                    <p className="text-center text-[10px] text-slate-300 mt-6">
                      Conversation ended {formatDistanceToNow(new Date(selected.ended_at), { addSuffix: true })}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Outcome / summary footer */}
            {(selected.outcome || selected.summary) && (
              <div
                className="shrink-0 border-t border-slate-100 px-6 py-3"
                style={glassStyle}
              >
                {selected.outcome && (
                  <p className="text-xs text-slate-500 mb-0.5">
                    <span className="font-medium text-slate-600">Outcome:</span>{' '}
                    <span className="capitalize">{selected.outcome}</span>
                  </p>
                )}
                {selected.summary && (
                  <p className="text-xs text-slate-400 leading-relaxed">{selected.summary}</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
