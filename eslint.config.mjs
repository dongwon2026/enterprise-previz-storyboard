import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

// Next.js 권장 규칙(core-web-vitals, TypeScript 포함)을 그대로 사용
const eslintConfig = [
  ...nextCoreWebVitals,
  {
    ignores: ["trash-can/**"],
  },
];

export default eslintConfig;
