import type { SVGProps } from "react";

export function NovaSalesLogo({
  className,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      {...props}
    >
      <path
        d="M20 4.75c-8.42 0-15.25 5.65-15.25 12.62 0 3.45 1.7 6.58 4.47 8.87l-1.42 5.03a1.1 1.1 0 0 0 1.47 1.31l5.57-2.27c1.6.48 3.33.74 5.16.74 8.42 0 15.25-5.65 15.25-12.62S28.42 4.75 20 4.75Z"
        fill="currentColor"
        opacity=".16"
      />
      <path
        d="M20 4.75c-8.42 0-15.25 5.65-15.25 12.62 0 3.45 1.7 6.58 4.47 8.87l-1.42 5.03a1.1 1.1 0 0 0 1.47 1.31l5.57-2.27c1.6.48 3.33.74 5.16.74 8.42 0 15.25-5.65 15.25-12.62S28.42 4.75 20 4.75Z"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M13.2 22V13.5l6.8 6v-6M26.8 13.5V22l-6.8-6v6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
