export function CTPayMark({
  size = 36,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <rect width="32" height="32" rx="8" fill="#18181b" />
      <text
        x="16"
        y="21.5"
        textAnchor="middle"
        fill="#ffffff"
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fontSize="14"
        fontWeight="700"
        letterSpacing="-0.6"
      >
        CT
      </text>
    </svg>
  );
}
