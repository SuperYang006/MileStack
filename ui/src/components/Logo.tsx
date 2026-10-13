import React from "react";

interface LogoProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  size?: number;
}

export const Logo: React.FC<LogoProps> = ({ className, size, ...props }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size || "100%"}
      height={size || "100%"}
      className={className}
      {...props}
    >
      <defs>
        <linearGradient id="ms-bg-ha" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0E121E" />
          <stop offset="50%" stopColor="#0A0C16" />
          <stop offset="100%" stopColor="#05060B" />
        </linearGradient>

        <linearGradient id="ms-dev-track" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#1D4ED8" />
          <stop offset="40%" stopColor="#2563EB" />
          <stop offset="80%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#7DD3FC" />
        </linearGradient>

        <linearGradient id="ms-agent-track" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#F43F5E" />
          <stop offset="40%" stopColor="#EC4899" />
          <stop offset="80%" stopColor="#A855F7" />
          <stop offset="100%" stopColor="#6366F1" />
        </linearGradient>

        <linearGradient id="ms-stack-rung" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="50%" stopColor="#C084FC" />
          <stop offset="100%" stopColor="#F43F5E" />
        </linearGradient>

        <filter id="ms-glow-ha" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter id="ms-shadow-ha" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="7" stdDeviation="6" floodColor="#000000" floodOpacity="0.65" />
        </filter>

        <radialGradient id="ms-ambient-ha" cx="50%" cy="48%" r="55%">
          <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.14" />
          <stop offset="50%" stopColor="#2563EB" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="512" height="512" rx="112" fill="url(#ms-bg-ha)" />
      <rect width="512" height="512" rx="112" fill="none" stroke="#334155" strokeWidth="2" strokeOpacity="0.35" />

      <circle cx="256" cy="256" r="210" fill="url(#ms-ambient-ha)" />

      <g id="synergy-harmonic-a">
        {/* 底层智能体穿插弧段 */}
        <path
          d="M 256 360 C 190 360 140 310 140 240 C 140 170 190 120 256 120"
          fill="none"
          stroke="url(#ms-agent-track)"
          strokeWidth="36"
          strokeLinecap="round"
          strokeOpacity="0.25"
        />

        {/* 中央梯级里程碑堆栈 (Ascending Milestone Stack) */}
        <g id="tiered-milestone-stack" filter="url(#ms-glow-ha)">
          <line
            x1="202"
            y1="310"
            x2="310"
            y2="310"
            stroke="url(#ms-stack-rung)"
            strokeWidth="18"
            strokeLinecap="round"
            strokeOpacity="0.85"
          />
          <circle cx="256" cy="310" r="3" fill="#FFFFFF" fillOpacity="0.8" />

          <line
            x1="214"
            y1="250"
            x2="298"
            y2="250"
            stroke="url(#ms-stack-rung)"
            strokeWidth="18"
            strokeLinecap="round"
          />
          <circle cx="256" cy="250" r="3.5" fill="#FFFFFF" fillOpacity="0.95" />

          <line
            x1="226"
            y1="190"
            x2="286"
            y2="190"
            stroke="url(#ms-stack-rung)"
            strokeWidth="18"
            strokeLinecap="round"
          />
          <circle cx="256" cy="190" r="5" fill="#FFFFFF" />
          <circle cx="256" cy="190" r="9" fill="none" stroke="#FFFFFF" strokeWidth="1.5" strokeOpacity="0.6" />
        </g>

        {/* 开发者轨道 (Developer Track) */}
        <g id="dev-track" filter="url(#ms-glow-ha)">
          <path
            d="M 256 120 C 170 120 126 178 126 256 C 126 334 176 388 256 388 C 300 388 336 364 356 328"
            fill="none"
            stroke="url(#ms-dev-track)"
            strokeWidth="38"
            strokeLinecap="round"
            filter="url(#ms-shadow-ha)"
          />

          <path
            d="M 256 104 C 180 104 140 160 140 256 C 140 330 184 372 256 372"
            fill="none"
            stroke="#BAE6FD"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeOpacity="0.85"
          />

          <circle cx="356" cy="328" r="8" fill="#38BDF8" />
          <circle cx="356" cy="328" r="4" fill="#FFFFFF" />
        </g>

        {/* 智能体轨道 (Agent Track) */}
        <g id="agent-track" filter="url(#ms-glow-ha)">
          <path
            d="M 256 388 C 342 388 386 330 386 252 C 386 174 336 120 256 120 C 212 120 176 144 156 180"
            fill="none"
            stroke="url(#ms-agent-track)"
            strokeWidth="38"
            strokeLinecap="round"
            filter="url(#ms-shadow-ha)"
          />

          <path
            d="M 256 404 C 332 404 372 348 372 252 C 372 178 328 136 256 136"
            fill="none"
            stroke="#FBCFE8"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeOpacity="0.85"
          />

          <circle cx="156" cy="180" r="8" fill="#F43F5E" />
          <circle cx="156" cy="180" r="4" fill="#FFFFFF" />
        </g>

        {/* 两极交汇共生微粒 */}
        <circle cx="256" cy="120" r="9" fill="#FFFFFF" filter="url(#ms-glow-ha)" />
        <circle cx="256" cy="388" r="9" fill="#FFFFFF" filter="url(#ms-glow-ha)" />
      </g>
    </svg>
  );
};
