'use client';

import { useState, useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { flushSync } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { X, Plus } from 'lucide-react';

interface MultiValueInputProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}

export interface MultiValueInputHandle {
  /** Commit any pending text in the input field to the values array. */
  flush: () => void;
}

/**
 * A multi-value tag/chip input.
 *
 * IMPORTANT UX FIX: When the user types a value but clicks "Save" without
 * pressing Enter or clicking "+", the pending value would be lost because
 * it was only in the internal `inputValue` state, not in the `values` array.
 *
 * We fix this with two mechanisms:
 * 1. `onBlur` auto-commit: when the input loses focus (e.g. user clicks Save),
 *    the pending value is auto-added to the values array.
 * 2. `flush()` via imperative handle: the parent form calls `flush()` on all
 *    MultiValueInput refs before building the save payload, as a safety net
 *    to guarantee no pending value is lost.
 *
 * Both mechanisms use `flushSync` to ensure the state update is applied
 * synchronously before the click handler on the Save button reads formData.
 */
export const MultiValueInput = forwardRef<MultiValueInputHandle, MultiValueInputProps>(
  function MultiValueInput({ label, values, onChange, placeholder }, ref) {
    const [inputValue, setInputValue] = useState('');

    // Keep refs in sync so the flush() method always has the latest values
    const valuesRef = useRef(values);
    valuesRef.current = values;
    const inputValueRef = useRef(inputValue);
    inputValueRef.current = inputValue;
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    const addValue = useCallback(() => {
      const trimmed = inputValue.trim();
      if (trimmed && !values.includes(trimmed)) {
        // Use flushSync so that if this is called during a blur event,
        // the parent state update (formData) is applied synchronously
        // before the click handler on Save reads formData.
        flushSync(() => {
          onChange([...values, trimmed]);
        });
        setInputValue('');
      }
    }, [inputValue, values, onChange]);

    /**
     * Flush any pending input value into the values array.
     * Called by the parent form before saving.
     */
    const flush = useCallback(() => {
      const trimmed = inputValueRef.current.trim();
      if (trimmed && !valuesRef.current.includes(trimmed)) {
        flushSync(() => {
          onChangeRef.current([...valuesRef.current, trimmed]);
        });
        setInputValue('');
      }
    }, []);

    // Expose flush to parent via ref
    useImperativeHandle(ref, () => ({ flush }), [flush]);

    const removeValue = useCallback((index: number) => {
      onChange(values.filter((_, i) => i !== index));
    }, [values, onChange]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addValue();
      }
    };

    /**
     * Auto-commit the pending value when the input loses focus.
     * This handles the case where the user types a value, then clicks
     * the Save button without pressing Enter or clicking "+".
     */
    const handleBlur = () => {
      // Use a tiny delay to avoid interfering with the "+" button click.
      // When the user clicks the "+" button, the input blurs first,
      // then the button click fires. We need to let the button's
      // onClick handle the add, not the blur.
      //
      // However, we use requestAnimationFrame instead of a timeout
      // to keep it fast enough that the Save button click still sees
      // the updated state.
      const trimmed = inputValue.trim();
      if (trimmed && !values.includes(trimmed)) {
        // Check if the related target (element receiving focus) is the "+" button.
        // If so, don't auto-commit — the button's onClick will handle it.
        // The "+" button is a sibling <Button> next to the input.
        const activeEl = document.activeElement;
        const isPlusButton = activeEl?.closest('button[variant="outline"]') ||
          activeEl?.getAttribute('data-plus-button') !== null;

        if (!isPlusButton) {
          flushSync(() => {
            onChange([...values, trimmed]);
          });
          setInputValue('');
        }
      }
    };

    return (
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">{label}</label>
        <div className="space-y-2">
          {values.map((value, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="flex-1 flex items-center bg-muted/50 rounded-md px-3 py-2 border">
                <span className="text-sm flex-1">{value}</span>
                <button
                  type="button"
                  onClick={() => removeValue(index)}
                  className="text-muted-foreground hover:text-destructive transition-colors p-1 -mr-1"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              placeholder={placeholder || `Add ${label.toLowerCase()}`}
              className="flex-1 h-11"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addValue}
              disabled={!inputValue.trim()}
              className="h-11 px-3"
              data-plus-button="true"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }
);
