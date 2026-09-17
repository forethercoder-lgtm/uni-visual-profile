import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Campus Vision — визуальный профиль университета",
  description:
    "AI-сервис: по названию университета формирует проверенный визуальный профиль кампуса за секунды.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div className="aurora-bg" aria-hidden="true">
          <div className="aurora-blob one" />
          <div className="aurora-blob two" />
          <div className="aurora-blob three" />
        </div>
        {children}
      </body>
    </html>
  );
}
