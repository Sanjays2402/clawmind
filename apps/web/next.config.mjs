/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@clawmind/ui'],
  experimental: { typedRoutes: true },
};
export default nextConfig;
