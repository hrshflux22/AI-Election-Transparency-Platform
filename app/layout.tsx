import type { Metadata } from "next";
import "./globals.css";
import { Layout } from "@/app/components/Layout";

export const metadata: Metadata = {
  title: "Chunav Bodh | Election Transparency Platform",
  description: "AI-powered, fact-based electoral intelligence",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><Layout>{children}</Layout></body></html>;
}
