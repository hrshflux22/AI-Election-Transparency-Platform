"use client";
import { useState, useEffect } from "react";
import { CredibilityScore } from "../components/CredibilityScore";
import { Button } from "../components/ui/button";
import { Candidate } from "../data/mockData";
import {
  AlertCircle,
  TrendingUp,
  GraduationCap,
  Award,
  ChevronDown,
  Trophy,
  MapPin,
} from "lucide-react";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

export function Comparison() {
  const [allCandidates, setAllCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([]);
  const [showSelector, setShowSelector] = useState(false);
  const [filterState, setFilterState] = useState<string>("all");
  const [filterConstituency, setFilterConstituency] = useState<string>("");
  const [constituencies, setConstituencies] = useState<{ constituency: string; state: string; count: number }[]>([]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterState !== "all") params.set("state", filterState);
    if (filterConstituency) params.set("constituency", filterConstituency);
    params.set("limit", "300");
    fetch(`/api/candidates?${params}`)
      .then(async (res) => {
        if (!res.ok) return { candidates: [] };
        return res.json();
      })
      .then((data) => {
        setAllCandidates(data.candidates || []);
        setLoading(false);
      })
      .catch(() => { setLoading(false); });
  }, [filterState, filterConstituency]);

  useEffect(() => {
    fetch(`/api/constituencies?state=${filterState}`)
      .then(async (res) => res.ok ? res.json() : { constituencies: [] })
      .then((data) => setConstituencies(data.constituencies || []))
      .catch(() => undefined);
  }, [filterState]);

  useEffect(() => {
    if (allCandidates.length > 0 && selectedCandidates.length === 0) {
      const top3 = allCandidates.slice(0, 3).map(c => c.id);
      setSelectedCandidates(top3);
    }
  }, [allCandidates, selectedCandidates.length]);

  const comparedCandidates = allCandidates.filter((c) => selectedCandidates.includes(c.id));

  const radarData = [
    {
      metric: "Criminal Risk",
      ...comparedCandidates.reduce((acc, c) => ({ ...acc, [c.name]: c.criminalRisk }), {}),
    },
    {
      metric: "Financial",
      ...comparedCandidates.reduce((acc, c) => ({ ...acc, [c.name]: c.financialTransparency }), {}),
    },
    {
      metric: "Performance",
      ...comparedCandidates.reduce((acc, c) => ({ ...acc, [c.name]: c.performance }), {}),
    },
  ];

  const barData = comparedCandidates.map((c) => ({
    name: c.name.length > 12 ? c.name.slice(0, 12) + "…" : c.name,
    "Criminal Cases": c.criminalCases,
    Score: c.credibilityScore,
  }));

  const colors = ["#1E3A8A", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6", "#EC4899"];

  const bestCandidate = [...comparedCandidates].sort((a, b) => b.credibilityScore - a.credibilityScore)[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">Compare Candidates</h1>
        <p className="text-gray-600">Side-by-side comparison of candidates across Delhi &amp; Kerala</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <MapPin className="w-4 h-4" />
          <span className="font-medium">Filter by region</span>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex gap-2">
            {["all", "Delhi", "Kerala"].map((s) => (
              <button
                key={s}
                onClick={() => { setFilterState(s); setFilterConstituency(""); setSelectedCandidates([]); }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filterState === s
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {s === "all" ? "All Regions" : s}
              </button>
            ))}
          </div>
          <select
            value={filterConstituency}
            onChange={(e) => { setFilterConstituency(e.target.value); setSelectedCandidates([]); }}
            className="px-3 py-1.5 rounded-lg text-sm border border-gray-200 bg-white"
          >
            <option value="">All Constituencies</option>
            {constituencies.map((c) => (
              <option key={c.constituency} value={c.constituency}>
                {c.constituency} ({c.count})
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-gray-500">{allCandidates.length} candidates available</p>
      </div>

      {/* Candidate Selector */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <button
          onClick={() => setShowSelector(!showSelector)}
          className="flex items-center justify-between w-full"
        >
          <span className="font-semibold text-gray-900">
            Selected Candidates ({comparedCandidates.length})
          </span>
          <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${showSelector ? "rotate-180" : ""}`} />
        </button>
        {showSelector && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-80 overflow-y-auto">
            {loading ? (
              <p className="text-sm text-gray-500 col-span-2">Loading candidates...</p>
            ) : (
              allCandidates.slice(0, 50).map((candidate) => (
                <label
                  key={candidate.id}
                  className="flex items-center gap-3 p-3 border-2 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedCandidates.includes(candidate.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedCandidates([...selectedCandidates, candidate.id]);
                      } else {
                        setSelectedCandidates(selectedCandidates.filter((cid) => cid !== candidate.id));
                      }
                    }}
                    className="w-4 h-4 text-blue-600"
                  />
                  <img src={candidate.photo} alt={candidate.name} className="w-10 h-10 rounded-full" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{candidate.name}</p>
                    <p className="text-xs text-gray-500 truncate">{candidate.party} · {candidate.constituency}</p>
                  </div>
                </label>
              ))
            )}
          </div>
        )}
      </div>

      {comparedCandidates.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl shadow-sm border border-gray-100">
          <p className="text-gray-500">Select candidates to compare</p>
        </div>
      ) : (
        <>
          {/* Best Candidate Highlight */}
          {bestCandidate && (
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-6 border-2 border-green-200">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-green-500 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Trophy className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg text-gray-900 mb-1">Top Rated Candidate</h3>
                  <p className="text-gray-700">
                    <strong>{bestCandidate.name}</strong> has the highest credibility score of{" "}
                    <strong>{bestCandidate.credibilityScore}</strong> among selected candidates, with {bestCandidate.criminalCases} criminal cases
                    and {bestCandidate.assets} in declared assets.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Credibility Score Comparison */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6">Credibility Scores</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
              {comparedCandidates.map((candidate) => (
                <div key={candidate.id} className="text-center">
                  <img
                    src={candidate.photo}
                    alt={candidate.name}
                    className="w-16 h-16 rounded-full mx-auto mb-3 ring-4 ring-gray-100"
                  />
                  <h3 className="font-semibold text-sm text-gray-900 mb-1">{candidate.name}</h3>
                  <p className="text-xs text-gray-500 mb-2">{candidate.constituency}</p>
                  <CredibilityScore score={candidate.credibilityScore} size="sm" />
                </div>
              ))}
            </div>
          </div>

          {/* Radar Chart */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6">Performance Metrics</h2>
            <ResponsiveContainer width="100%" height={300}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="#E5E7EB" />
                <PolarAngleAxis dataKey="metric" tick={{ fontSize: 12 }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10 }} />
                {comparedCandidates.map((candidate, index) => (
                  <Radar
                    key={candidate.id}
                    name={candidate.name.split(" ")[0]}
                    dataKey={candidate.name}
                    stroke={colors[index % colors.length]}
                    fill={colors[index % colors.length]}
                    fillOpacity={0.2}
                  />
                ))}
                <Legend />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Bar Chart Comparison */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6">Key Metrics Comparison</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="Score" fill="#1E3A8A" radius={[8, 8, 0, 0]} />
                <Bar dataKey="Criminal Cases" fill="#EF4444" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Detailed Table */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Metric
                    </th>
                    {comparedCandidates.map((candidate) => (
                      <th
                        key={candidate.id}
                        className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider"
                      >
                        {candidate.name.length > 15 ? candidate.name.slice(0, 15) + "…" : candidate.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  <ComparisonRow
                    label="Credibility Score"
                    icon={Award}
                    values={comparedCandidates.map((c) => c.credibilityScore.toString())}
                    highlight
                  />
                  <ComparisonRow
                    label="Criminal Cases"
                    icon={AlertCircle}
                    values={comparedCandidates.map((c) => c.criminalCases.toString())}
                  />
                  <ComparisonRow
                    label="Assets"
                    icon={TrendingUp}
                    values={comparedCandidates.map((c) => c.assets)}
                  />
                  <ComparisonRow
                    label="Education"
                    icon={GraduationCap}
                    values={comparedCandidates.map((c) => c.education)}
                  />
                  <ComparisonRow
                    label="Age"
                    icon={Award}
                    values={comparedCandidates.map((c) => `${c.age} years`)}
                  />
                  <ComparisonRow
                    label="Constituency"
                    icon={MapPin}
                    values={comparedCandidates.map((c) => c.constituency)}
                  />
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ComparisonRow({
  label,
  icon: Icon,
  values,
  highlight = false,
}: {
  label: string;
  icon: any;
  values: string[];
  highlight?: boolean;
}) {
  return (
    <tr className={highlight ? "bg-blue-50" : ""}>
      <td className="px-4 py-4 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-gray-600" />
          <span className="text-sm font-medium text-gray-900">{label}</span>
        </div>
      </td>
      {values.map((value, index) => (
        <td key={index} className="px-4 py-4 text-center">
          <span className={`text-sm ${highlight ? "font-semibold text-blue-900" : "text-gray-700"}`}>
            {value}
          </span>
        </td>
      ))}
    </tr>
  );
}
