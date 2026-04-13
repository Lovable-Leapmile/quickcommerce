import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ComponentStyles, ComponentType } from "./ComponentStyles";

interface ComponentEditorProps {
  open: boolean;
  onClose: () => void;
  componentType: ComponentType | null;
  styles: ComponentStyles;
  onStyleChange: (styles: ComponentStyles) => void;
}

const LABELS: Record<ComponentType, string> = {
  tray: "Tray",
  rack: "Rack / Slot Structure",
  shuttle: "Shuttle",
  rail: "Rail",
};

interface FieldDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  isColor?: boolean;
}

const FIELDS: Record<ComponentType, FieldDef[]> = {
  tray: [
    { key: "width", label: "Width", min: 0.1, max: 1.0, step: 0.01, unit: "m" },
    { key: "depth", label: "Depth", min: 0.1, max: 1.5, step: 0.01, unit: "m" },
    { key: "height", label: "Height", min: 0.02, max: 0.5, step: 0.01, unit: "m" },
    { key: "color", label: "Color", min: 0, max: 0, step: 0, unit: "", isColor: true },
  ],
  rack: [
    { key: "postSize", label: "Post Size", min: 0.01, max: 0.1, step: 0.005, unit: "m" },
    { key: "shelfHeight", label: "Shelf Height", min: 0.2, max: 1.0, step: 0.05, unit: "m" },
    { key: "color", label: "Post Color", min: 0, max: 0, step: 0, unit: "", isColor: true },
    { key: "shelfColor", label: "Shelf Color", min: 0, max: 0, step: 0, unit: "", isColor: true },
  ],
  shuttle: [
    { key: "width", label: "Width", min: 0.1, max: 1.0, step: 0.01, unit: "m" },
    { key: "height", label: "Height", min: 0.05, max: 0.5, step: 0.01, unit: "m" },
    { key: "depth", label: "Depth", min: 0.1, max: 1.0, step: 0.01, unit: "m" },
    { key: "color", label: "Color", min: 0, max: 0, step: 0, unit: "", isColor: true },
  ],
  rail: [
    { key: "width", label: "Width", min: 0.01, max: 0.2, step: 0.005, unit: "m" },
    { key: "height", label: "Height", min: 0.005, max: 0.1, step: 0.005, unit: "m" },
    { key: "color", label: "Color", min: 0, max: 0, step: 0, unit: "", isColor: true },
  ],
};

function hslToHex(hsl: string): string {
  const match = hsl.match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/);
  if (!match) return "#4488aa";
  const h = parseFloat(match[1]) / 360;
  const s = parseFloat(match[2]) / 100;
  const l = parseFloat(match[3]) / 100;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, h) * 255);
  const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function hexToHsl(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

export function ComponentEditor({ open, onClose, componentType, styles, onStyleChange }: ComponentEditorProps) {
  const [localValues, setLocalValues] = useState<Record<string, any>>({});

  useEffect(() => {
    if (componentType && open) {
      setLocalValues({ ...styles[componentType] });
    }
  }, [componentType, open, styles]);

  if (!componentType) return null;

  const fields = FIELDS[componentType];

  const handleChange = (key: string, value: string | number) => {
    setLocalValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleApply = () => {
    onStyleChange({
      ...styles,
      [componentType]: { ...localValues },
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {LABELS[componentType]}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <p className="text-xs text-muted-foreground">
            Changes apply to all {LABELS[componentType].toLowerCase()} instances.
          </p>
          <div className="grid grid-cols-2 gap-4">
            {fields.map((field) => (
              <div key={field.key}>
                <Label className="text-xs text-muted-foreground mb-1.5 block">
                  {field.label} {field.unit && `(${field.unit})`}
                </Label>
                {field.isColor ? (
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      value={hslToHex(String(localValues[field.key] || ""))}
                      onChange={(e) => handleChange(field.key, hexToHsl(e.target.value))}
                      className="w-10 h-10 rounded border border-border cursor-pointer"
                    />
                    <span className="text-xs font-mono text-muted-foreground">
                      {String(localValues[field.key] || "")}
                    </span>
                  </div>
                ) : (
                  <Input
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={localValues[field.key] ?? 0}
                    onChange={(e) => handleChange(field.key, parseFloat(e.target.value) || 0)}
                    className="bg-muted border-border text-foreground font-mono"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleApply}>Apply to All</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
