import { ArrowDown, ArrowUp, Zap, Activity, Cpu } from 'lucide-react'
import { useEffect, useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

function StatusCard({ title, value, icon: Icon, colorClass, index, subValue }: any) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="group relative p-5 rounded-3xl bg-card/60 backdrop-blur-xl border border-border shadow-xl overflow-hidden"
        >
            {/* Ambient Background Glow */}
            <div className={`absolute -right-4 -top-4 w-24 h-24 bg-gradient-to-br ${colorClass.replace('text-', 'from-').split(' ')[0]} to-transparent opacity-20 blur-2xl group-hover:opacity-40 transition-opacity duration-500`} />

            <div className="flex items-center justify-between mb-4 relative z-10">
                <div className="flex items-center gap-2">
                    <div className={cn("p-2.5 rounded-xl bg-muted/50 border border-border shadow-inner backdrop-blur-md", colorClass.replace('from-', 'text-').split(' ')[0])}>
                        <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
                </div>
            </div>

            <div className="relative z-10">
                <div className="text-2xl font-bold tracking-tight font-mono mb-1 text-foreground drop-shadow-sm">{value}</div>
                {subValue && (
                    <div className="text-[10px] text-muted-foreground/60 font-mono uppercase tracking-widest">
                        {subValue}
                    </div>
                )}
            </div>
        </motion.div>
    )
}

function formatSpeed(bytes: number) {
    if (bytes < 1024) return `${bytes} B/s`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB/s`
}

function formatTotal(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatMemory(bytes: number) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function Dashboard() {
    const [stats, setStats] = useState({ up: 0, down: 0 })
    const [total, setTotal] = useState({ up: 0, down: 0 })
    const [memory, setMemory] = useState(0)
    const [history, setHistory] = useState<{ up: number, down: number }[]>(Array(60).fill({ up: 0, down: 0 }))

    useEffect(() => {
        const cleanupStats = window.ipcRenderer.on('core:stats', (_event, data) => {
            setStats(data)
            setTotal(prev => ({
                up: prev.up + data.up,
                down: prev.down + data.down
            }))
            setHistory(prev => {
                const newHistory = [...prev.slice(1), { up: data.up, down: data.down }]
                return newHistory
            })
        })

        const cleanupMemory = window.ipcRenderer.on('core:memory', (_event, data) => {
            if (data && typeof data.inuse === 'number') {
                setMemory(data.inuse)
            }
        })

        return () => {
            cleanupStats()
            cleanupMemory()
        }
    }, [])

    // Generate SVG path for graph
    const GraphPath = ({ data, max }: any) => {
        if (!data.length) return "";

        const width = 100; // percent
        const step = width / (data.length - 1);

        const points = data.map((val: number, i: number) => {
            const x = i * step;
            const normalizedY = max > 0 ? (val / max) : 0;
            const y = 100 - (normalizedY * 90); // Leave 10% bottom padding
            return [x, y];
        });

        let d = `M 0,100 `;
        points.forEach((p: number[]) => {
            d += `L ${p[0]},${p[1]} `;
        });
        d += `L 100,100 Z`;

        return d;
    }

    const downloadMax = useMemo(() => Math.max(...history.map(h => h.down), 1024 * 100), [history]);

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="flex-1 h-full p-8 overflow-y-auto no-drag relative"
        >
            <div className="max-w-6xl mx-auto space-y-8">
                <div className="flex items-end justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-foreground to-foreground/50">概览</h1>
                        <p className="text-muted-foreground mt-1">系统状态与实时流量监控</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                    <StatusCard
                        index={0}
                        title="实时下载"
                        value={formatSpeed(stats.down)}
                        subValue="Current Download"
                        icon={ArrowDown}
                        colorClass="text-emerald-400"
                    />
                    <StatusCard
                        index={1}
                        title="实时上传"
                        value={formatSpeed(stats.up)}
                        subValue="Current Upload"
                        icon={ArrowUp}
                        colorClass="text-blue-400"
                    />
                    <StatusCard
                        index={2}
                        title="总下载量"
                        value={formatTotal(total.down)}
                        subValue="Total Traffic"
                        icon={Activity}
                        colorClass="text-violet-400"
                    />
                    <StatusCard
                        index={3}
                        title="总上传量"
                        value={formatTotal(total.up)}
                        subValue="Total Traffic"
                        icon={Zap}
                        colorClass="text-orange-400"
                    />
                    <StatusCard
                        index={4}
                        title="内存占用"
                        value={formatMemory(memory)}
                        subValue="Kernel Memory"
                        icon={Cpu}
                        colorClass="text-pink-400"
                    />
                </div>

                {/* Main Graph Card */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="w-full h-80 rounded-3xl bg-card/30 backdrop-blur-xl border border-white/5 p-1 shadow-inner relative overflow-hidden group"
                >
                    <div className="absolute inset-0 bg-background/40 z-0" />

                    {/* Header */}
                    <div className="absolute top-6 left-6 z-20">
                        <h3 className="text-base font-medium flex items-center gap-2">
                            <Activity className="w-4 h-4 text-primary" />
                            流量趋势
                        </h3>
                    </div>

                    {/* SVG Chart */}
                    <div className="absolute inset-0 pt-16 pb-0 px-0 z-10 w-full h-full">
                        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full opacity-90">
                            <defs>
                                <linearGradient id="gradDown" x1="0%" y1="0%" x2="0%" y2="100%">
                                    <stop offset="0%" style={{ stopColor: 'rgb(34, 197, 94)', stopOpacity: 0.2 }} />
                                    <stop offset="100%" style={{ stopColor: 'rgb(34, 197, 94)', stopOpacity: 0 }} />
                                </linearGradient>
                            </defs>

                            {/* Download Area */}
                            <path
                                d={GraphPath({ data: history.map(h => h.down), max: downloadMax })}
                                fill="url(#gradDown)"
                                stroke="rgb(34, 197, 94)"
                                strokeWidth="0.5"
                                vectorEffect="non-scaling-stroke"
                                className="transition-all duration-300 ease-linear"
                            />
                        </svg>
                    </div>
                </motion.div>
            </div>
        </motion.div>
    )
}
