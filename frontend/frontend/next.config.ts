import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // Stub React Native module that MetaMask SDK tries to import in browser
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": path.resolve(
        "./libs/empty-module.js"
      ),
      // FHE SDK loaded via CDN in layout.tsx — stub npm package to prevent errors
      "@zama-fhe/relayer-sdk":        path.resolve("./libs/empty-module.js"),
      "@zama-fhe/relayer-sdk/bundle": path.resolve("./libs/empty-module.js"),
      "@zama-fhe/relayer-sdk/web":    path.resolve("./libs/empty-module.js"),
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