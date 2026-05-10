import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

interface SortHeaderProps {
  label: string;
  sortKey: string;
  currentKey: string;
  currentDir: "asc" | "desc";
  onSort: (key: string) => void;
}

export function SortHeader({ label, sortKey, currentKey, currentDir, onSort }: SortHeaderProps) {
  const active = currentKey === sortKey;
  return (
    <th
      className="text-left p-3 font-medium cursor-pointer select-none hover:bg-gray-100 transition-colors"
      onClick={() => onSort(sortKey)}
    >
      <span className="flex items-center gap-1">
        {label}
        {active ? (
          currentDir === "asc" ? (
            <ChevronUp className="h-3.5 w-3.5 text-primary" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-primary" />
          )
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 text-gray-400 opacity-60" />
        )}
      </span>
    </th>
  );
}
