interface AdminSkeletonProps {
  lines?: number;
  rounded?: boolean;
}

export function AdminSkeleton({ lines = 3, rounded = true }: AdminSkeletonProps): JSX.Element {
  return (
    <div className="space-y-3">
      {Array.from({ length: lines }).map((_, index) => (
        <div
          // eslint-disable-next-line react/no-array-index-key -- skeleton items do not require stable keys
          key={index}
          className={`h-4 w-full animate-pulse bg-[color:var(--brand-charcoal)]/10 ${
            rounded ? "rounded-full" : ""
          }`}
        />
      ))}
    </div>
  );
}
