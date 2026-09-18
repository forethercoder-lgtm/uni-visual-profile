import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";

const body = Inter({
  variable: "--font-body",
  subsets: ["latin", "cyrillic"],
});

const heading = Playfair_Display({
  variable: "--font-heading",
  subsets: ["latin", "cyrillic"],
});

const TITLE = "Campus Vision — визуальный профиль университета и колледжа";
const DESCRIPTION =
  "AI-сервис: по названию университета или колледжа формирует проверенный визуальный профиль кампуса за секунды.";

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
      className={`${body.variable} ${heading.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
