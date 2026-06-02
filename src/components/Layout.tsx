import { NavLink, Outlet } from "react-router-dom";
import { LayoutDashboard, Building2, KeyRound, PlaySquare, Settings, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Empresas", href: "/companies", icon: Building2 },
  { name: "Certificados", href: "/certificates", icon: KeyRound },
  { name: "Automações (RPA)", href: "/macros", icon: PlaySquare },
  { name: "Execução Ao Vivo", href: "/execution", icon: Activity },
];

export default function Layout() {
  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 font-sans overflow-hidden relative">
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-600/20 blur-[120px] rounded-full"></div>
      </div>

      {/* Sidebar */}
      <div className="w-64 backdrop-blur-md bg-white/5 border-r border-white/10 flex flex-col z-10 relative">
        <div className="flex px-6 h-16 items-center border-b border-white/10">
          <div className="w-8 h-8 bg-indigo-500 rounded flex items-center justify-center mr-3 shadow-lg shadow-indigo-500/20">
             <Activity className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-xl tracking-tight text-white">Auto<span className="text-indigo-400">Sync</span></span>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {navigation.map((item) => (
            <NavLink
              key={item.name}
              to={item.href}
              className={({ isActive }) =>
                cn(
                  isActive
                    ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30"
                    : "text-slate-400 hover:bg-white/5 hover:text-white border border-transparent",
                  "group flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    className={cn(
                      isActive ? "text-indigo-400" : "text-slate-500 group-hover:text-slate-300",
                      "flex-shrink-0 -ml-1 mr-3 h-5 w-5"
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate">{item.name}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden z-10 relative">
        <main className="flex-1 overflow-y-auto p-8 relative">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
