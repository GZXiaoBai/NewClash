import { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Activity, X, ArrowUp, ArrowDown, Search, PauseCircle, PlayCircle, Trash2 } from 'lucide-react'

// Helper for Bytes formatting
function formatBytes(bytes: number, decimals = 1) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

interface Connection {
    id: string;
    metadata: {
        network: string;
        type: string;
        sourceIP: string;
        destinationIP: string;
        sourcePort: string;
        destinationPort: string;
        host: string;
        processPath?: string;
    };
    upload: number;
    download: number;
    start: string; // ISO string
    chains: string[];
    rule: string;
    rulePayload: string;
}

export default function Connections() {
    const [connections, setConnections] = useState<Connection[]>([])
    const [filter, setFilter] = useState('')
    const [isPaused, setIsPaused] = useState(false)

    useEffect(() => {
        const fetchConnections = async () => {
            if (isPaused) return;
            try {
                const data = await window.ipcRenderer.invoke('connection:list');
                if (data && data.connections) {
                    // Sort by most recent? or implementation choice.
                    // Clash usually returns them somewhat sorted.
                    // Let's sort by start time descending (newest first)
                    const sorted = (data.connections as Connection[]).sort((a, b) =>
                        new Date(b.start).getTime() - new Date(a.start).getTime()
                    );
                    setConnections(sorted);
                }
            } catch (e) {
                console.error('Failed to fetch connections', e);
            }
        };

        const interval = setInterval(fetchConnections, 1000);
        fetchConnections(); // Initial fetch
        return () => clearInterval(interval);
    }, [isPaused]);

    const closeConnection = async (id: string) => {
        await window.ipcRenderer.invoke('connection:close', id);
        // Optimistic update
        setConnections(prev => prev.filter(c => c.id !== id));
    };

    const closeAll = async () => {
        await window.ipcRenderer.invoke('connection:close-all');
        setConnections([]);
    };

    const filteredConnections = useMemo(() => {
        if (!filter) return connections;
        const lower = filter.toLowerCase();
        return connections.filter(c =>
            c.metadata.host.toLowerCase().includes(lower) ||
            c.metadata.destinationIP.includes(lower) ||
            c.chains.some(chain => chain.toLowerCase().includes(lower))
        );
    }, [connections, filter]);

    // Calculate totals for header
    const totalUpload = connections.reduce((acc, curr) => acc + curr.upload, 0);
    const totalDownload = connections.reduce((acc, curr) => acc + curr.download, 0);

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="flex-1 h-full flex flex-col p-6 overflow-hidden no-drag"
        >
            {/* Header / Toolbar */}
            <div className="flex items-center justify-between mb-6 flex-shrink-0">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        连接
                        <span className="text-sm font-normal text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                            {connections.length}
                        </span>
                    </h1>
                    <div className="flex gap-4 text-sm text-muted-foreground mt-1">
                        <span className="flex items-center"><ArrowUp className="w-3 h-3 mr-1" /> {formatBytes(totalUpload)}</span>
                        <span className="flex items-center"><ArrowDown className="w-3 h-3 mr-1" /> {formatBytes(totalDownload)}</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="筛选主机、IP..."
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            className="pl-9 pr-4 py-1.5 bg-secondary/50 rounded-lg text-sm outline-none focus:ring-1 focus:ring-primary w-64 transition-all"
                        />
                    </div>

                    <button
                        onClick={() => setIsPaused(!isPaused)}
                        className="p-2 hover:bg-secondary rounded-lg transition-colors text-muted-foreground hover:text-foreground"
                        title={isPaused ? "Resume Refresh" : "Pause Refresh"}
                    >
                        {isPaused ? <PlayCircle className="w-5 h-5" /> : <PauseCircle className="w-5 h-5" />}
                    </button>

                    <button
                        onClick={closeAll}
                        className="p-2 hover:bg-red-500/10 hover:text-red-500 rounded-lg transition-colors text-muted-foreground"
                        title="Close All Connections"
                    >
                        <Trash2 className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-thin">
                <AnimatePresence initial={false}>
                    {filteredConnections.map(conn => {
                        const host = conn.metadata.host || conn.metadata.destinationIP;

                        return (
                            <motion.div
                                key={conn.id}
                                layout
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="bg-card/50 border border-border/40 rounded-xl p-3 hover:bg-card transition-colors group relative"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider
                                                ${conn.metadata.network === 'tcp' ? 'bg-blue-500/10 text-blue-500' : 'bg-orange-500/10 text-orange-500'}
                                            `}>
                                                {conn.metadata.network}
                                            </span>
                                            <div className="font-medium truncate text-sm" title={host}>{host}</div>
                                            <span className="text-xs text-muted-foreground ml-auto pr-8">
                                                {new Date(conn.start).toLocaleTimeString()}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <div className="flex items-center gap-1 bg-secondary/50 px-2 py-0.5 rounded-md truncate max-w-[200px]" title={conn.chains.join(' → ')}>
                                                <Activity className="w-3 h-3" />
                                                {conn.chains.length > 0 ? conn.chains[conn.chains.length - 1] : 'Direct'}
                                            </div>

                                            <div className="flex items-center gap-3 ml-2">
                                                <span className="flex items-center"><ArrowUp className="w-3 h-3 mr-0.5" /> {formatBytes(conn.upload)}</span>
                                                <span className="flex items-center"><ArrowDown className="w-3 h-3 mr-0.5" /> {formatBytes(conn.download)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => closeConnection(conn.id)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-2 hover:bg-red-500/10 text-red-500 rounded-lg transition-all"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            </motion.div>
                        )
                    })}
                </AnimatePresence>

                {filteredConnections.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-50 pt-20">
                        <Activity className="w-12 h-12 mb-3" />
                        <p>No active connections</p>
                    </div>
                )}
            </div>
        </motion.div>
    )
}
