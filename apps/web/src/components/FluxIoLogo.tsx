interface FluxIoLogoProps {
  className?: string;
  compact?: boolean;
}

export function FluxIoLogo({ className, compact = false }: FluxIoLogoProps) {
  return (
    <span
      aria-label={compact ? "FluxIO" : undefined}
      className={["fluxio-logo", compact ? "compact" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="fluxio-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <g
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 12 7 2" />
            <path d="m7 12 5-10" />
            <path d="m12 12 5-10" />
            <path d="m17 12 5-10" />
            <path d="M4.5 7h15" />
            <path d="M12 16v6" />
          </g>
        </svg>
      </span>
      {!compact ? (
        <span className="fluxio-wordmark">
          Flux<span>IO</span>
        </span>
      ) : null}
    </span>
  );
}
