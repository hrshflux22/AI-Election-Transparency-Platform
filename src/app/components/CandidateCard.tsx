import Link from "next/link";
import { Candidate } from "../data/mockData";
import { Badge } from "./ui/badge";
import { AlertCircle, TrendingUp, Shield } from "lucide-react";

interface CandidateCardProps {
  candidate: Candidate;
  featured?: boolean;
}

export function CandidateCard({ candidate, featured = false }: CandidateCardProps) {
  const getScoreColor = (score: number) => {
    if (score >= 80) return "bg-green-100 text-green-800 border-green-200";
    if (score >= 60) return "bg-yellow-100 text-yellow-800 border-yellow-200";
    return "bg-red-100 text-red-800 border-red-200";
  };

  return (
    <Link href={`/candidate/${candidate.id}`}>
      <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-lg transition-shadow duration-300 ${featured ? "ring-2 ring-blue-500" : ""}`}>
        <div className="p-4 sm:p-6">
          <div className="flex items-start gap-4">
            <img
              src={candidate.photo}
              alt={candidate.name}
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover ring-4 ring-gray-100"
            />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-lg text-gray-900 truncate">{candidate.name}</h3>
              <p className="text-sm text-gray-600 mt-1">{candidate.party}</p>
              <p className="text-xs text-gray-500 mt-1">{candidate.constituency}</p>
            </div>
            <div className={`px-3 py-2 rounded-xl border-2 ${getScoreColor(candidate.credibilityScore)}`}>
              <div className="text-2xl font-bold text-center">{candidate.credibilityScore}</div>
              <div className="text-xs text-center">Score</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="text-center p-3 bg-gray-50 rounded-xl">
              <div className="flex items-center justify-center mb-1">
                <AlertCircle className="w-4 h-4 text-gray-600" />
              </div>
              <div className="text-xs text-gray-600">Cases</div>
              <div className="text-sm font-semibold text-gray-900 mt-1">{candidate.criminalCases}</div>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-xl">
              <div className="flex items-center justify-center mb-1">
                <TrendingUp className="w-4 h-4 text-gray-600" />
              </div>
              <div className="text-xs text-gray-600">Assets</div>
              <div className="text-sm font-semibold text-gray-900 mt-1">{candidate.assets}</div>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-xl">
              <div className="flex items-center justify-center mb-1">
                <Shield className="w-4 h-4 text-gray-600" />
              </div>
              <div className="text-xs text-gray-600">Trust</div>
              <div className="text-sm font-semibold text-gray-900 mt-1">{candidate.financialTransparency}%</div>
            </div>
          </div>

          {featured && (
            <div className="mt-4">
              <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Top Match</Badge>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
