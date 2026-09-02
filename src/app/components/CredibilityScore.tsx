interface CredibilityScoreProps {
  score: number;
  size?: "sm" | "md" | "lg";
}

export function CredibilityScore({ score, size = "md" }: CredibilityScoreProps) {
  const sizeClasses = {
    sm: "w-20 h-20",
    md: "w-32 h-32",
    lg: "w-48 h-48",
  };

  const textSizes = {
    sm: "text-lg",
    md: "text-3xl",
    lg: "text-5xl",
  };

  const strokeWidth = {
    sm: 6,
    md: 8,
    lg: 10,
  };

  const radius = size === "sm" ? 35 : size === "md" ? 55 : 85;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const getColor = (score: number) => {
    if (score >= 80) return "#10B981";
    if (score >= 60) return "#F59E0B";
    return "#EF4444";
  };

  return (
    <div className={`relative ${sizeClasses[size]} flex items-center justify-center`}>
      <svg className="transform -rotate-90 w-full h-full">
        <circle
          cx="50%"
          cy="50%"
          r={radius}
          stroke="#E5E7EB"
          strokeWidth={strokeWidth[size]}
          fill="none"
        />
        <circle
          cx="50%"
          cy="50%"
          r={radius}
          stroke={getColor(score)}
          strokeWidth={strokeWidth[size]}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`${textSizes[size]} font-bold text-gray-900`}>{score}</span>
        <span className="text-xs text-gray-600">Score</span>
      </div>
    </div>
  );
}
