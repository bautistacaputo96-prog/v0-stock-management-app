"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, useEffect } from "react"
import {
  LayoutDashboard,
  Package,
  FlaskConical,
  TrendingUp,
  Truck,
  ShieldCheck,
  FileBarChart,
  ChevronDown,
  PanelLeftClose,
  PanelLeft,
  Users,
  Calendar,
  Menu,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { HighContrastToggle } from "@/components/high-contrast-toggle"

const mainNavItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/materias-primas", label: "Materias Primas", icon: Package },
  { href: "/formulas", label: "Formulas", icon: FlaskConical },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/camiones", label: "Camiones", icon: Truck },
]

const dispatchSubItems = [
  { href: "/programacion", label: "Programacion" },
  { href: "/plantista", label: "Despacho Diario" },
  { href: "/historial-despachos", label: "Historial" },
]

const qualitySubItems = [
  { href: "/calidad?tab=probetas", label: "Probetas" },
  { href: "/calidad?tab=rotura", label: "Rotura" },
  { href: "/calidad?tab=granulometria", label: "Granulometria" },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [qualityOpen, setQualityOpen] = useState(pathname.startsWith("/calidad"))
  const [dispatchOpen, setDispatchOpen] = useState(
    pathname.startsWith("/programacion") || 
    pathname.startsWith("/plantista") || 
    pathname.startsWith("/historial-despachos")
  )
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname.startsWith(href)
  }

  // Shared navigation content
  const NavContent = ({ isMobile = false }: { isMobile?: boolean }) => (
    <div className="flex flex-col gap-1">
      {mainNavItems.map((item) => {
        const Icon = item.icon
        const active = isActive(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => isMobile && setMobileOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-[#1e293b] text-white"
                : "text-[#94a3b8] hover:bg-[#1e293b] hover:text-white"
            )}
          >
            <Icon className="h-[18px] w-[18px] flex-shrink-0" />
            <span>{item.label}</span>
          </Link>
        )
      })}

      {/* Dispatch section */}
      <button
        onClick={() => setDispatchOpen(!dispatchOpen)}
        className={cn(
          "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors w-full text-left",
          (pathname.startsWith("/programacion") || pathname.startsWith("/plantista") || pathname.startsWith("/historial-despachos"))
            ? "bg-[#1e293b] text-white"
            : "text-[#94a3b8] hover:bg-[#1e293b] hover:text-white"
        )}
      >
        <Calendar className="h-[18px] w-[18px] flex-shrink-0" />
        <span className="flex-1">Despachos</span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", dispatchOpen && "rotate-180")} />
      </button>
      {dispatchOpen && (
        <div className="ml-4 flex flex-col gap-0.5 border-l border-[#1e293b] pl-4">
          {dispatchSubItems.map((sub) => (
            <Link
              key={sub.href}
              href={sub.href}
              onClick={() => isMobile && setMobileOpen(false)}
              className={cn(
                "rounded-md px-3 py-2 text-sm transition-colors",
                pathname === sub.href ? "text-white font-medium" : "text-[#64748b] hover:text-white"
              )}
            >
              {sub.label}
            </Link>
          ))}
        </div>
      )}

      {/* Quality section */}
      <button
        onClick={() => setQualityOpen(!qualityOpen)}
        className={cn(
          "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors w-full text-left",
          pathname.startsWith("/calidad")
            ? "bg-[#1e293b] text-white"
            : "text-[#94a3b8] hover:bg-[#1e293b] hover:text-white"
        )}
      >
        <ShieldCheck className="h-[18px] w-[18px] flex-shrink-0" />
        <span className="flex-1">Calidad</span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", qualityOpen && "rotate-180")} />
      </button>
      {qualityOpen && (
        <div className="ml-4 flex flex-col gap-0.5 border-l border-[#1e293b] pl-4">
          {qualitySubItems.map((sub) => (
            <Link
              key={sub.href}
              href={sub.href}
              onClick={() => isMobile && setMobileOpen(false)}
              className={cn(
                "rounded-md px-3 py-2 text-sm transition-colors",
                pathname + (typeof window !== "undefined" ? window.location.search : "") === sub.href
                  ? "text-white font-medium"
                  : "text-[#64748b] hover:text-white"
              )}
            >
              {sub.label}
            </Link>
          ))}
        </div>
      )}

      <Link
        href="/informes"
        onClick={() => isMobile && setMobileOpen(false)}
        className={cn(
          "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
          isActive("/informes")
            ? "bg-[#1e293b] text-white"
            : "text-[#94a3b8] hover:bg-[#1e293b] hover:text-white"
        )}
      >
        <FileBarChart className="h-[18px] w-[18px] flex-shrink-0" />
        <span>Informes</span>
      </Link>
    </div>
  )

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop Sidebar - hidden on mobile */}
      <aside
        className={cn(
          "hidden md:flex flex-col bg-[#0f172a] text-[#cbd5e1] transition-all duration-200 ease-in-out flex-shrink-0",
          collapsed ? "w-[68px]" : "w-60"
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between px-4 border-b border-[#1e293b]">
          {!collapsed && (
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#1a56db]">
                <span className="text-sm font-bold text-white">R</span>
              </div>
              <span className="text-sm font-semibold text-white tracking-tight">Rebucret S.A.</span>
            </Link>
          )}
          {collapsed && (
            <Link href="/" className="mx-auto">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#1a56db]">
                <span className="text-sm font-bold text-white">R</span>
              </div>
            </Link>
          )}
        </div>

        {/* Desktop Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {!collapsed ? (
            <NavContent />
          ) : (
            <div className="flex flex-col gap-1">
              {mainNavItems.map((item) => {
                const Icon = item.icon
                const active = isActive(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center justify-center rounded-md p-2.5 transition-colors",
                      active
                        ? "bg-[#1e293b] text-white"
                        : "text-[#94a3b8] hover:bg-[#1e293b] hover:text-white"
                    )}
                    title={item.label}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </Link>
                )
              })}
              <Link
                href="/programacion"
                className={cn(
                  "flex items-center justify-center rounded-md p-2.5 transition-colors",
                  (pathname.startsWith("/programacion") || pathname.startsWith("/plantista") || pathname.startsWith("/historial-despachos"))
                    ? "bg-[#1e293b] text-white"
                    : "text-[#94a3b8] hover:bg-[#1e293b] hover:text-white"
                )}
                title="Despachos"
              >
                <Calendar className="h-[18px] w-[18px]" />
              </Link>
              <Link
                href="/calidad"
                className={cn(
                  "flex items-center justify-center rounded-md p-2.5 transition-colors",
                  pathname.startsWith("/calidad")
                    ? "bg-[#1e293b] text-white"
                    : "text-[#94a3b8] hover:bg-[#1e293b] hover:text-white"
                )}
                title="Calidad"
              >
                <ShieldCheck className="h-[18px] w-[18px]" />
              </Link>
              <Link
                href="/informes"
                className={cn(
                  "flex items-center justify-center rounded-md p-2.5 transition-colors",
                  isActive("/informes")
                    ? "bg-[#1e293b] text-white"
                    : "text-[#94a3b8] hover:bg-[#1e293b] hover:text-white"
                )}
                title="Informes"
              >
                <FileBarChart className="h-[18px] w-[18px]" />
              </Link>
            </div>
          )}
        </nav>

        {/* Collapse toggle */}
        <div className="border-t border-[#1e293b] p-3">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex w-full items-center justify-center rounded-md p-2 text-[#64748b] hover:bg-[#1e293b] hover:text-white transition-colors"
          >
            {collapsed ? (
              <PanelLeft className="h-[18px] w-[18px]" />
            ) : (
              <PanelLeftClose className="h-[18px] w-[18px]" />
            )}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 md:h-16 items-center justify-between border-b bg-card px-4 md:px-6">
          {/* Mobile menu button */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Abrir menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 bg-[#0f172a] border-[#1e293b]">
              <div className="flex h-14 items-center px-4 border-b border-[#1e293b]">
                <Link href="/" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#1a56db]">
                    <span className="text-sm font-bold text-white">R</span>
                  </div>
                  <span className="text-sm font-semibold text-white tracking-tight">Rebucret S.A.</span>
                </Link>
              </div>
              <nav className="flex-1 overflow-y-auto px-3 py-4">
                <NavContent isMobile />
              </nav>
            </SheetContent>
          </Sheet>

          {/* Logo for mobile (centered) */}
          <div className="md:hidden flex-1 flex justify-center">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#1a56db]">
                <span className="text-xs font-bold text-white">R</span>
              </div>
              <span className="text-sm font-semibold tracking-tight">Rebucret</span>
            </Link>
          </div>
          
          {/* Desktop placeholder */}
          <div className="hidden md:block" />

          <div className="flex items-center gap-2 md:gap-3">
            <HighContrastToggle />
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
              OP
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-background">
          {children}
        </main>
      </div>
    </div>
  )
}
