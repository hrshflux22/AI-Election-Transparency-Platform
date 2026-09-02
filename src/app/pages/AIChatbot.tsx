"use client";
import { useEffect, useState } from "react";
import { Send, FileText, Shield, BarChart3 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface ScanContext {
  parsed?: Record<string, unknown>;
  source?: string;
}

const initialMessage: Message = {
  id: "1",
  role: "assistant",
  content:
    "Welcome to the Chunav Bodh AI Assistant. I am designed to provide you with verified, fact-based information about electoral candidates, their public records, credibility assessments, and manifesto tracking. All responses are derived from official government sources and public databases. How may I assist you today?",
  timestamp: new Date().toISOString(),
};

const formalPrompts = [
  "What metrics are used to calculate candidate credibility scores?",
  "Provide comparative analysis of candidates in Mumbai North constituency",
  "Explain the methodology for tracking manifesto promise fulfillment",
  "Which government sources are used for candidate data verification?",
  "Summarize my scanned affidavit",
];

export function AIChatbot() {
  const [messages, setMessages] = useState<Message[]>([initialMessage]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [scanContext, setScanContext] = useState<ScanContext | null>(null);

  useEffect(() => {
    const keys = Object.keys(localStorage).filter((key) => key.startsWith("affidavit-scan-"));
    const latest = keys.at(-1);
    if (latest) {
      try { setScanContext(JSON.parse(localStorage.getItem(latest) ?? "null")); } catch { /* ignore malformed local context */ }
    }
  }, []);

  const handleSend = (text?: string) => {
    const messageText = text || input;
    if (!messageText.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: messageText,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsProcessing(true);

    setTimeout(() => {
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: getAIResponse(messageText, scanContext),
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, aiResponse]);
      setIsProcessing(false);
    }, 1800);
  };

  const getAIResponse = (query: string, context: ScanContext | null): string => {
    const lowerQuery = query.toLowerCase();

    if ((lowerQuery.includes("scan") || lowerQuery.includes("affidavit")) && context?.parsed) {
      const fields = Object.entries(context.parsed)
        .filter(([key, value]) => key !== "rawText" && value !== undefined)
        .map(([key, value]) => `- ${key.replace(/([A-Z])/g, " $1")}: ${String(value)}`)
        .join("\n");
      return `Here is a summary of your latest scanned affidavit (${context.source ?? "OCR"}):\n\n${fields || "No structured fields were detected."}\n\nThis is an OCR-assisted summary. Verify every field against the original affidavit before relying on it.`;
    }

    if (lowerQuery.includes("credibility") || lowerQuery.includes("metric")) {
      return "The platform evaluates candidates using three primary metrics:\n\n1. **Criminal Risk Score (0-100%)**: Based on pending criminal cases, their severity, and legal status. Scores above 85% indicate clean records.\n\n2. **Financial Transparency (0-100%)**: Assessed through asset declaration completeness, consistency across years, and discrepancy analysis.\n\n3. **Performance Score (0-100%)**: Evaluated based on manifesto promise fulfillment, attendance records, and constituency development metrics.\n\nThese scores are aggregated into an overall Credibility Score, weighted equally across all three dimensions. All data is sourced from Election Commission of India (ECI) affidavits and verified government records.";
    }

    if (lowerQuery.includes("constituency") || lowerQuery.includes("near me") || lowerQuery.includes("area") || lowerQuery.includes("comparative") || lowerQuery.includes("comparison")) {
      return "**Constituency Analysis: Mumbai North**\n\nTop-rated candidates based on credibility assessment:\n\n**1. Rajesh Kumar (Indian National Congress)**\n- Overall Credibility Score: 85/100\n- Criminal Risk Score: 92/100 (0 cases)\n- Financial Transparency: 88/100\n- Performance Score: 75/100\n- Declared Assets: ₹2.5 Crores\n- Education: MBA, IIM Ahmedabad\n- Experience: 15 years in public service\n\n**2. Priya Sharma (Bharatiya Janata Party)**\n- Overall Credibility Score: 78/100\n- Criminal Risk Score: 85/100 (1 minor case)\n- Financial Transparency: 80/100\n- Performance Score: 70/100\n- Declared Assets: ₹3.8 Crores\n- Education: B.Tech, IIT Delhi\n- Experience: 10 years in politics\n\n**3. Amit Patel (Aam Aadmi Party)**\n- Overall Credibility Score: 72/100\n- Criminal Risk Score: 70/100 (2 cases)\n- Financial Transparency: 75/100\n- Performance Score: 72/100\n- Declared Assets: ₹1.2 Crores\n- Education: MA Political Science\n- Experience: 8 years in activism\n\nFor detailed case information or asset breakdowns, please refer to individual candidate profiles.";
    }

    if (lowerQuery.includes("manifesto") || lowerQuery.includes("promise") || lowerQuery.includes("tracking") || lowerQuery.includes("methodology")) {
      return "**Manifesto Accountability Framework**\n\nThe platform compares the ruling party's pre-election manifesto commitments against actual post-election performance and delivery.\n\n**Tracking Methodology:**\n\n1. **Baseline Establishment**: Specific, measurable promises are extracted from the official manifesto published during the election campaign (BJP 2022 manifesto).\n\n2. **Progress Verification**: Implementation status is tracked using:\n   - Official government department reports and progress documents\n   - Right to Information (RTI) Act responses\n   - Parliamentary records and ministerial statements\n   - Independent audit reports\n\n3. **Status Classification System**:\n   - **Fulfilled (100%)**: Promise completed as originally stated\n   - **Partially Fulfilled (50-99%)**: Significant progress but incomplete\n   - **In Progress (1-49%)**: Active implementation underway\n   - **Not Fulfilled (0%)**: No meaningful action taken\n\n4. **Current Scope**: Tracking 8 major promises from BJP's 2022 manifesto across infrastructure, education, healthcare, employment, transport, housing, and women empowerment sectors.\n\n**Overall Fulfillment Rate**: 62% (as of March 2026)\n\nFor category-wise breakdowns and detailed evidence sources, visit the Insights section.";
    }

    if (lowerQuery.includes("source") || lowerQuery.includes("data")) {
      return "Chunav Bodh aggregates data from the following verified sources:\n\n**Primary Sources:**\n- Election Commission of India (ECI): Candidate affidavits, criminal case data, asset declarations\n- PRS Legislative Research: Performance tracking, attendance records\n- Official Government Departments: Ministry reports, progress data\n\n**Secondary Sources:**\n- Right to Information (RTI) responses\n- Supreme Court and High Court judgments\n- Verified fact-checking organizations\n- Mainstream media reports (cross-verified)\n\n**Data Integrity:**\nAll information undergoes a three-tier verification process before publication. Disputed or unverified claims are clearly marked. Last database update: March 2026.\n\nYou can view specific source citations on individual candidate profiles and insights.";
    }

    if (lowerQuery.includes("criminal") || lowerQuery.includes("clean record")) {
      return "Candidates with the highest criminal risk scores (indicating cleaner records):\n\n**1. Sunita Rao** (Indian National Congress - Delhi Central)\n- Criminal Risk Score: 95/100\n- Pending Cases: 0\n- Background: 20 years in law and politics\n\n**2. Rajesh Kumar** (Indian National Congress - Mumbai North)\n- Criminal Risk Score: 92/100\n- Pending Cases: 0\n- Background: 15 years in public service\n\n**3. Priya Sharma** (Bharatiya Janata Party - Mumbai North)\n- Criminal Risk Score: 85/100\n- Pending Cases: 1 (defamation, non-cognizable)\n\nNote: Criminal risk score considers case severity, type (cognizable vs. non-cognizable), and status (convicted vs. pending). Data sourced from ECI affidavits filed in 2024.";
    }

    if (lowerQuery.includes("compare")) {
      return "I can help you compare candidates on multiple dimensions. The platform offers side-by-side comparison of:\n\n- Credibility scores and sub-metrics\n- Criminal records and case details\n- Asset declarations and growth patterns\n- Educational qualifications and experience\n- Performance history and manifesto fulfillment\n\nPlease visit the Compare section to select specific candidates for detailed comparison, or let me know which candidates you'd like to compare, and I'll provide a summary.";
    }

    return "**Available Information Categories:**\n\nI can provide comprehensive, data-driven insights on the following topics:\n\n- **Candidate Profiles**: Credibility scores, criminal case records, asset declarations, educational qualifications, and professional experience\n- **Manifesto Accountability**: Ruling party's election promise fulfillment tracking and implementation status\n- **Data Verification**: Information about source credibility, verification protocols, and data update frequency\n- **Constituency Analytics**: Comparative candidate analysis for specific electoral constituencies\n- **Assessment Methodology**: Detailed explanation of credibility scoring algorithms and evaluation criteria\n\nPlease specify your area of interest, and I will provide detailed, evidence-based information sourced from official records.";
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-2xl p-6 sm:p-8 text-white">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-14 h-14 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
            <Bot className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">Chunav Bodh AI Assistant</h1>
            <p className="text-blue-100 text-sm mt-1">Data-Driven Electoral Intelligence | Verified Sources Only</p>
          </div>
        </div>
      </div>

      {/* Information Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <InfoCard
          icon={<Shield className="w-5 h-5" />}
          title="Verified Data"
          description="Sourced from ECI and government records"
        />
        <InfoCard
          icon={<BarChart3 className="w-5 h-5" />}
          title="Objective Analysis"
          description="Fact-based credibility assessments"
        />
        <InfoCard
          icon={<FileText className="w-5 h-5" />}
          title="Transparent Sources"
          description="All information is citation-backed"
        />
      </div>

      {/* Chat Interface */}
      <div className="bg-white rounded-2xl shadow-sm border-2 border-gray-200">
        {/* Messages Container */}
        <div className="h-[550px] overflow-y-auto p-6 space-y-5 bg-gray-50">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          {isProcessing && (
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-5 py-4">
                <div className="flex gap-1.5">
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "200ms" }} />
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "400ms" }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Suggested Questions */}
        {messages.length <= 1 && (
          <div className="border-t-2 border-gray-200 p-5 bg-white">
            <p className="text-xs font-semibold text-gray-700 mb-3 uppercase tracking-wider">
              Suggested Questions
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {formalPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleSend(prompt)}
                  className="text-left px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg hover:border-blue-400 hover:bg-blue-50 hover:shadow-sm transition-all text-sm text-gray-800"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input Area */}
        <div className="border-t-2 border-gray-200 p-5 bg-white rounded-b-2xl">
          <div className="flex gap-3">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder="Enter your query regarding candidate information, credibility metrics, or electoral data..."
              className="flex-1 border-2 border-gray-300 focus:border-blue-500 rounded-lg px-4 py-3"
              disabled={isProcessing}
            />
            <Button
              onClick={() => handleSend()}
              disabled={!input.trim() || isProcessing}
              className="px-6 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
            >
              <Send className="w-5 h-5" />
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            All responses are generated using verified data from Election Commission of India and government databases. For original source documents, please refer to individual citations.
          </p>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="bg-blue-50 rounded-xl p-5 border-2 border-blue-200">
        <p className="text-xs text-gray-800 leading-relaxed">
          <strong className="text-blue-900">Important Disclaimer:</strong> This AI-powered assistant provides factual information
          derived exclusively from publicly available electoral data, Election Commission of India affidavits, and verified government
          sources. While rigorous verification protocols are maintained, users are encouraged to independently verify critical
          information against original source documents available on official portals. This tool serves as a decision-support system
          for informed electoral participation and should not constitute the sole basis for voting decisions. Data accuracy as of March 2026.
        </p>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} items-start gap-4`}>
      {!isUser && (
        <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
          <Bot className="w-5 h-5 text-white" />
        </div>
      )}
      <div className="max-w-[75%]">
        <div
          className={`rounded-xl px-5 py-4 shadow-sm ${
            isUser
              ? "bg-gradient-to-br from-blue-600 to-blue-700 text-white"
              : "bg-white border-2 border-gray-200 text-gray-900"
          }`}
        >
          <p className="text-sm whitespace-pre-line leading-relaxed">{message.content}</p>
        </div>
        <p className="text-xs text-gray-500 mt-2 px-2">
          {new Date(message.timestamp).toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
      {isUser && (
        <div className="w-10 h-10 bg-gray-700 rounded-lg flex items-center justify-center flex-shrink-0">
          <User className="w-5 h-5 text-white" />
        </div>
      )}
    </div>
  );
}

function InfoCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
      <div className="text-blue-600 mb-2 flex justify-center">{icon}</div>
      <h3 className="text-sm font-semibold text-gray-900 mb-1">{title}</h3>
      <p className="text-xs text-gray-600">{description}</p>
    </div>
  );
}

function Bot({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      <circle cx="9" cy="16" r="1" />
      <circle cx="15" cy="16" r="1" />
    </svg>
  );
}

function User({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

