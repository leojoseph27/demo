'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { Check, X, ChevronsUpDown } from 'lucide-react';

interface SearchableMultiSelectProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  suggestions: string[];
  placeholder?: string;
  emptyMessage?: string;
  className?: string;
}

/**
 * Autocomplete combobox multi-select.
 *
 * Behaviour:
 * - Click the trigger → popover opens showing ALL available options immediately
 * - Type to filter the list (narrows as you type)
 * - Click an option to select it (shown as a removable chip)
 * - Selected items show a checkmark but remain in the list (dimmed) for reference
 * - If the typed value doesn't match anything → show "Add 'X'" option
 * - After adding, the new value persists in the suggestions for future use
 * - Backspace with empty input removes last selected value
 * - Mobile-friendly, full-width dropdown
 */
export function SearchableMultiSelect({
  label,
  values,
  onChange,
  suggestions,
  placeholder,
  emptyMessage,
  className,
}: SearchableMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Filtering ────────────────────────────────────────────────────────
  // When the popover opens (empty input), ALL suggestions are visible.
  // As the user types, the list narrows to matching items.
  const searchLower = inputValue.toLowerCase();
  const filteredSuggestions = searchLower
    ? suggestions.filter((s) => s.toLowerCase().includes(searchLower))
    : suggestions; // empty search → show everything

  // Can the user add a brand-new value?
  const trimmedInput = inputValue.trim();
  const isExactMatch = suggestions.some(
    (s) => s.toLowerCase() === trimmedInput.toLowerCase()
  );
  const isAlreadySelected = values.some(
    (v) => v.toLowerCase() === trimmedInput.toLowerCase()
  );
  const canAddNew =
    trimmedInput.length > 0 && !isExactMatch && !isAlreadySelected;

  // ── Handlers ─────────────────────────────────────────────────────────
  const handleSelect = useCallback(
    (value: string) => {
      const normalized = value.trim();
      if (!normalized) return;

      const existingIndex = values.findIndex(
        (v) => v.toLowerCase() === normalized.toLowerCase()
      );

      if (existingIndex >= 0) {
        // Deselect
        onChange(values.filter((_, i) => i !== existingIndex));
      } else {
        // Select
        onChange([...values, normalized]);
      }

      // Keep input so user can keep typing to add more
    },
    [values, onChange]
  );

  const handleAddNew = useCallback(() => {
    if (!trimmedInput || isAlreadySelected) return;
    onChange([...values, trimmedInput]);
    setInputValue(''); // clear after adding
  }, [trimmedInput, isAlreadySelected, values, onChange]);

  const handleRemove = useCallback(
    (index: number) => {
      onChange(values.filter((_, i) => i !== index));
    },
    [values, onChange]
  );

  // ── Keyboard ─────────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Backspace' && !inputValue && values.length > 0) {
        e.preventDefault();
        onChange(values.slice(0, -1));
      }
      if (e.key === 'Enter' && canAddNew) {
        e.preventDefault();
        handleAddNew();
      }
    },
    [inputValue, values, onChange, canAddNew, handleAddNew]
  );

  // ── Auto-focus input on open ─────────────────────────────────────────
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Reset input when closing
  useEffect(() => {
    if (!open) setInputValue('');
  }, [open]);

  return (
    <div className={cn('space-y-2', className)}>
      <label className="text-sm font-medium text-foreground">{label}</label>

      {/* ── Selected chips ──────────────────────────────────────────── */}
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value, index) => (
            <Badge
              key={index}
              variant="secondary"
              className="pl-2 pr-1 py-1 text-sm gap-1"
            >
              <span>{value}</span>
              <button
                type="button"
                onClick={() => handleRemove(index)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
                aria-label={`Remove ${value}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* ── Combobox trigger + popover ──────────────────────────────── */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-label={label}
            className={cn(
              'flex h-11 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm',
              'ring-offset-background placeholder:text-muted-foreground',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              'hover:bg-accent/50 transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            <span className={cn('truncate', !inputValue && 'text-muted-foreground')}>
              {inputValue || placeholder || `Select ${label.toLowerCase()}...`}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>

        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
          sideOffset={4}
        >
          <Command shouldFilter={false} className="w-full">
            <CommandInput
              ref={inputRef}
              value={inputValue}
              onValueChange={setInputValue}
              onKeyDown={handleKeyDown}
              placeholder={`Search ${label.toLowerCase()}...`}
            />
            <CommandList className="max-h-[220px]">
              {/* Empty state: only when there are suggestions loaded but none match,
                  AND the user has typed something */}
              {filteredSuggestions.length === 0 && !canAddNew && inputValue.length > 0 && (
                <CommandEmpty>
                  {emptyMessage || `No ${label.toLowerCase()} found.`}
                </CommandEmpty>
              )}

              {/* ── Suggestion list: always visible when items exist ── */}
              {filteredSuggestions.length > 0 && (
                <CommandGroup>
                  {filteredSuggestions.map((suggestion) => {
                    const isSelected = values.some(
                      (v) => v.toLowerCase() === suggestion.toLowerCase()
                    );
                    return (
                      <CommandItem
                        key={suggestion}
                        value={suggestion}
                        onSelect={() => handleSelect(suggestion)}
                        className={cn('cursor-pointer', isSelected && 'bg-accent/50')}
                      >
                        <Check
                          className={cn(
                            'mr-2 h-4 w-4 shrink-0',
                            isSelected ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        <span
                          className={cn(
                            'flex-1',
                            isSelected && 'font-medium'
                          )}
                        >
                          {suggestion}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {/* ── "Add new" option ──────────────────────────────────── */}
              {canAddNew && (
                <CommandGroup>
                  <CommandItem
                    onSelect={handleAddNew}
                    className="cursor-pointer text-primary font-medium"
                  >
                    <span className="mr-2 text-base">+</span>
                    <span>Add &ldquo;{trimmedInput}&rdquo;</span>
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
