import { Shield } from "lucide-react";

interface VerifiedBadgeProps {
  size?: "sm" | "md";
  showLabel?: boolean;
}

export function VerifiedBadge({ size = "md", showLabel = true }: VerifiedBadgeProps) {
  const sizeClasses = {
    sm: "text-xs px-2 py-1",
    md: "text-sm px-3 py-1.5",
  };

  const iconSize = {
    sm: "w-3 h-3",
    md: "w-4 h-4",
  };

  return (
    <div
      className={`inline-flex items-center gap-1.5 bg-green-100 text-green-800 rounded-full font-medium border border-green-200 ${sizeClasses[size]}`}
    >
      <Shield className={iconSize[size]} />
      {showLabel && <span>Verified Data</span>}
    </div>
  );
}
