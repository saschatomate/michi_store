import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  images: {
    // Diamond-Group-Bildserver liefert nur HTTP (Mixed-Content auf HTTPS-Seiten) -
    // next/image holt die Bilder serverseitig und liefert sie same-origin über HTTPS aus.
    remotePatterns: [
      {
        protocol: "http",
        hostname: "195.4.159.226",
      },
    ],
  },
};

export default nextConfig;
