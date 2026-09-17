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

const TITLE = "Campus Vision — визуальный профиль университета";
const DESCRIPTION =
  "AI-сервис: по названию университета формирует проверенный визуальный профиль кампуса за секунды.";

export const metadata: Metadata = {
  metadataBase: new URL("https://uni-visual-profile.vercel.app"),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/cover.png", width: 1920, height: 1080 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/cover.png"],
  },
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
