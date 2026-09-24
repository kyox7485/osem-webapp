import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { LanguageProvider } from "@/components/language-provider";
import { NavigationGuard } from "@/components/navigation-guard";
import { UnsavedChangesDialog } from "@/components/unsaved-changes-dialog";
import { DirtyFormProvider } from "@/lib/dirty-form-context";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeClassScript } from "@/components/theme-script";
import { getServerLanguage } from "@/lib/i18n/server";
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
  title: "OSEM Web App",
  description: "OSEM Medicare nursing home management system",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const language = await getServerLanguage();

  return (
    <html
      lang={language === "ms" ? "ms" : "en"}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // ThemeClassScript adds .light/.dark to <html> before hydration, so the
      // class attribute legitimately differs from the server render.
      suppressHydrationWarning
    >
      <head>
        <ThemeClassScript />
      </head>
      <body className="min-h-full flex flex-col">
        <DirtyFormProvider>
          <ThemeProvider>
            <LanguageProvider initialLanguage={language}>
              {children}
              <NavigationGuard />
              <UnsavedChangesDialog />
            </LanguageProvider>
          </ThemeProvider>
        </DirtyFormProvider>
      </body>
    </html>
  );
}
