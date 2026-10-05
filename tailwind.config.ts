import type { Config } from 'tailwindcss';

// Tailwind is used for layout utilities only. The Upstox replica is plain CSS ported from
// reference/add-more-check-demo.html, so preflight is off to keep the reference's base styles intact.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [],
};

export default config;
