import { Wifi, ChevronDown, Check, Zap } from 'lucide-react'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
// Removed framer-motion from individual items to prevent freeze on large lists
import { motion } from 'framer-motion'

function ProxyGroup({ name, type, proxies, selected: currentSelected, onSelect, latencies, onTestGroup }: any) {
    const [isOpen, setIsOpen] = useState(false)
    const [testing, setTesting] = useState(false)

    const handleTestGroup = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (testing) return
        setTesting(true)
        try {
            await onTestGroup(name)
        } finally {
            setTesting(false)
        }
    }

    return (
        <div className="mb-6 rounded-2xl bg-card border border-border/50 overflow-hidden shadow-sm">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
            >
                <div className="flex items-center space-x-3">
                    <div className="w-1 h-4 bg-primary rounded-full transition-all group-hover:h-6" />
                    <h3 className="font-semibold text-lg">{name}</h3>
                    <span className="px-2 py-0.5 rounded-md bg-secondary text-xs text-muted-foreground font-mono">
                        {type}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">
                        {currentSelected}
                    </span>
                </div>
                <div className="flex items-center space-x-3">
                    <span className="text-xs text-muted-foreground">
                        {proxies.length} items
                    </span>
                    <button
                        onClick={handleTestGroup}
                        disabled={testing}
                        className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-primary disabled:opacity-50"
                        title="批量测速"
                    >
                        <Zap className={`w-4 h-4 ${testing ? 'animate-pulse text-yellow-500' : ''}`} />
                    </button>
                    <ChevronDown className={cn("w-5 h-5 transition-transform", isOpen ? "rotate-180" : "")} />
                </div>
            </button>

            {isOpen && (
                <div className="p-6 pt-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {proxies.slice(0, 100).map((proxyName: string) => { // Temporary limit to 100 to prevent freeze
                        const latency = latencies[proxyName]
                        let colorClass = "text-muted-foreground"
                        if (latency > 0) {
                            if (latency < 200) colorClass = "text-green-500"
                            else if (latency < 500) colorClass = "text-yellow-500"
                            else colorClass = "text-orange-500"
                        } else if (latency === -1) {
                            colorClass = "text-red-500"
                        }

                        return (
                            <div
                                key={proxyName}
                                onClick={() => onSelect(name, proxyName)}
                                className={cn(
                                    "relative p-4 rounded-xl border border-transparent transition-all duration-200 cursor-pointer group",
                                    currentSelected === proxyName
                                        ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20 scale-[1.02]"
                                        : "bg-secondary/50 hover:bg-secondary hover:scale-[1.02]"
                                )}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <span className="font-medium truncate pr-4 text-sm">{proxyName}</span>
                                    {currentSelected === proxyName && <Check className="w-4 h-4 flex-shrink-0" />}
                                </div>
                                <div className={cn(
                                    "flex items-center justify-end text-xs mt-2 font-mono",
                                    currentSelected === proxyName ? "text-primary-foreground/90" : colorClass
                                )}>
                                    <Wifi className="w-3 h-3 mr-1" />
                                    <span>{latency > 0 ? `${latency} ms` : (latency === -1 ? 'Timeout' : '-- ms')}</span>
                                </div>
                            </div>
                        )
                    })}
                    {proxies.length > 100 && (
                        <div className="flex items-center justify-center p-4 text-sm text-muted-foreground">
                            + {proxies.length - 100} more (Hidden for performance)
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

export default function Proxies() {
    const [groups, setGroups] = useState<any[]>([])
    const [latencies, setLatencies] = useState<Record<string, number>>({})
    const [testing, setTesting] = useState(false)

    const fetchProxies = async () => {
        try {
            const data = await window.ipcRenderer.invoke('proxy:list')
            if (data && data.proxies) {
                // Preserve existing latencies if available via history, but here we just manage local state
                // Actually kernel returns history in proxy object usually.

                const processed = Object.keys(data.proxies)
                    .filter(key => data.proxies[key].type === 'Selector' || data.proxies[key].type === 'URL-Test') // Re-enable filter for now to match UI expectations
                    .map(key => ({
                        ...data.proxies[key],
                        selected: data.proxies[key].now,
                        proxies: data.proxies[key].all
                    }))
                setGroups(processed)

                // Initialize latencies from history if empty? 
                // data.proxies[name].history = [{time, delay}, ...]
                // Let's do a quick sync map
                const newLatencies: any = {}
                Object.keys(data.proxies).forEach(key => {
                    const p = data.proxies[key]
                    if (p.history && p.history.length > 0) {
                        const last = p.history[p.history.length - 1]
                        if (last && last.delay > 0) newLatencies[key] = last.delay
                    }
                })
                setLatencies(prev => ({ ...newLatencies, ...prev })) // Merge
            }
        } catch (err) {
            console.error("Failed to fetch proxies:", err)
        }
    }

    useEffect(() => {
        fetchProxies()
        const interval = setInterval(fetchProxies, 3000)
        return () => clearInterval(interval)
    }, [])

    const handleSelect = async (group: string, name: string) => {
        setGroups(prev => prev.map(g => {
            if (g.name === group) return { ...g, selected: name }
            return g
        }))

        await window.ipcRenderer.invoke('proxy:select', { group, name })
        setTimeout(fetchProxies, 100)
    }

    const testLatency = async () => {
        if (testing) return
        setTesting(true)

        // Flatten all proxies from all visible groups
        // We only test actual proxies, not groups themselves if possible, but structure here is group -> proxyNames
        // We need to know which ones are actual nodes.
        // Simple approach: Iterate all groups' "all" list.

        const allProxyNames = new Set<string>()
        groups.forEach(g => {
            g.proxies.forEach((p: string) => allProxyNames.add(p))
        })

        const tasks = Array.from(allProxyNames).map(async (name) => {
            // We don't know the group for individual proxy delay test via our helper?
            // Actually our kernel.ts getProxyDelay takes (group, name)... wait.
            // Standard Clash API is /proxies/:name/delay. The Group param is ignored or used as context?
            // My kernel implementation: `getProxyDelay(group, name)` uses `name` in URL. `group` is unused. 
            // Good.

            // Initial "Testing..." state
            setLatencies(prev => ({ ...prev, [name]: 0 }))

            const res = await window.ipcRenderer.invoke('proxy:url-test', { group: 'Global', name })
            if (res && typeof res.delay === 'number') {
                setLatencies(prev => ({ ...prev, [name]: res.delay }))
            }
        })

        await Promise.all(tasks)
        setTesting(false)
    }

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="flex-1 h-full p-8 overflow-y-auto no-drag"
        >
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight mb-2">代理</h1>
                    <p className="text-muted-foreground">管理你的代理组与节点策略</p>
                </div>
                <button
                    onClick={testLatency}
                    disabled={testing}
                    className={cn(
                        "flex items-center px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-all",
                        testing ? "opacity-70 cursor-wait" : "hover:opacity-90"
                    )}
                >
                    <Zap className={cn("w-4 h-4 mr-2", testing ? "animate-spin" : "")} />
                    {testing ? "测试中..." : "测试延迟"}
                </button>
            </div>

            {groups.length === 0 ? (
                <div className="text-center text-muted-foreground p-10 flex flex-col items-center">
                    <Zap className="w-10 h-10 mb-4 opacity-20" />
                    <p>未找到代理组</p>
                    <p className="text-sm">请确保已导入配置且内核正在运行</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {groups.map(group => (
                        <ProxyGroup
                            key={group.name}
                            {...group}
                            latencies={latencies}
                            onSelect={handleSelect}
                            onTestGroup={async (groupName: string) => {
                                // Use group delay test API
                                const results = await window.ipcRenderer.invoke('proxies:testGroup', groupName)
                                if (results && typeof results === 'object') {
                                    setLatencies(prev => ({ ...prev, ...results }))
                                }
                            }}
                        />
                    ))}
                </div>
            )}
        </motion.div>
    )
}
