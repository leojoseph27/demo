'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
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
 * Searchable autocomplete multi-select component.
 *
 * Features:
 * - Type to filter from existing suggestions
 * - Select multiple values shown as removable chips/badges
 * - "Add 'X'" option when typed value doesn't match any suggestion
 * - Newly added values automatically become available for future selection
 * - Mobile-friendly with full-width popover
 * - Fast client-side filtering
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

  // Filtered suggestions based on input, excluding already-selected values
  const filteredSuggestions = suggestions.filter(
    (s) =>
      !values.includes(s) &&
      s.toLowerCase().includes(inputValue.toLowerCase())
  );

  // Determine if the current input is a new value that can be added
  const trimmedInput = inputValue.trim();
  const isExactMatch = suggestions.some(
    (s) => s.toLowerCase() === trimmedInput.toLowerCase()
  );
  const isAlreadySelected = values.some(
    (v) => v.toLowerCase() === trimmedInput.toLowerCase()
  );
  const canAddNew = trimmedInput.length > 0 && !isExactMatch && !isAlreadySelected;

  const handleSelect = useCallback(
    (value: string) => {
      const normalized = value.trim();
      if (!normalized) return;

      // Check if already selected (case-insensitive)
      const existingIndex = values.findIndex(
        (v) => v.toLowerCase() === normalized.toLowerCase()
      );

      if (existingIndex >= 0) {
        // Deselect — remove from values
        onChange(values.filter((_, i) => i !== existingIndex));
      } else {
        // Select — add to values
        onChange([...values, normalized]);
      }

      // Clear input and keep focus for rapid multi-select
      setInputValue('');
    },
    [values, onChange]
  );

  const handleAddNew = useCallback(() => {
    const normalized = trimmedInput;
    if (!normalized || isAlreadySelected) return;
    onChange([...values, normalized]);
    setInputValue('');
  }, [trimmedInput, isAlreadySelected, values, onChange]);

  const handleRemove = useCallback(
    (index: number) => {
      onChange(values.filter((_, i) => i !== index));
    },
    [values, onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Backspace when input is empty: remove last selected value
      if (e.key === 'Backspace' && !inputValue && values.length > 0) {
        e.preventDefault();
        onChange(values.slice(0, -1));
      }
      // Enter when there's a new value to add
      if (e.key === 'Enter' && canAddNew) {
        e.preventDefault();
        handleAddNew();
      }
    },
    [inputValue, values, onChange, canAddNew, handleAddNew]
  );

  // Auto-focus the search input when popover opens
  useEffect(() => {
    if (open) {
      // Small delay to ensure the command input is rendered
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  return (
    <div className={cn('space-y-2', className)}>
      <label className="text-sm font-medium text-foreground">{label}</label>

      {/* Selected values as removable chips */}
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

      {/* Autocomplete combobox */}
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
              {inputValue || placeholder || `Search ${label.toLowerCase()}...`}
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
            <div className="flex items-center border-b px-3">
              <CommandInput
                ref={inputRef}
                value={inputValue}
                onValueChange={setInputValue}
                onKeyDown={handleKeyDown}
                placeholder={`Type to search ${label.toLowerCase()}...`}
                className="h-9"
              />
            </div>
            <CommandList className="max-h-[200px]">
              {filteredSuggestions.length === 0 && !canAddNew && (
                <CommandEmpty>
                  {emptyMessage || `No ${label.toLowerCase()} found.`}
                </CommandEmpty>
              )}

              {/* Existing suggestions */}
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
                        className="cursor-pointer"
                      >
                        <Check
                          className={cn(
                            'mr-2 h-4 w-4',
                            isSelected ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        <span>{suggestion}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {/* "Add new" option when input doesn't match any suggestion */}
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
