import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  turbopack: {
    // Bundle the canonical loader shared with the repository's WASM qualification.
    root: path.resolve(__dirname, ".."),
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
