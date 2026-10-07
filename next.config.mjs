/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
  serverExternalPackages: ["canvas", "pdfjs-dist", "pdf-parse", "tesseract.js"],
};

export default nextConfig;
