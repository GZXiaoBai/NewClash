import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Download, RefreshCw, Check, AlertCircle, Cpu } from 'lucide-react'

interface CoreVersion {
    tag: string
    name: string
    published: string
    isPrerelease: boolean
}

export default function CoreManager() {
    const [currentVersion, setCurrentVersion] = useState('Loading...')
    const [versions, setVersions] = useState<CoreVersion[]>([])
    const [loading, setLoading] = useState(false)
    const [installing, setInstalling] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        loadData()
    }, [])

    const loadData = async () => {
        setLoading(true)
        setError(null)
        try {
            const [version, availableVersions] = await Promise.all([
                window.ipcRenderer.invoke('core:version'),
                window.ipcRenderer.invoke('core:versions')
            ])
            setCurrentVersion(version)
            setVersions(availableVersions)
        } catch (e: any) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }

    const handleInstall = async (version: string) => {
        if (installing) return

        if (!confirm(`确定要安装内核版本 ${version} 吗？\n安装过程中代理将暂时中断。`)) {
            return
        }

        setInstalling(version)
        setError(null)

        try {
            const result = await window.ipcRenderer.invoke('core:install', version)
            if (result.success) {
                setCurrentVersion(version)
                alert(`内核 ${version} 安装成功！`)
            } else {
                setError(result.error || 'Installation failed')
            }
        } catch (e: any) {
            setError(e.message)
        } finally {
            setInstalling(null)
        }
    }

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        })
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
                    <h1 className="text-3xl font-bold tracking-tight mb-2">内核管理</h1>
                    <p className="text-muted-foreground">管理 Mihomo 内核版本</p>
                </div>
                <button
                    onClick={loadData}
                    disabled={loading}
                    className="flex items-center px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium hover:opacity-80 transition-opacity disabled:opacity-50"
                >
                    <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                    刷新
                </button>
            </div>

            <div className="space-y-6 max-w-3xl">
                {/* Current Version Card */}
                <div className="bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 rounded-xl p-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                            <div className="p-3 bg-primary/20 rounded-lg">
                                <Cpu className="w-6 h-6 text-primary" />
                            </div>
                            <div>
                                <div className="text-sm text-muted-foreground">当前版本</div>
                                <div className="text-2xl font-bold">{currentVersion}</div>
                            </div>
                        </div>
                        {currentVersion !== 'Not Installed' && versions[0] && currentVersion !== versions[0]?.tag && (
                            <div className="flex items-center text-yellow-500">
                                <AlertCircle className="w-4 h-4 mr-1" />
                                <span className="text-sm">有新版本可用</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Error Alert */}
                {error && (
                    <div className="bg-destructive/10 border border-destructive/30 text-destructive rounded-lg p-4 flex items-center">
                        <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {/* Version List */}
                <div className="bg-card border border-border/50 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 bg-secondary/30 border-b border-border/50">
                        <h3 className="font-medium">可用版本</h3>
                    </div>

                    {loading && versions.length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground">
                            <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin opacity-50" />
                            加载中...
                        </div>
                    ) : versions.length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground">
                            无法获取版本列表
                        </div>
                    ) : (
                        <div className="divide-y divide-border/50 max-h-96 overflow-y-auto">
                            {versions.map((v) => (
                                <div
                                    key={v.tag}
                                    className="p-4 flex items-center justify-between hover:bg-secondary/20 transition-colors"
                                >
                                    <div className="flex items-center space-x-3">
                                        <div>
                                            <div className="font-medium flex items-center">
                                                {v.tag}
                                                {v.isPrerelease && (
                                                    <span className="ml-2 px-2 py-0.5 text-xs bg-yellow-500/20 text-yellow-500 rounded">
                                                        Pre-release
                                                    </span>
                                                )}
                                                {currentVersion === v.tag && (
                                                    <span className="ml-2 px-2 py-0.5 text-xs bg-green-500/20 text-green-500 rounded flex items-center">
                                                        <Check className="w-3 h-3 mr-1" />
                                                        已安装
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-sm text-muted-foreground">
                                                {formatDate(v.published)}
                                            </div>
                                        </div>
                                    </div>

                                    {currentVersion !== v.tag && (
                                        <button
                                            onClick={() => handleInstall(v.tag)}
                                            disabled={!!installing}
                                            className="flex items-center px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                                        >
                                            {installing === v.tag ? (
                                                <>
                                                    <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
                                                    安装中...
                                                </>
                                            ) : (
                                                <>
                                                    <Download className="w-4 h-4 mr-1.5" />
                                                    安装
                                                </>
                                            )}
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Info */}
                <div className="text-sm text-muted-foreground text-center">
                    内核由 <a href="https://github.com/MetaCubeX/mihomo" target="_blank" className="text-primary hover:underline">MetaCubeX/mihomo</a> 提供
                </div>
            </div>
        </motion.div>
    )
}
