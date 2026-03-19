import React from 'react';
import { Inbox, Settings, CalendarDays, LogOut } from 'lucide-react';

export default function ClinicSidebar({ currentView, onNavigate, onLogout }) {
  return (
    <div className="w-14 shrink-0 min-h-screen bg-white border-r border-slate-100 flex flex-col items-center py-5 sticky top-0 h-screen z-10">
      {/* Logo */}
      <div className="mb-8">
        <img
          src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69598d89634866d811371736/596c9f930_squareblackbackground.png"
          alt="Pathir"
          className="h-8 w-8 rounded-lg"
        />
      </div>

      {/* Nav items */}
      <div className="flex-1 flex flex-col items-center gap-1">
        <button
          onClick={() => onNavigate('enquiries')}
          title="Enquiries"
          className={`p-2.5 rounded-lg transition-colors ${
            currentView === 'enquiries'
              ? 'bg-slate-900 text-white'
              : 'text-slate-400 hover:text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Inbox className="w-5 h-5" />
        </button>
        <button
          onClick={() => onNavigate('diary')}
          title="Diary"
          className={`p-2.5 rounded-lg transition-colors ${
            currentView === 'diary'
              ? 'bg-slate-900 text-white'
              : 'text-slate-400 hover:text-slate-700 hover:bg-slate-50'
          }`}
        >
          <CalendarDays className="w-5 h-5" />
        </button>
      </div>

      {/* Settings at bottom */}
      <div className="flex flex-col items-center gap-1">
        <button
          onClick={() => onNavigate('settings')}
          title="Settings"
          className={`p-2.5 rounded-lg transition-colors ${
            currentView === 'settings'
              ? 'bg-slate-900 text-white'
              : 'text-slate-400 hover:text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Settings className="w-5 h-5" />
        </button>
        {onLogout && (
          <button
            onClick={onLogout}
            title="Sign out"
            className="p-2.5 rounded-lg transition-colors text-slate-400 hover:text-red-500 hover:bg-red-50"
          >
            <LogOut className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}