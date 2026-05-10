import { NavLink } from "react-router-dom";
import {
  BookOpen,
  Users,
  GraduationCap,
  CalendarDays,
  Settings,
  LayoutGrid,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutGrid, end: true },
  { to: "/subjects", label: "Fächer", icon: BookOpen },
  { to: "/teachers", label: "Lehrkräfte", icon: Users },
  { to: "/classes", label: "Klassen", icon: GraduationCap },
  { to: "/timetable", label: "Stundenplan", icon: CalendarDays },
  { to: "/settings", label: "Einstellungen", icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="flex h-full w-56 flex-col border-r border-gray-200 bg-white shadow-sm">
      <div className="flex h-14 items-center gap-2.5 border-b border-gray-200 px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
          <CalendarDays className="h-4 w-4 text-white" />
        </div>
        <span className="font-semibold text-sm tracking-tight text-gray-900">Stundenplaner</span>
      </div>
      <nav className="flex flex-col gap-0.5 p-3 flex-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 cursor-pointer",
                isActive
                  ? "bg-primary text-white shadow-sm"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  className={cn("h-4 w-4 shrink-0", isActive ? "text-white" : "text-gray-400")}
                />
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-gray-200 px-4 py-3">
        <p className="text-xs text-gray-400">v0.1.0</p>
      </div>
    </aside>
  );
}
