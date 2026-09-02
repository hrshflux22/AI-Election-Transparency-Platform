import { CheckCircle2, Clock, XCircle } from "lucide-react";

interface StatusTagProps {
  status: "completed" | "in-progress" | "not-done";
  showIcon?: boolean;
}

export function StatusTag({ status, showIcon = true }: StatusTagProps) {
  const config = {
    completed: {
      label: "Completed",
      className: "bg-green-100 text-green-800 border-green-200",
      icon: CheckCircle2,
    },
    "in-progress": {
      label: "In Progress",
      className: "bg-yellow-100 text-yellow-800 border-yellow-200",
      icon: Clock,
    },
    "not-done": {
      label: "Not Done",
      className: "bg-red-100 text-red-800 border-red-200",
      icon: XCircle,
    },
  };

  const { label, className, icon: Icon } = config[status];

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${className}`}>
      {showIcon && <Icon className="w-3.5 h-3.5" />}
      {label}
    </span>
  );
}
