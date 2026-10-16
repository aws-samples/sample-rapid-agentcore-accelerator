import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The dev badge sits over the sidebar's user menu.
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
