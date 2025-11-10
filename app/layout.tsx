import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MCP Code Execution Demo",
  description:
    "Demo application showcasing Model Context Protocol style code execution tools"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
