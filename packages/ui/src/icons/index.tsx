// Phosphor-style duotone icons, inlined so the runtime stays free of network deps.
import * as React from 'react';

export type IconProps = React.SVGProps<SVGSVGElement> & { size?: number };

function base(props: IconProps): React.SVGProps<SVGSVGElement> {
  const { size = 18, ...rest } = props;
  return {
    width: size,
    height: size,
    viewBox: '0 0 256 256',
    xmlns: 'http://www.w3.org/2000/svg',
    fill: 'currentColor',
    ...rest,
  };
}

export const IconSearch = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="112" cy="112" r="80" opacity="0.2" />
    <path d="M229.66 218.34l-50.07-50.06a88.11 88.11 0 1 0-11.31 11.31l50.06 50.07a8 8 0 0 0 11.32-11.32ZM40 112a72 72 0 1 1 72 72 72.08 72.08 0 0 1-72-72Z" />
  </svg>
);

export const IconSpark = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M208 144l-32 32-32-32 32-32z" opacity="0.2" />
    <path d="M197.7 130.3a8 8 0 0 0-11.4 0L160 156.69l-26.34-26.35a8 8 0 0 0-11.32 11.32l32 32a8 8 0 0 0 11.32 0l32-32a8 8 0 0 0 0-11.36Z" />
    <path d="M128 24a8 8 0 0 1 8 8v24h24a8 8 0 0 1 0 16h-24v24a8 8 0 0 1-16 0V72H96a8 8 0 0 1 0-16h24V32a8 8 0 0 1 8-8Z" />
  </svg>
);

export const IconBook = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M208 32H72a24 24 0 0 0-24 24v152a16 16 0 0 0 16 16h144Z" opacity="0.2" />
    <path d="M208 24H72a32 32 0 0 0-32 32v152a24 24 0 0 0 24 24h144a8 8 0 0 0 0-16H64a8 8 0 0 1 0-16h144a8 8 0 0 0 8-8V32a8 8 0 0 0-8-8Zm-8 144H72a31.8 31.8 0 0 0-16 4.31V56a16 16 0 0 1 16-16h128Z" />
  </svg>
);

export const IconSettings = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="128" cy="128" r="40" opacity="0.2" />
    <path d="M128 80a48 48 0 1 0 48 48 48 48 0 0 0-48-48Zm0 80a32 32 0 1 1 32-32 32 32 0 0 1-32 32Z" />
  </svg>
);

export const IconSun = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="128" cy="128" r="56" opacity="0.2" />
    <path d="M128 56a72 72 0 1 0 72 72 72.08 72.08 0 0 0-72-72Zm0 128a56 56 0 1 1 56-56 56.06 56.06 0 0 1-56 56Z" />
  </svg>
);

export const IconMoon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M228 128a100 100 0 0 1-156 82 100 100 0 1 1 84-184 100 100 0 0 1 72 102Z" opacity="0.2" />
    <path d="M233.54 142.23a8 8 0 0 0-8-2 88.08 88.08 0 0 1-109.8-109.8 8 8 0 0 0-10-10 104.84 104.84 0 0 0-52.91 37 104 104 0 0 0 155 135 104.84 104.84 0 0 0 27.71-42.2 8 8 0 0 0-2-8Z" />
  </svg>
);

export const IconSend = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M223.87 114L39.87 26a8 8 0 0 0-10.84 10.06l28.84 90.21a8 8 0 0 1 0 5.46l-28.84 90.21A8 8 0 0 0 39.87 232L223.87 142a16 16 0 0 0 0-28Z" opacity="0.2" />
    <path d="M231.62 92.6a16 16 0 0 0-7.75-13.79L40 -8a16 16 0 0 0-21.4 19.65l24 75a8 8 0 0 0 0 4.7l-24 75a16 16 0 0 0 21.4 19.65L224 213.19a16 16 0 0 0 7.62-13.79Z" />
  </svg>
);

export const IconCopy = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M216 40v144H72V40Z" opacity="0.2" />
    <path d="M216 32H88a8 8 0 0 0-8 8v40H40a8 8 0 0 0-8 8v128a8 8 0 0 0 8 8h128a8 8 0 0 0 8-8v-40h40a8 8 0 0 0 8-8V40a8 8 0 0 0-8-8Zm-56 176H48V96h112Zm48-48h-32V88a8 8 0 0 0-8-8H96V48h112Z" />
  </svg>
);

export const IconLink = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M152 160l-48-48a40 40 0 1 1 56-56l48 48a40 40 0 1 1-56 56Z" opacity="0.2" />
    <path d="M173.66 82.34a8 8 0 0 0-11.32 11.32l11.32 11.31a24 24 0 1 1-33.94 33.94l-32-32a24 24 0 0 1 0-33.94 8 8 0 1 0-11.31-11.32 40 40 0 0 0 0 56.57l32 32a40 40 0 0 0 56.57-56.57Z" />
  </svg>
);

export const IconFolder = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M232 80v120a8 8 0 0 1-8 8H32a8 8 0 0 1-8-8V64a8 8 0 0 1 8-8h61.33L120 72h104a8 8 0 0 1 8 8Z" opacity="0.2" />
    <path d="M232 64h-92l-17.78-13.34A16 16 0 0 0 112 48H40a16 16 0 0 0-16 16v144a16 16 0 0 0 16 16h184a16 16 0 0 0 16-16V80a16 16 0 0 0-16-16Z" />
  </svg>
);

export const IconWarning = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M236 200H20a8 8 0 0 1-7-12.12l108-184a8 8 0 0 1 13.88 0l108 184A8 8 0 0 1 236 200Z" opacity="0.2" />
    <path d="M236.8 188.09L149.35 36.22a24 24 0 0 0-42.7 0L19.2 188.09a23.6 23.6 0 0 0 .21 24A24 24 0 0 0 40.55 224h174.9a24 24 0 0 0 21.14-11.93 23.6 23.6 0 0 0 .21-24Z" />
  </svg>
);
