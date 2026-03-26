import { Navigation } from "@/components/navigation"
import { PlantDashboardRouter } from "@/components/plant-dashboard-router"

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <PlantDashboardRouter />
    </div>
  )
}
