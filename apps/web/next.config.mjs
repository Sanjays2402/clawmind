/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@clawmind/ui'],
  experimental: { typedRoutes: false },
};
export default nextConfig;
