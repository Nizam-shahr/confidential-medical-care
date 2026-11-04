import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Dev only: keep compiled pages for an hour instead of ~60 s. The wallet/crypto stack is ~11.5k modules, so a
  // disposed page costs ~30 s to recompile when you navigate back to it.
  onDemandEntries: { maxInactiveAge: 60 * 60 * 1000, pagesBufferLength: 10 },

  webpack: (config) => {
    // Stub React Native module that MetaMask SDK tries to import in browser
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": path.resolve(
        "./libs/empty-module.js"
      ),
    };

    config.externals.push("pino-pretty", "lokijs", "encoding");
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false, net: false, tls: false,
    };

    config.experiments = { ...config.experiments, asyncWebAssembly: true };

    return config;
  },

  transpilePackages: [
    "@rainbow-me/rainbowkit",
    "wagmi",
    "@wagmi/core",
    "@wagmi/connectors",
  ],

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy",   value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;