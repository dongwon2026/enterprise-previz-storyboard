import localFont from "next/font/local";

// KT Flow — ENA 브랜드 공식 서체 (Thin/Medium/Bold/Black 4종)
// 파일은 public/fonts/에 있음 (PLAN.md 2번 결정 사항)
export const ktFlow = localFont({
  variable: "--font-kt-flow",
  display: "swap",
  src: [
    { path: "../public/fonts/KTFLOW-THIN.ttf", weight: "100", style: "normal" },
    { path: "../public/fonts/KTFLOW-MEDIUM.ttf", weight: "500", style: "normal" },
    { path: "../public/fonts/KTFLOW-BOLD.ttf", weight: "700", style: "normal" },
    { path: "../public/fonts/KTFLOW-BLACK.ttf", weight: "900", style: "normal" },
  ],
});
