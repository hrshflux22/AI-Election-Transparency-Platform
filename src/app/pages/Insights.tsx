"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp, AlertCircle, Target, Filter, MapPin, Gavel, Wallet } from "lucide-react";
import { Button } from "../components/ui/button";

interface TopOffender {
  id: string;
  name: string;
  party: string;
  constituency: string;
  state: string;
  criminalCases: number;
  credibilityScore: number;
}

interface InsightsResponse {
  metrics: {
    total: number;
    avgCriminalCases: number;
    avgAssets: number;
    medianAssets: number;
    maxAssets: number;
    avgCredibility: number;
    avgCriminalRisk: number;
    avgFinancial: number;
    withCriminalCases: number;
    criminalCandidateShare: number;
    totalAssets: number;
    totalCriminalCases: number;
  };
  crimeByParty: { party: string; candidates: number; totalCases: number; withCases: number; avgCases: number }[];
  assetsByParty: { party: string; candidatess: number; avgAssets: number }[];
  credibilityDistribution: { name: string; value: number }[];
  topOffenders: TopOffender[];
  stateBreakdown: { state: string; candidates: number; totalCriminalCases: number; avgCredibility: number; candidatesWithCases: number }[];
}

const CHART_COLORS = ["#1E3A8A", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6", "#EC4899", "#06B6D4", "#F97316"];

export function Insights() {
  const [selectedState, setSelectedState] = useState("all");
  const [constituencies, setConstituencies] = useState<{ constituency: string; state: string; count: number }[]>([]);
  const [selectedConstituency, setSelectedConstituency] = useState("all");
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/constituencies?state=${selectedState}`)
      .then(async (res) => (res.ok ? res.json() : { constituencies: [] }))
      .then((d) => setConstituencies(d.constituencies || []))
      .catch(() => undefined);
  }, [selectedState]);

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (selectedState !== "all") params.set("state", selectedState);
    if (selectedConstituency !== "all") params.set("constituency", selectedConstituency);
    try {
      const res = await fetch(`/api/insights?${params}`);
      if (res.ok) setData(await res.json());
    } catch {
      // fallback
    } finally {
      setLoading(false);
    }
  }, [selectedState, selectedConstituency]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  const m = data?.metrics;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">Data Insights</h1>
        <p className="text-gray-600">
          Real analysis of {m ? m.total.toLocaleString() : "—"} candidates across Delhi &amp; Kerala
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-4 h-4 text-gray-600" />
          <span className="font-semibold text-gray-900">Filters</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">Region</label>
            <select
              value={selectedState}
              onChange={(e) => { setSelectedState(e.target.value); setSelectedConstituency("all"); }}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Regions</option>
              <option value="Delhi">Delhi</option>
              <option value="Kerala">Kerala</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">Constituency</label>
            <select
              value={selectedConstituency}
              onChange={(e) => setSelectedConstituency(e.target.value)}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Constituencies</option>
              {constituencies.map((c) => (
                <option key={c.constituency} value={c.constituency}>
                  {c.constituency} ({c.count})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading || !data || !m ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 animate-pulse">
              <div className="w-10 h-10 bg-gray-200 rounded-lg mb-3" />
              <div className="h-8 bg-gray-200 rounded mb-2" />
              <div className="h-4 bg-gray-200 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Key Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MetricCard
              icon={Gavel}
              label="Candidates with Criminal Cases"
              value={`${m.withCriminalCases} (${m.criminalCandidateShare}%)`}
              trend={`${m.avgCriminalCases} avg cases/candidate`}
              trendUp={m.avgCriminalCases === 0}
              color="bg-red-100 text-red-800"
            />
            <MetricCard
              icon={Wallet}
              label="Avg Declared Assets"
              value={`₹${m.avgAssets} Cr`}
              trend={`Median ₹${m.medianAssets} Cr · Max ₹${m.maxAssets} Cr`}
              trendUp={true}
              color="bg-blue-100 text-blue-800"
            />
            <MetricCard
              icon={Target}
              label="Avg Credibility Score"
              value={`${m.avgCredibility}/100`}
              trend={`Fin. Transparency ${m.avgFinancial}% · Criminal Risk ${m.avgCriminalRisk}%`}
              trendUp={m.avgCredibility >= 60}
              color="bg-green-100 text-green-800"
            />
          </div>

          {/* State Comparison */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6">Delhi vs Kerala Comparison</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {data.stateBreakdown.map((s) => (
                <div key={s.state} className="p-4 bg-gray-50 rounded-xl">
                  <div className="flex items-center gap-2 mb-3">
                    <MapPin className="w-4 h-4 text-gray-600" />
                    <h3 className="font-semibold text-gray-900">{s.state}</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-gray-500">Candidates</div>
                      <div className="text-lg font-semibold text-gray-900">{s.candidates}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">With Cases</div>
                      <div className="text-lg font-semibold text-gray-900">{s.candidatesWithCases}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Total Cases</div>
                      <div className="text-lg font-semibold text-gray-900">{s.totalCriminalCases}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Avg Credibility</div>
                      <div className="text-lg font-semibold text-gray-900">{s.avgCredibility}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Criminal Cases by Party */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6">Total Criminal Cases by Party</h2>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={data.crimeByParty}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="party" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "white", border: "1px solid #E5E7EB", borderRadius: "8px" }}
                  formatter={(value: number, name: string) => [value, name === "totalCases" ? "Total Cases" : name]}
                />
                <Legend />
                <Bar dataKey="totalCases" name="Total Cases" fill="#EF4444" radius={[8, 8, 0, 0]} />
                <Bar dataKey="withCases" name="Candidates w/ Cases" fill="#F59E0B" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-sm text-gray-600 mt-4 text-center">
              {data.crimeByParty[0]?.party || "N/A"} has the highest aggregate criminal case count
            </p>
          </div>

          {/* Avg Assets by Party */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6">Average Assets by Party (₹ Cr)</h2>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={data.assetsByParty}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="party" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "white", border: "1px solid #E5E7EB", borderRadius: "8px" }}
                  formatter={(value: number) => [`₹${value} Cr`, "Avg Assets"]}
                />
                <Bar dataKey="avgAssets" name="Avg Assets (₹ Cr)" fill="#1E3A8A" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Credibility Distribution */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6">Credibility Score Distribution</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={data.credibilityDistribution}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {data.credibilityDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col justify-center space-y-4">
                {data.credibilityDistribution.map((item, i) => (
                  <div key={item.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="text-gray-700">Score {item.name}</span>
                    </div>
                    <span className="font-semibold text-gray-900">{item.value} candidates</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Top Offenders */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 pb-0">
              <h2 className="text-xl font-bold text-gray-900">Candidates with Most Criminal Cases</h2>
              <p className="text-sm text-gray-600 mt-1">Highest pending criminal case counts in the selected dataset</p>
            </div>
            <div className="overflow-x-auto mt-4">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Party</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Constituency</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Cases</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Credibility</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data.topOffenders.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-500">No candidates with criminal cases in this selection</td></tr>
                  )}
                  {data.topOffenders.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link href={`/candidate/${c.id}`} className="text-sm font-medium text-blue-700 hover:underline">
                          {c.name}
                        </Link>
                        <div className="text-xs text-gray-500">{c.state}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{c.party}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{c.constituency}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex px-2 py-1 rounded-lg bg-red-100 text-red-800 text-sm font-bold">
                          {c.criminalCases}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-sm font-semibold text-gray-900">{c.credibilityScore}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Insights Summary */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-6 border-2 border-blue-200">
            <h3 className="font-semibold text-lg text-gray-900 mb-3">Key Insights</h3>
            <ul className="space-y-2 text-sm text-gray-700">
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">•</span>
                <span>
                  {m.withCriminalCases} of {m.total} candidates ({m.criminalCandidateShare}%) have pending criminal cases, averaging {m.avgCriminalCases} cases per candidate.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">•</span>
                <span>
                  Average declared assets stand at ₹{m.avgAssets} Cr, with a median of ₹{m.medianAssets} Cr and a maximum of ₹{m.maxAssets} Cr.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">•</span>
                <span>
                  {data.stateBreakdown.find((s) => s.state === "Kerala")?.totalCriminalCases ?? 0} of the total criminal cases are concentrated in Kerala.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">•</span>
                <span>
                  The average credibility score is {m.avgCredibility}/100 with average financial transparency of {m.avgFinancial}%.
                </span>
              </li>
            </ul>
          </div>
        </>
      )}

      {/* Data Sources */}
      <div className="bg-white rounded-xl p-6 border-2 border-gray-100">
        <h3 className="font-semibold text-gray-900 mb-3">Data Sources</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <DataSourceCard
            name="Election Commission of India"
            description="Official candidate affidavits and declarations (Form 26)"
          />
          <DataSourceCard
            name="Candidate Affidavit OCR"
            description="Extracted text from scanned candidate affidavits (247 processed)"
          />
          <DataSourceCard
            name="PRS Legislative Research"
            description="Parliamentary performance and voting records"
          />
          <DataSourceCard
            name="Government Databases"
            description="Verified asset and criminal record declarations"
          />
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  trend,
  trendUp,
  color,
}: {
  icon: any;
  label: string;
  value: string;
  trend: string;
  trendUp: boolean;
  color: string;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div className={`w-10 h-10 ${color} rounded-lg flex items-center justify-center mb-3`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="text-2xl font-bold text-gray-900 mb-1">{value}</div>
      <div className="text-sm text-gray-600 mb-2">{label}</div>
      <div className={`text-xs font-medium ${trendUp ? "text-green-600" : "text-red-600"}`}>{trend}</div>
    </div>
  );
}

function DataSourceCard({ name, description }: { name: string; description: string }) {
  return (
    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
      <h4 className="font-semibold text-sm text-gray-900 mb-1">{name}</h4>
      <p className="text-xs text-gray-600">{description}</p>
    </div>
  );
}
