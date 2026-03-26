import { Navigation } from "@/components/navigation"

export default function StockPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">Control de Stock</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Gestion de inventario de materia prima</p>
        </div>
      </div>
    </div>
  )
}
