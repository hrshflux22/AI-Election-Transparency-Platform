"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, MessageSquare, BarChart3, Globe } from "lucide-react";
import { useState } from "react";
import { languages } from "../data/mockData";

export function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [selectedLanguage, setSelectedLanguage] = useState("en");

  const navItems = [
    { path: "/", icon: Home, label: "Home" },
    { path: "/compare", icon: Users, label: "Compare" },
    { path: "/chat", icon: MessageSquare, label: "AI Assistant" },
    { path: "/insights", icon: BarChart3, label: "Insights" },
  ];

  const isActive = (path: string) => {
    if (path === "/") return pathname === "/";
    return pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20 sm:pb-0">
      {/* Top Header */}
      <header className="bg-gradient-to-r from-[#1E3A8A] to-[#1E40AF] text-white sticky top-0 z-40 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#F59E0B] rounded-xl flex items-center justify-center shadow-lg">
                <Shield className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold">Chunav Bodh</h1>
                <p className="text-xs text-blue-200">Election Transparency Platform</p>
              </div>
            </div>

            {/* Language Selector */}
            <div className="relative">
              <button className="flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors">
                <Globe className="w-4 h-4" />
                <span className="hidden sm:inline text-sm">
                  {languages.find((l) => l.code === selectedLanguage)?.nativeName}
                </span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6 sm:py-8">
        {children}
      </main>

      {/* Bottom Navigation - Mobile */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 sm:hidden z-50">
        <div className="grid grid-cols-5 gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`flex flex-col items-center justify-center py-3 px-2 transition-colors ${
                  active
                    ? "text-[#1E3A8A] bg-blue-50"
                    : "text-gray-600 hover:text-[#1E3A8A] hover:bg-gray-50"
                }`}
              >
                <Icon className="w-5 h-5 mb-1" />
                <span className="text-xs font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Desktop Sidebar Navigation */}
      <nav className="hidden sm:block fixed left-0 top-20 bottom-0 w-64 bg-white border-r border-gray-200 overflow-y-auto">
        <div className="p-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl mb-2 transition-colors ${
                  active
                    ? "bg-blue-50 text-[#1E3A8A] font-medium"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Desktop Content Padding */}
      <style>{`
        @media (min-width: 640px) {
          main {
            margin-left: 16rem;
          }
        }
      `}</style>
    </div>
  );
}

function Shield({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
