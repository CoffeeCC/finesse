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
  return <div className="h-[calc(var(--vh)*60)] w-full shimmer" />
}

export function WideSkeleton() {
  return (
    <div className="shrink-0 w-[16.5rem] sm:w-[18.5rem] lg:w-[20rem]">
      <div className="aspect-video rounded-xl shimmer" />
      <div className="mt-2 h-4 w-2/3 rounded shimmer" />
      <div className="mt-1.5 h-3 w-1/2 rounded shimmer" />
    </div>
  )
}
