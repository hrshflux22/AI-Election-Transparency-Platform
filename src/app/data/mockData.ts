export interface Candidate {
  id: string;
  name: string;
  party: string;
  constituency: string;
  state?: string;
  photo: string;
  credibilityScore: number;
  criminalRisk: number;
  financialTransparency: number;
  performance: number;
  criminalCases: number;
  assets: string;
  liabilities?: string;
  education: string;
  age: number;
  experience: string;
}

export interface Promise {
  id: string;
  candidateId: string;
  candidateName: string;
  title: string;
  description: string;
  status: "completed" | "in-progress" | "not-done";
  date: string;
  evidence?: string;
}

export const promises: Promise[] = [
  {
    id: "1",
    candidateId: "1",
    candidateName: "Rajesh Kumar",
    title: "Free WiFi in all public areas",
    description: "Install high-speed WiFi hotspots across 500 public locations in Mumbai North",
    status: "completed",
    date: "2023-06-15",
    evidence: "350 hotspots installed, 150 more in progress",
  },
  {
    id: "2",
    candidateId: "1",
    candidateName: "Rajesh Kumar",
    title: "24/7 water supply",
    description: "Ensure uninterrupted water supply to all households",
    status: "in-progress",
    date: "2023-01-10",
    evidence: "Infrastructure upgrade ongoing, 60% completion",
  },
  {
    id: "3",
    candidateId: "1",
    candidateName: "Rajesh Kumar",
    title: "Reduce unemployment by 30%",
    description: "Create job opportunities through skill development programs",
    status: "in-progress",
    date: "2023-03-20",
    evidence: "15% reduction achieved, training centers opened",
  },
  {
    id: "4",
    candidateId: "2",
    candidateName: "Priya Sharma",
    title: "Build 10 new schools",
    description: "Modern educational facilities in underserved areas",
    status: "completed",
    date: "2022-08-01",
    evidence: "12 schools built and operational",
  },
  {
    id: "5",
    candidateId: "2",
    candidateName: "Priya Sharma",
    title: "Improve public transport",
    description: "Add 200 new buses and metro connectivity",
    status: "not-done",
    date: "2022-11-15",
    evidence: "Only 50 buses added, metro delayed",
  },
  {
    id: "6",
    candidateId: "3",
    candidateName: "Amit Patel",
    title: "Healthcare centers in every ward",
    description: "Establish primary healthcare facilities within 2km radius",
    status: "in-progress",
    date: "2023-04-01",
    evidence: "8 out of 15 centers operational",
  },
];

export const insightData = {
  crimeByParty: [
    { party: "INC", cases: 45 },
    { party: "BJP", cases: 52 },
    { party: "AAP", cases: 28 },
    { party: "Others", cases: 35 },
  ],
  assetGrowth: [
    { year: "2019", amount: 250 },
    { year: "2020", amount: 280 },
    { year: "2021", amount: 320 },
    { year: "2022", amount: 380 },
    { year: "2023", amount: 420 },
  ],
  promiseCompletion: [
    { name: "Completed", value: 35, color: "#10B981" },
    { name: "In Progress", value: 45, color: "#F59E0B" },
    { name: "Not Done", value: 20, color: "#EF4444" },
  ],
};

export const chatMessages = [
  {
    id: "1",
    role: "assistant" as const,
    content: "Hello! I'm your election assistant. I can help you understand candidates, compare them, and answer questions about their records. How can I help you today?",
  },
];

export const suggestedPrompts = [
  "Best candidate near me",
  "Compare top 3 candidates",
  "Who has the cleanest record?",
  "Show promises made in my area",
];

export const languages = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "hi", name: "Hindi", nativeName: "हिंदी" },
  { code: "mr", name: "Marathi", nativeName: "मराठी" },
  { code: "bn", name: "Bengali", nativeName: "বাংলা" },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்" },
  { code: "te", name: "Telugu", nativeName: "తెలుగు" },
];
