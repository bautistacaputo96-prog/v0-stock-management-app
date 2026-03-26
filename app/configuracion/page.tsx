import { Navigation } from "@/components/navigation"
import { PlantSettingsRouter } from "@/components/plant-settings-router"

export default function ConfiguracionPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <PlantSettingsRouter />
      </main>
    </div>
  )
}
