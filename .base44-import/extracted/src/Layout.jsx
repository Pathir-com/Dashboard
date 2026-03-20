import React from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { MessageCircle, Settings } from "lucide-react";

export default function Layout({ children, currentPageName }) {
  // Widget page gets no chrome — it's meant to be embedded
  if (currentPageName === "ChatWidget") {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-100 px-6 py-2.5 flex items-center gap-4">
        <Link
          to={createPageUrl("ChatDashboard")}
          className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors px-3 py-1.5 rounded-lg hover:bg-blue-50"
        >
          <MessageCircle className="h-4 w-4" />
          Dashboard
        </Link>
        <Link
          to={createPageUrl("ChatWidget")}
          className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors px-3 py-1.5 rounded-lg hover:bg-blue-50"
        >
          <Settings className="h-4 w-4" />
          Widget Preview
        </Link>
      </nav>
      {children}
    </div>
  );
}