import type { NextConfig } from "next";

const desktopMode = process.env.SHIPSTUDIO_DESKTOP === "1";
const standaloneDesktopBuild = process.env.SHIPSTUDIO_DESKTOP_BUILD === "1";

const nextConfig: NextConfig = {
  distDir: desktopMode ? ".next-desktop" : ".next",
  ...(standaloneDesktopBuild ? { output: "standalone" as const } : {}),
};

export default nextConfig;
