"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CredibilityScore } from "../components/CredibilityScore";
import { Button } from "../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Candidate } from "../data/mockData";
import {
  ArrowLeft,
  AlertCircle,
  TrendingUp,
  Award,
  Shield,
  GraduationCap,
  Calendar,
  MapPin,
  ExternalLink,
  Upload,
  CheckCircle2,
  Loader2,
} from "lucide-react";

export function CandidateProfile() {
  const { id } = useParams<{ id: string }>();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanStatus, setScanStatus] = useState<"idle" | "uploading" | "complete" | "error">("idle");
  const [scanProgress, setScanProgress] = useState(0);
  const [scanError, setScanError] = useState("");
  const [scanResult, setScanResult] = useState<{ text: string; source: string; parsed: Record<string, unknown> } | null>(null);
  const [previousScans, setPreviousScans] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);
  const [profileUpdates, setProfileUpdates] = useState<Partial<Candidate>>({});

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/candidates/${id}`)
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json();
        return data.candidate as Candidate;
      })
      .then((c) => { setCandidate(c); setLoading(false); })
      .catch(() => { setLoading(false); });

    fetch(`/api/ocr/${id}`)
      .then(async (response) => response.ok ? (await response.json()).scans : null)
      .then((scans) => { if (Array.isArray(scans)) setPreviousScans(scans.map((scan: { filename: string }) => scan.filename)); })
      .catch(() => undefined);
  }, [id]);

  const uploadAffidavit = async (file: File) => {
    setScanStatus("uploading");
    setScanProgress(8);
    setScanError("");
    const form = new FormData();
    form.append("file", file);
    form.append("candidateId", id ?? "");
    const progressTimer = window.setInterval(() => setScanProgress((progress) => Math.min(progress + 8, 90)), 350);
    try {
      const response = await fetch("/api/ocr", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Scan failed");
      setScanResult(result);
      setPreviousScans((scans) => [file.name, ...scans]);
      setScanProgress(100);
      setScanStatus("complete");
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "Scan failed");
      setScanProgress(0);
      setScanStatus("error");
    } finally {
      window.clearInterval(progressTimer);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 w-32 bg-gray-200 rounded" />
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-gray-200 h-24 sm:h-32" />
          <div className="px-6 pb-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4 -mt-12 sm:-mt-16">
              <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-2xl bg-gray-200" />
              <div className="flex-1 space-y-2">
                <div className="h-6 bg-gray-200 rounded w-48" />
                <div className="h-4 bg-gray-200 rounded w-32" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!candidate) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">Candidate not found</p>
        <Link href="/">
          <Button className="mt-4">Go Home</Button>
        </Link>
      </div>
    );
  }

  const profile = { ...candidate, ...profileUpdates };

  const scoreBreakdown = [
    { label: "Criminal Risk", value: profile.criminalRisk, icon: Shield, color: "text-green-600" },
    { label: "Financial Transparency", value: profile.financialTransparency, icon: TrendingUp, color: "text-blue-600" },
    { label: "Performance", value: profile.performance, icon: Award, color: "text-purple-600" },
  ];

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Link href="/">
        <Button variant="ghost" className="gap-2 -ml-2">
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Button>
      </Link>

      {/* Profile Header */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-gradient-to-r from-[#1E3A8A] to-[#1E40AF] h-24 sm:h-32"></div>
        <div className="px-6 pb-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4 -mt-12 sm:-mt-16">
            <img
              src={profile.photo}
              alt={profile.name}
              className="w-24 h-24 sm:w-32 sm:h-32 rounded-2xl object-cover ring-4 ring-white shadow-lg"
            />
            <div className="flex-1">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{profile.name}</h1>
              <p className="text-base text-gray-600 mt-1">{profile.party}</p>
              <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-gray-600">
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4" />
                  <span>{profile.constituency}{profile.state ? `, ${profile.state}` : ""}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" />
                  <span>{profile.age} years old</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <GraduationCap className="w-4 h-4" />
                  <span>{profile.education}</span>
                </div>
              </div>
            </div>
            <Link href="/compare" className="w-full sm:w-auto">
              <Button className="w-full sm:w-auto bg-[#F59E0B] hover:bg-[#D97706]">
                Compare with Others
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Credibility Score Section */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6">Credibility Score</h2>
        <div className="flex flex-col sm:flex-row items-center gap-8">
          <div className="flex-shrink-0">
            <CredibilityScore score={profile.credibilityScore} size="lg" />
          </div>
          <div className="flex-1 w-full">
            <h3 className="font-semibold text-gray-900 mb-4">Score Breakdown</h3>
            <div className="space-y-4">
              {scoreBreakdown.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Icon className={`w-4 h-4 ${item.color}`} />
                        <span className="text-sm text-gray-700">{item.label}</span>
                      </div>
                      <span className="text-sm font-semibold text-gray-900">{item.value}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-500 ${
                          item.value >= 80 ? "bg-green-500" : item.value >= 60 ? "bg-yellow-500" : "bg-red-500"
                        }`}
                        style={{ width: `${item.value}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* AI Explanation */}
        <div className="mt-6 p-4 bg-blue-50 rounded-xl border border-blue-100">
          <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-600" />
            Why this score?
          </h4>
          <p className="text-sm text-gray-700 leading-relaxed">
            {profile.name} has a credibility score of {profile.credibilityScore} based on {
              profile.criminalCases === 0 ? "zero criminal cases" : `${profile.criminalCases} criminal case(s)`
            }, {profile.financialTransparency}% financial transparency, {profile.assets} in declared assets,
            and {profile.experience}.
          </p>
        </div>
      </div>

      {/* Detailed Information Tabs */}
      <Tabs defaultValue="overview" className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <TabsList className="w-full justify-start border-b rounded-none bg-transparent p-0">
          <TabsTrigger value="overview" className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-blue-600">
            Overview
          </TabsTrigger>
          <TabsTrigger value="criminal" className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-blue-600">
            Criminal Cases
          </TabsTrigger>
          <TabsTrigger value="assets" className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-blue-600">
            Assets
          </TabsTrigger>
          <TabsTrigger value="scan" className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-blue-600">
            Affidavit Scan
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="p-6 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InfoCard icon={AlertCircle} label="Criminal Cases" value={profile.criminalCases.toString()} />
            <InfoCard icon={TrendingUp} label="Total Assets" value={profile.assets} />
            <InfoCard icon={GraduationCap} label="Education" value={profile.education} />
            <InfoCard icon={Award} label="Experience" value={profile.experience} />
          </div>
        </TabsContent>

        <TabsContent value="criminal" className="p-6">
          {profile.criminalCases === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Shield className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="font-semibold text-lg text-gray-900 mb-2">No Criminal Cases</h3>
              <p className="text-gray-600">This candidate has a clean record with no pending or past criminal cases.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-gray-900">{profile.criminalCases} Pending Case(s)</h4>
                    <p className="text-sm text-gray-700 mt-1">
                      Details available from Election Commission affidavit
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="assets" className="p-6">
          <div className="space-y-4">
            <div className="p-4 bg-gray-50 rounded-xl">
              <h4 className="font-semibold text-gray-900 mb-3">Asset Declaration</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Declared Assets</span>
                  <span className="font-semibold text-gray-900">{profile.assets}</span>
                </div>
                {profile.liabilities && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total Liabilities</span>
                    <span className="font-semibold text-gray-900">{profile.liabilities}</span>
                  </div>
                )}
              </div>
            </div>
            <a
              href="#"
              className="flex items-center justify-between p-4 border-2 border-gray-200 rounded-xl hover:border-blue-300 transition-colors"
            >
              <span className="text-sm font-medium text-gray-700">View official affidavit</span>
              <ExternalLink className="w-4 h-4 text-gray-400" />
            </a>
          </div>
        </TabsContent>

        <TabsContent value="scan" className="p-6 space-y-5">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Scan candidate affidavit</h3>
            <p className="text-sm text-gray-600 mt-1">Upload a JPG, PNG, WEBP, TIFF, or searchable PDF. Your document is processed securely on the server.</p>
          </div>
          <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/50 p-8 cursor-pointer hover:bg-blue-50">
            {scanStatus === "uploading" ? <Loader2 className="w-8 h-8 text-blue-600 animate-spin" /> : <Upload className="w-8 h-8 text-blue-600" />}
            <span className="text-sm font-medium text-blue-900">{scanStatus === "uploading" ? "Scanning affidavit…" : "Choose affidavit file"}</span>
            <input type="file" className="sr-only" accept=".jpg,.jpeg,.png,.webp,.tif,.tiff,.pdf" disabled={scanStatus === "uploading"} onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadAffidavit(file);
            }} />
          </label>
          {scanStatus === "uploading" && <div aria-label="Upload progress" role="progressbar" aria-valuenow={scanProgress} className="h-2 w-full overflow-hidden rounded-full bg-blue-100"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${scanProgress}%` }} /></div>}
          {scanError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{scanError}</p>}
          {scanResult && (
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-3">
              <div className="flex items-center gap-2 font-semibold text-green-900"><CheckCircle2 className="w-5 h-5" /> Scan complete ({scanResult.source})</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                {Object.entries(scanResult.parsed).filter(([key, value]) => key !== "rawText" && value !== undefined).map(([key, value]) => (
                  <div key={key} className="rounded-lg bg-white/70 p-2"><span className="text-gray-500 capitalize">{key.replace(/([A-Z])/g, " $1")}: </span><strong>{String(value)}</strong></div>
                ))}
              </div>
              <Button onClick={() => {
                localStorage.setItem(`affidavit-scan-${id}`, JSON.stringify(scanResult));
                const parsed = scanResult.parsed;
                const updates = {
                  ...(parsed.age ? { age: Number(parsed.age) } : {}),
                  ...(parsed.education ? { education: String(parsed.education) } : {}),
                  ...(parsed.assets ? { assets: String(parsed.assets) } : {}),
                  ...(parsed.criminalCases !== undefined ? { criminalCases: Number(parsed.criminalCases) } : {}),
                };
                setProfileUpdates(updates);
                void fetch(`/api/ocr/${id}`, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(updates),
                }).catch(() => undefined);
                setApplied(true);
              }} className="bg-green-700 hover:bg-green-800">
                {applied ? "Updates applied" : "Apply updates to profile"}
              </Button>
            </div>
          )}
          <div>
            <h4 className="font-semibold text-gray-900 mb-2">Previous scans</h4>
            {previousScans.length ? <ul className="space-y-2 text-sm text-gray-600">{previousScans.map((name, index) => <li key={`${name}-${index}`} className="flex justify-between rounded-lg bg-gray-50 p-3"><span>{name}</span><span>Completed</span></li>)}</ul> : <p className="text-sm text-gray-500">No scans for this candidate yet.</p>}
          </div>
        </TabsContent>
      </Tabs>

      {/* Source Attribution */}
      <div className="bg-gray-50 rounded-xl p-4 text-center">
        <p className="text-xs text-gray-600">
          Data sourced from Election Commission of India (ECI) & PRS Legislative Research
        </p>
      </div>
    </div>
  );
}

function InfoCard({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="p-4 bg-gray-50 rounded-xl">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-gray-600" />
        <span className="text-sm text-gray-600">{label}</span>
      </div>
      <p className="text-lg font-semibold text-gray-900">{value}</p>
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
