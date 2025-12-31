import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { Activity, Globe, Settings, LayoutDashboard, FileCode, ScrollText, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Sidebar() {
    const [mode, setModeState] = useState('rule')

    useEffect(() => {
        window.ipcRenderer.invoke('mode:get').then(setModeState)
    }, [])

    const setMode = async (m: string) => {
        setModeState(m)
        await window.ipcRenderer.invoke('mode:set', m)
    }

    const navItems = [
        { icon: LayoutDashboard, label: '概览', path: '/' },
        { icon: Globe, label: '代理', path: '/proxies' },
        { icon: FileCode, label: '配置', path: '/profiles' },
        { icon: ScrollText, label: '日志', path: '/logs' },
        { icon: Activity, label: '连接', path: '/connections' },
        { icon: Settings, label: '设置', path: '/settings' },
    ]

    return (
        <div className="w-72 h-full flex flex-col pt-6 pb-6 select-none relative z-20">
            {/* Glass Background Layer */}
            <div className="absolute inset-0 bg-background/60 backdrop-blur-2xl border-r border-white/5" />

            {/* Content */}
            <div className="relative z-10 flex flex-col h-full px-4">
                {/* Header */}
                <div className="px-4 mb-8 pt-4 flex items-center space-x-3 no-drag">
                    <div className="w-9 h-9 bg-primary/20 rounded-xl flex items-center justify-center shadow-inner ring-1 ring-white/10 text-primary">
                        <Globe className="w-5 h-5" />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-foreground/90 leading-none">
                            NewClash
                        </h1>
                        <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider opacity-70">
                            Premium Core
                        </span>
                    </div>
                </div>

                {/* Mode Switcher - Refined */}
                <div className="px-2 mb-8 no-drag">
                    <div className="bg-black/20 p-1.5 rounded-2xl border border-white/5 flex items-center shadow-inner">
                        {['rule', 'global', 'direct'].map((m) => {
                            const activeGradient = m === 'rule'
                                ? 'from-blue-600 to-indigo-600'
                                : m === 'global'
                                    ? 'from-purple-600 to-pink-600'
                                    : 'from-emerald-500 to-teal-600'

                            const activeShadow = m === 'rule'
                                ? 'shadow-blue-500/25'
                                : m === 'global'
                                    ? 'shadow-purple-500/25'
                                    : 'shadow-emerald-500/25'

                            return (
                                <button
                                    key={m}
                                    onClick={() => setMode(m)}
                                    className={cn(
                                        "flex-1 py-2 text-xs font-bold rounded-xl transition-all duration-300 relative overflow-hidden",
                                        mode === m
                                            ? `text-white shadow-lg ${activeShadow}`
                                            : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                                    )}
                                >
                                    {mode === m && (
                                        <div className={`absolute inset-0 bg-gradient-to-r ${activeGradient} opacity-100 -z-10 rounded-xl`} />
                                    )}
                                    {m === 'rule' ? '规则' : m === 'global' ? '全局' : '直连'}
                                </button>
                            )
                        })}
                    </div>
                </div>

                {/* Navigation */}
                <nav className="flex-1 space-y-2 no-drag px-2">
                    {navItems.map((item) => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            className={({ isActive }) =>
                                cn(
                                    "flex items-center px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300 group relative overflow-hidden",
                                    isActive
                                        ? "text-white shadow-lg shadow-indigo-500/20"
                                        : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                                )
                            }
                        >
                            {({ isActive }) => (
                                <>
                                    {isActive && (
                                        <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-blue-600 opacity-90 -z-10" />
                                    )}
                                    <item.icon className={cn("w-5 h-5 mr-3 transition-transform duration-300 group-hover:scale-110", isActive ? "text-white" : "text-muted-foreground group-hover:text-indigo-400")} />
                                    <span>{item.label}</span>
                                    {isActive && <div className="absolute right-3 w-1.5 h-1.5 bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.8)]" />}
                                </>
                            )}
                        </NavLink>
                    ))}
                </nav>

                {/* Footer Status */}
                <div className="px-2 mt-auto no-drag">
                    <div className="p-4 rounded-2xl bg-gradient-to-tr from-primary/10 via-background/40 to-transparent border border-white/5 backdrop-blur-md">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <span className="flex h-2 w-2 relative">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                </span>
                                <span className="text-xs font-semibold text-primary/80 tracking-wide">SYSTEM ONLINE</span>
                            </div>
                            <Zap className="w-3 h-3 text-yellow-500/80" />
                        </div>
                        <div className="flex justify-between items-end">
                            <div className="text-[10px] text-muted-foreground/60 font-mono">
                                v1.18.0
                            </div>
                            <div className="text-[10px] text-muted-foreground/60 font-mono uppercase">
                                Mihomo
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
