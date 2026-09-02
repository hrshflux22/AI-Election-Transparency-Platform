"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Search, MapPin, Filter, TrendingUp, Shield, Users } from "lucide-react";
import { CandidateCard } from "../components/CandidateCard";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { Candidate } from "../data/mockData";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";

export function Home() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<string | null>(null);
  const [selectedState, setSelectedState] = useState<string>("all");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);

  const filters = [
    { id: "criminal", label: "No Criminal Cases", icon: Shield },
    { id: "assets", label: "High Assets", icon: TrendingUp },
    { id: "experience", label: "Experienced", icon: Users },
  ];

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set("q", searchQuery);
      if (selectedState !== "all") params.set("state", selectedState);
      params.set("limit", "300");
      const res = await fetch(`/api/candidates?${params}`);
      if (res.ok) {
        const data = await res.json();
        let filtered = data.candidates as Candidate[];
        if (selectedFilter === "criminal") filtered = filtered.filter((c: Candidate) => c.criminalCases === 0);
        else if (selectedFilter === "assets") filtered = filtered.filter((c: Candidate) => parseFloat(c.assets.replace(/[₹Cr Lakh]/g, "")) > 50);
        else if (selectedFilter === "experience") filtered = filtered.filter((c: Candidate) => parseInt(c.experience) >= 10);
        setCandidates(filtered);
      }
    } catch {
      // graceful fallback
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedState, selectedFilter]);

  useEffect(() => {
    const timer = setTimeout(fetchCandidates, searchQuery ? 300 : 0);
    return () => clearTimeout(timer);
  }, [fetchCandidates, searchQuery]);

  const featuredCandidates = candidates.slice(0, 6);
  const topCandidates = [...candidates].sort((a, b) => b.credibilityScore - a.credibilityScore).slice(0, 6);

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-2xl sm:rounded-3xl p-6 sm:p-8 text-white shadow-xl">
        <h2 className="text-2xl sm:text-3xl font-bold mb-2">Know Your Candidates</h2>
        <p className="text-blue-100 text-sm sm:text-base mb-6">
          AI-powered transparency for 248 candidates across Delhi &amp; Kerala
        </p>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <Input
            type="text"
            placeholder="Search candidate, party, or constituency..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-12 pr-4 py-6 text-base bg-white text-gray-900 border-0 rounded-xl shadow-lg"
          />
        </div>

        {/* State Selector */}
        <div className="mt-4 flex items-center gap-3">
          <MapPin className="w-4 h-4 text-blue-200" />
          <div className="flex gap-2">
            {[
              { id: "all", label: "All Regions" },
              { id: "Delhi", label: "Delhi" },
              { id: "Kerala", label: "Kerala" },
            ].map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedState(s.id)}
                className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                  selectedState === s.id
                    ? "bg-white text-blue-800"
                    : "bg-blue-700/50 text-blue-100 hover:bg-blue-700"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <span className="text-sm text-blue-200 ml-auto">{candidates.length} candidates</span>
        </div>
      </div>

      {/* Quick Filters */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Quick Filters</h3>
        <div className="flex flex-wrap gap-2">
          {filters.map((filter) => {
            const Icon = filter.icon;
            return (
              <button
                key={filter.id}
                onClick={() => setSelectedFilter(selectedFilter === filter.id ? null : filter.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 transition-all ${
                  selectedFilter === filter.id
                    ? "bg-blue-600 text-white border-blue-600 shadow-md"
                    : "bg-white text-gray-700 border-gray-200 hover:border-blue-300"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm font-medium">{filter.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* AI Summary Section */}
      <div className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-2xl p-6 border-2 border-orange-200">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 bg-[#F59E0B] rounded-xl flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-lg text-gray-900">AI Insights</h3>
            <p className="text-sm text-gray-600 mt-1">
              {selectedState === "all" ? "248 candidates across Delhi & Kerala" : `${candidates.length} candidates in ${selectedState}`}
            </p>
          </div>
        </div>
        <div className="bg-white/80 backdrop-blur rounded-xl p-4 mb-4">
          <p className="text-sm text-gray-700 leading-relaxed">
            Data sourced from Election Commission of India (ECI) affidavits for Delhi and Kerala assembly constituencies.
            Credibility scores are calculated using criminal record analysis, financial transparency, asset declarations,
            education levels, and age profiles. All {candidates.length} candidates{selectedState !== "all" ? ` in ${selectedState}` : ""} are ranked by their composite credibility score.
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/compare" className="flex-1">
            <Button className="w-full bg-[#F59E0B] hover:bg-[#D97706] text-white shadow-md">
              <Users className="w-4 h-4 mr-2" />
              Compare Candidates
            </Button>
          </Link>
          <Link href="/chat" className="flex-1">
            <Button variant="outline" className="w-full border-2 border-orange-300 hover:bg-orange-50">
              Ask AI
            </Button>
          </Link>
        </div>
      </div>

      {/* Featured Candidates */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">
            {selectedState === "all" ? "Featured Candidates" : `Candidates in ${selectedState}`}
          </h3>
          <Badge variant="secondary" className="bg-blue-100 text-blue-800">
            {selectedState === "all" ? "All Regions" : selectedState}
          </Badge>
        </div>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 animate-pulse">
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 rounded-full bg-gray-200" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-200 rounded w-3/4" />
                    <div className="h-3 bg-gray-200 rounded w-1/2" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {featuredCandidates.map((candidate, index) => (
              <CandidateCard key={candidate.id} candidate={candidate} featured={index === 0} />
            ))}
          </div>
        )}
      </div>

      {/* Top Rated Candidates */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Top Rated Candidates</h3>
          <Link href="/compare" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
            Compare All
          </Link>
        </div>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 animate-pulse">
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 rounded-full bg-gray-200" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-200 rounded w-3/4" />
                    <div className="h-3 bg-gray-200 rounded w-1/2" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {topCandidates.map((candidate) => (
              <CandidateCard key={candidate.id} candidate={candidate} />
            ))}
          </div>
        )}
      </div>

      {/* Trust Badge */}
      <div className="bg-white rounded-xl p-6 border-2 border-gray-100 text-center">
        <div className="mb-3 flex justify-center">
          <VerifiedBadge />
        </div>
        <p className="text-sm text-gray-600">
          All information sourced from Election Commission of India (ECI), PRS Legislative Research, and official government databases
        </p>
      </div>
    </div>
  );
}

function Sparkles({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" />
    </svg>
  );
}
