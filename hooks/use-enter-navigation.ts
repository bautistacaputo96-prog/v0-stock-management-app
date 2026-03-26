"use client"

import { useCallback, type KeyboardEvent } from "react"

/**
 * Hook para navegar entre inputs con Enter, como en Excel.
 * Uso: onKeyDown={handleEnterNavigation}
 * 
 * Busca el siguiente input dentro del mismo contenedor (data-enter-group)
 * o en todo el formulario si no hay grupo definido.
 */
export function useEnterNavigation(containerSelector?: string) {
  const handleEnterNavigation = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return
    
    e.preventDefault()
    
    const currentInput = e.currentTarget
    const container = containerSelector 
      ? document.querySelector(containerSelector)
      : currentInput.closest("[data-enter-group]") || currentInput.closest("form") || document.body
    
    if (!container) return
    
    // Get all focusable inputs in the container
    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>(
        'input[type="number"], input[type="text"], input:not([type]), textarea'
      )
    ).filter(input => !input.disabled && !input.readOnly && input.offsetParent !== null)
    
    const currentIndex = inputs.indexOf(currentInput)
    if (currentIndex === -1) return
    
    // Focus next input, or wrap to first
    const nextIndex = (currentIndex + 1) % inputs.length
    inputs[nextIndex]?.focus()
    inputs[nextIndex]?.select()
  }, [containerSelector])

  return handleEnterNavigation
}

/**
 * Version simplificada que acepta un ref al contenedor
 */
export function createEnterHandler(container: HTMLElement | null) {
  return (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return
    
    e.preventDefault()
    
    if (!container) return
    
    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>(
        'input[type="number"], input[type="text"], input:not([type])'
      )
    ).filter(input => !input.disabled && !input.readOnly && input.offsetParent !== null)
    
    const currentIndex = inputs.indexOf(e.currentTarget)
    if (currentIndex === -1) return
    
    const nextIndex = (currentIndex + 1) % inputs.length
    inputs[nextIndex]?.focus()
    inputs[nextIndex]?.select()
  }
}
