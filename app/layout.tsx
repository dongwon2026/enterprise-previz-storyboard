import type { Metadata } from "next";
import { ktFlow } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "예능 기획안 Pre-viz",
  description: "예능 기획 아이디어를 9프레임 텍스트 스토리보드로 만들어주는 사내 도구",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={ktFlow.variable}>
      <body>{children}</body>
    </html>
  );
}
