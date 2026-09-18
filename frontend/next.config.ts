import type { NextConfig } from "next";
const config: NextConfig = {
  devIndicators: false,
  experimental: { cpus: 2 },
};
export default config;
