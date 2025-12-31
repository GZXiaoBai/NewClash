import { AlertCircle, Info, Bug, Terminal } from 'lucide-react'
import { useEffect, useState, useRef } from 'react'

interface LogEntry {
    type: string
    payload: string
    time: string
}

export default function Logs() {
    const [logs, setLogs] = useState<LogEntry[]>([])
    const bottomRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const cleanup = window.ipcRenderer.on('core:logs', (_event, log) => {
            setLogs(prev => [...prev.slice(-200), log]) // Keep last 200 logs
        })
        return cleanup
    }, [])

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [logs])

    const getIcon = (level: string) => {
        switch (level) {
            case 'info': return <Info className="w-4 h-4 text-blue-500" />
            case 'warning': return <AlertCircle className="w-4 h-4 text-yellow-500" />
            case 'error': return <Bug className="w-4 h-4 text-red-500" />
            case 'debug': return <Terminal className="w-4 h-4 text-muted-foreground" />
            default: return <Info className="w-4 h-4" />
        }
    }

    return (
        <div className="flex-1 h-full flex flex-col no-drag bg-card">
            <div className="px-6 py-4 border-b border-border bg-card sticky top-0 flex items-center justify-between">
                <h1 className="text-lg font-semibold tracking-tight text-foreground">Logs</h1>
                <div className="text-xs text-muted-foreground">{logs.length} entries</div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-1 font-mono text-sm max-h-[calc(100vh-100px)]">
                {logs.map((log, i) => (
                    <div key={i} className="flex items-start space-x-3 hover:bg-muted/50 p-1 rounded group">
                        <span className="text-muted-foreground select-none text-xs w-20">[{log.time}]</span>
                        <span className="pt-0.5">{getIcon(log.type)}</span>
                        <span className={`flex-1 break-all ${log.type === 'error' ? 'text-red-500' :
                            log.type === 'warning' ? 'text-yellow-500' : 'text-foreground'
                            }`}>
                            <span className="font-bold opacity-50 mr-2 uppercase text-xs tracking-wider">[{log.type}]</span>
                            {log.payload}
                        </span>
                    </div>
                ))}
                <div ref={bottomRef} />

                {logs.length === 0 && (
                    <div className="text-center text-muted-foreground py-10 opacity-50">
                        Waiting for kernel logs...
                    </div>
                )}
            </div>
        </div>
    )
}
