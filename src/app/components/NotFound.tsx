import Link from "next/link";
import { Home, Search } from "lucide-react";
import { Button } from "./ui/button";

export function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="mb-8">
          <h1 className="text-9xl font-bold text-blue-600">404</h1>
          <h2 className="text-2xl font-semibold text-gray-900 mt-4">Page Not Found</h2>
          <p className="text-gray-600 mt-2">
            The page you're looking for doesn't exist or has been moved.
          </p>
        </div>
        <div className="flex gap-3 justify-center">
          <Link href="/">
            <Button className="gap-2 bg-[#1E3A8A] hover:bg-[#1E40AF]">
              <Home className="w-4 h-4" />
              Go Home
            </Button>
          </Link>
          <Link href="/">
            <Button variant="outline" className="gap-2">
              <Search className="w-4 h-4" />
              Search Candidates
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
