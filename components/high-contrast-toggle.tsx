"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Sun } from "lucide-react"
import { cn } from "@/lib/utils"

export function HighContrastToggle() {
  const [isHighContrast, setIsHighContrast] = useState(false)

  useEffect(() => {
    // Check localStorage on mount
    const saved = localStorage.getItem("high-contrast")
    if (saved === "true") {
      setIsHighContrast(true)
      document.documentElement.classList.add("high-contrast")
    }
  }, [])

  const toggleHighContrast = () => {
    const newValue = !isHighContrast
    setIsHighContrast(newValue)
    
    if (newValue) {
      document.documentElement.classList.add("high-contrast")
      localStorage.setItem("high-contrast", "true")
    } else {
      document.documentElement.classList.remove("high-contrast")
      localStorage.setItem("high-contrast", "false")
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggleHighContrast}
      className={cn(
        "gap-2 text-xs",
        isHighContrast && "bg-primary text-primary-foreground hover:bg-primary/90"
      )}
      title={isHighContrast ? "Desactivar alto contraste" : "Activar alto contraste (para ambientes con mucha luz)"}
    >
      <Sun className="h-4 w-4" />
      <span className="hidden sm:inline">{isHighContrast ? "Alto contraste ON" : "Alto contraste"}</span>
    </Button>
  )
}
