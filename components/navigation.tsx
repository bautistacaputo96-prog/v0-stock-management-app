"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import { LayoutDashboard, FileText, Users, ChevronDown, Factory, Package, ShieldCheck, Wrench, LogOut, FlaskConical } from "lucide-react"
import { usePlant, PLANTS, type PlantId } from "@/lib/plant-context"
import { useAuth, isRouteAllowed } from "@/lib/auth-context"

const navItems = [
  {
    title: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
  },
  {
    title: "Produccion",
    href: "/produccion",
    icon: Factory,
  },
  {
    title: "Informes",
    href: "/informes",
    icon: FileText,
  },
  {
    title: "Materia Prima",
    href: "/materia-prima",
    icon: Package,
    children: [
      { title: "Resumen", href: "/materia-prima" },
      { title: "Ingreso MP", href: "/materia-prima/ingreso" },
      { title: "Control de Stock", href: "/materia-prima/stock" },
      { title: "Proveedores", href: "/materia-prima?tab=proveedores" },
      { title: "Fletes", href: "/materia-prima?tab=fletes" },
    ],
  },
  {
    title: "Calidad",
    href: "/calidad",
    icon: ShieldCheck,
    children: [
      { title: "Panel General", href: "/calidad" },
      { title: "Control Canos", href: "/calidad/canos" },
      { title: "Granulometria", href: "/calidad/granulometria" },
      { title: "Humedad", href: "/calidad/humedad" },
      { title: "Ensayos", href: "/calidad/ensayos" },
      { title: "Parametros IRAM", href: "/calidad/parametros" },
    ],
  },
  {
    title: "Formuleo",
    href: "/formuleo",
    icon: FlaskConical,
  },
  {
    title: "RRHH",
    href: "/rrhh",
    icon: Users,
  },
  {
    title: "Mantenimiento",
    href: "/mantenimiento",
    icon: Wrench,
  },
]

export function Navigation() {
  const pathname = usePathname()
  const { selectedPlant, setSelectedPlant, plantInfo } = usePlant()
  const { user, logout } = useAuth()
  const [plantDropdownOpen, setPlantDropdownOpen] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const navDropdownRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Filtrar items de navegación según el rol del usuario
  const filteredNavItems = user ? navItems.filter(item => isRouteAllowed(user.role, item.href)) : []

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setPlantDropdownOpen(false)
      }
      if (openDropdown) {
        const ref = navDropdownRefs.current[openDropdown]
        if (ref && !ref.contains(e.target as Node)) {
          setOpenDropdown(null)
        }
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  return (
    <nav className="border-b border-border bg-card shadow-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          {/* Logo + Plant selector */}
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <Image src="/concretus-logo.png" alt="Concretus" width={32} height={32} className="rounded-md" />
              <span className="font-semibold text-sm leading-none tracking-tight text-foreground hidden sm:block">Concretus</span>
            </Link>

            <div className="h-5 w-px bg-border" />

            {/* Plant dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setPlantDropdownOpen(!plantDropdownOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-muted/60 hover:bg-muted transition-colors"
              >
                <Factory className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-foreground">{plantInfo?.name ?? "..."}</span>
                <span className="text-muted-foreground hidden sm:inline">({plantInfo?.location ?? ""})</span>
                <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", plantDropdownOpen && "rotate-180")} />
              </button>
              {plantDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-52 bg-card border border-border rounded-lg shadow-lg z-50 py-1">
                  {(Object.keys(PLANTS) as PlantId[]).map(id => {
                    const plant = PLANTS[id]
                    const isSelected = id === selectedPlant
                    return (
                      <button
                        key={id}
                        onClick={() => { setSelectedPlant(id); setPlantDropdownOpen(false) }}
                        className={cn(
                          "w-full flex items-start gap-3 px-3 py-2 text-left transition-colors",
                          isSelected ? "bg-primary/5" : "hover:bg-muted/50"
                        )}
                      >
                        <Factory className={cn("h-4 w-4 mt-0.5 shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />
                        <div>
                          <div className={cn("text-xs font-semibold", isSelected ? "text-primary" : "text-foreground")}>{plant.name}</div>
                          <div className="text-[10px] text-muted-foreground">{plant.location} - {(plant.lines || []).join(", ")}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-0.5">
            {filteredNavItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))

              if (item.children) {
                const isOpen = openDropdown === item.href
                return (
                  <div key={item.href} className="relative" ref={(el) => { navDropdownRefs.current[item.href] = el }}>
                    <button
                      onClick={() => setOpenDropdown(isOpen ? null : item.href)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-secondary hover:text-secondary-foreground",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {item.title}
                      <ChevronDown className={cn("h-3 w-3 transition-transform", isOpen && "rotate-180")} />
                    </button>
                    {isOpen && (
                      <div className="absolute top-full left-0 mt-1 w-44 bg-card border border-border rounded-lg shadow-lg z-50 py-1">
                        {item.children.map((child) => {
                          const isChildActive = pathname === child.href || pathname.startsWith(child.href)
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              onClick={() => setOpenDropdown(null)}
                              className={cn(
                                "block px-3 py-2 text-xs font-medium transition-colors",
                                isChildActive
                                  ? "bg-primary/5 text-primary"
                                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                              )}
                            >
                              {child.title}
                            </Link>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-secondary-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.title}
                </Link>
              )
            })}

            {/* Logout button */}
            {user && (
              <button
                onClick={logout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-red-100 hover:text-red-600 transition-colors ml-2"
                title={`Cerrar sesión (${user.name})`}
              >
                <LogOut className="h-3.5 w-3.5" />
                Salir
              </button>
            )}
          </div>
        </div>

        {/* Mobile navigation */}
        <div className="md:hidden flex gap-0.5 pb-2 overflow-x-auto -mx-1 px-1">
          {filteredNavItems.flatMap((item) => {
            if (item.children) {
              const ParentIcon = item.icon
              return item.children.map((child) => {
                const isChildActive = pathname === child.href || pathname.startsWith(child.href)
                return (
                  <Link
                    key={child.href}
                    href={child.href}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors",
                      isChildActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-secondary-foreground",
                    )}
                  >
                    <ParentIcon className="h-3.5 w-3.5" />
                    {child.title}
                  </Link>
                )
              })
            }

            const Icon = item.icon
            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-secondary-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.title}
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
