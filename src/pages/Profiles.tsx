import { FileCode, Download, RefreshCw, Plus, Trash2, FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface Profile {
    id: string
    name: string
    url: string
    active: boolean
    updated: number
}

export default function Profiles() {
    const [profiles, setProfiles] = useState<Profile[]>([])
    const [loading, setLoading] = useState(false)
    const [importUrl, setImportUrl] = useState('')
    const [isAdding, setIsAdding] = useState(false)

    const loadProfiles = async () => {
        const data = await window.ipcRenderer.invoke('profile:list')
        setProfiles(data || [])
    }

    useEffect(() => {
        loadProfiles()
    }, [])

    const handleImportFile = async () => {
        const res = await window.ipcRenderer.invoke('profile:import-file')
        if (res) setProfiles(res)
    }

    const handleImportUrl = async () => {
        if (!importUrl) return
        setLoading(true)
        try {
            const res = await window.ipcRenderer.invoke('profile:add', importUrl)
            if (res) {
                setProfiles(res)
                setIsAdding(false)
                setImportUrl('')
            }
        } finally {
            setLoading(false)
        }
    }

    const handleSelect = async (id: string) => {
        const res = await window.ipcRenderer.invoke('profile:update', { id, data: { active: true } })
        if (res) setProfiles(res)
    }

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation()
        if (confirm('Are you sure you want to delete this profile?')) {
            const res = await window.ipcRenderer.invoke('profile:delete', id)
            if (res) setProfiles(res)
        }
    }

    return (
        <div className="flex-1 h-full p-8 overflow-y-auto no-drag">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight mb-2">Profiles</h1>
                    <p className="text-muted-foreground">Manage your subscription links and local configs</p>
                </div>
                <div className="flex space-x-2">
                    <button
                        onClick={handleImportFile}
                        className="flex items-center px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium hover:opacity-80 transition-opacity"
                    >
                        <FolderOpen className="w-4 h-4 mr-2" />
                        Local
                    </button>
                    <button
                        onClick={() => setIsAdding(!isAdding)}
                        className="flex items-center px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
                    >
                        <Plus className={`w-4 h-4 mr-2 transition-transform ${isAdding ? 'rotate-45' : ''}`} />
                        {isAdding ? 'Cancel' : 'Import URL'}
                    </button>
                </div>
            </div>

            {isAdding && (
                <div className="mb-8 p-6 rounded-xl bg-card border border-border animate-accordion-down">
                    <h3 className="font-semibold mb-4">Import from URL</h3>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder="https://example.com/subscribe/..."
                            className="flex-1 px-4 py-2 rounded-lg bg-secondary border-transparent focus:border-primary focus:ring-0 outline-none transition-all"
                            value={importUrl}
                            onChange={(e) => setImportUrl(e.target.value)}
                        />
                        <button
                            onClick={handleImportUrl}
                            disabled={loading || !importUrl}
                            className="px-6 py-2 rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-50"
                        >
                            {loading ? 'Importing...' : 'Import'}
                        </button>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {profiles.map((profile) => (
                    <div
                        key={profile.id}
                        onClick={() => handleSelect(profile.id)}
                        className={cn(
                            "p-6 rounded-xl border transition-all duration-200 group cursor-pointer relative overflow-hidden",
                            profile.active
                                ? "bg-primary/5 border-primary/50 shadow-sm"
                                : "bg-card border-border/50 hover:border-primary/30"
                        )}
                    >
                        <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center space-x-3">
                                <div className={cn("p-2 rounded-lg transition-colors", profile.active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground')}>
                                    <FileCode className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="font-semibold">{profile.name}</h3>
                                    <p className="text-xs text-muted-foreground max-w-[200px] truncate">{profile.url}</p>
                                </div>
                            </div>
                            {profile.active && (
                                <span className="px-2 py-1 rounded-full bg-green-500/10 text-green-500 text-xs font-medium animate-in fade-in zoom-in">
                                    Active
                                </span>
                            )}
                        </div>

                        <div className="flex items-center justify-between mt-4">
                            <span className="text-xs text-muted-foreground">Updated {new Date(profile.updated).toLocaleString()}</span>
                            <div className="flex space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    className="p-2 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                                    title="Update"
                                >
                                    <RefreshCw className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={(e) => handleDelete(e, profile.id)}
                                    className="p-2 rounded-md hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                                    title="Delete"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Active Indicator Bar */}
                        {profile.active && (
                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
                        )}
                    </div>
                ))}

                {profiles.length === 0 && !isAdding && (
                    <div className="col-span-full py-12 text-center text-muted-foreground border border-dashed border-border/50 rounded-xl">
                        <p>No profiles found.</p>
                        <p className="text-sm">Import a YAML config to get started.</p>
                    </div>
                )}
            </div>
        </div>
    )
}
