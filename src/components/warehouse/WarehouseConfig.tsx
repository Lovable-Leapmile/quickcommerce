import { Warehouse, Loader2, AlertCircle } from "lucide-react";

export interface WarehouseParams {
  rows: number;
  racks: number;
  deep: number;
  slotsPerRack: number;
  length: number;
  width: number;
  height: number;
  packingStations?: number;
  slotsPerStation?: number;
}

interface WarehouseConfigProps {
  params: WarehouseParams;
  loading?: boolean;
  error?: string | null;
  headless?: boolean;
}

function ParamRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold font-mono text-foreground">{value}</span>
    </div>
  );
}

export function WarehouseConfig({ params, loading, error, headless }: WarehouseConfigProps) {
  if (headless) {
    return (
      <div className="space-y-3">
        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground text-xs py-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading from API...
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-destructive text-xs py-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error} — using defaults</span>
          </div>
        )}
        <div className="bg-muted rounded-lg p-3 divide-y divide-border">
          <ParamRow label="Rows" value={String(params.rows)} />
          <ParamRow label="Racks per Row" value={String(params.racks)} />
          <ParamRow label="Deep" value={params.deep === 1 ? "1 (Single)" : "2 (Double)"} />
          <ParamRow label="Slots (Levels)" value={String(params.slotsPerRack)} />
          <ParamRow label="Length" value={`${params.length} m`} />
          <ParamRow label="Width" value={`${params.width} m`} />
          <ParamRow label="Height" value={`${params.height} m`} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <Warehouse className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Warehouse Viewer</h1>
            <p className="text-xs text-muted-foreground">Nano Warehouse Robot Map</p>
          </div>
        </div>
      </div>

      {/* Parameters (read-only) */}
      <div className="p-6 space-y-4">
        <h2 className="text-sm font-semibold text-accent uppercase tracking-wider">
          Warehouse Parameters
        </h2>

        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground text-xs py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading from API...
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-destructive text-xs py-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error} — using defaults</span>
          </div>
        )}

        <div className="bg-muted rounded-lg p-3 divide-y divide-border">
          <ParamRow label="Rows" value={String(params.rows)} />
          <ParamRow label="Racks per Row" value={String(params.racks)} />
          <ParamRow label="Deep" value={params.deep === 1 ? "1 (Single)" : "2 (Double)"} />
          <ParamRow label="Slots (Levels)" value={String(params.slotsPerRack)} />
          <ParamRow label="Length" value={`${params.length} m`} />
          <ParamRow label="Width" value={`${params.width} m`} />
          <ParamRow label="Height" value={`${params.height} m`} />
        </div>
      </div>
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted rounded-lg p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold font-mono text-foreground">{value}</p>
    </div>
  );
}
