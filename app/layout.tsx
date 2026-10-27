import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Órbita · Seu dia, em perspectiva",
  description: "Suas agendas, tarefas e conversas. Três empresas, um lugar para organizar o seu dia.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
