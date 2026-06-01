"use client"

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface ConstructionSiteFilterProps {
  constructionSites: any[]
  selectedSite: string
  onFilterChange: (siteId: string) => void
  disabled?: boolean
}

export function ConstructionSiteFilter({
  constructionSites,
  selectedSite,
  onFilterChange,
  disabled,
}: ConstructionSiteFilterProps) {
  return (
    <div className="flex flex-col gap-2">
      <Label>Obra</Label>
      <Select value={selectedSite} onValueChange={onFilterChange} disabled={disabled}>
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="Todas las obras" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas las obras</SelectItem>
          {constructionSites.map((site) => (
            <SelectItem key={site.id} value={site.id}>
              {site.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
