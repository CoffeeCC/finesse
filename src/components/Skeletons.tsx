export function CardSkeleton({ width }: { width?: number }) {
  return (
    <div className="shrink-0" style={width ? { width } : undefined}>
      <div className="aspect-[2/3] rounded-xl shimmer" />
      <div className="mt-2 h-4 w-3/4 rounded shimmer" />
      <div className="mt-1.5 h-3 w-1/3 rounded shimmer" />
    </div>
  )
}

export function HeroSkeleton() {
  return <div className="h-[60vh] w-full shimmer" />
}
