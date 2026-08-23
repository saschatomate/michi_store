import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  // sign-ai-media/@contentauth/c2pa-node ships native bindings, die ihren eigenen Bundle-Pfad
  // relativ auflösen - Turbopacks Server-Action-Bundling bricht diese Auflösung (Fehler
  // "path argument must be of type string ... Received an instance of URL"). Native require
  // statt Bundling umgeht das, gleiches Muster wie sharp/bcrypt etc. "sharp" kam mit
  // image-compositing.ts dazu (erster echter Einsatz im Server-Code) und braucht denselben Eintrag
  // - ohne ihn crasht jede Server-Component, die es importiert (z.B. products/[id]/page.tsx über
  // hasCompositingSupport), mit Internal Server Error, weil Turbopack sharps native .node-Bindings
  // falsch bündelt.
  serverExternalPackages: ["sign-ai-media", "@contentauth/c2pa-node", "sharp"],
  images: {
    // Diamond-Group-Bildserver liefert nur HTTP (Mixed-Content auf HTTPS-Seiten) -
    // next/image holt die Bilder serverseitig und liefert sie same-origin über HTTPS aus.
    remotePatterns: [
      {
        protocol: "http",
        hostname: "195.4.159.226",
      },
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
