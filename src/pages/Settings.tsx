import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Globe, Monitor } from 'lucide-react'

// Simple Switch Component
function SimpleSwitch({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (c: boolean) => void }) {
    return (
        <button
            className={`w-11 h-6 rounded-full transition-colors relative ${checked ? 'bg-primary' : 'bg-slate-200 dark:bg-slate-700'}`}
            onClick={() => onCheckedChange(!checked)}
        >
            <div className={`w-5 h-5 bg-white rounded-full shadow-sm transition-transform absolute top-0.5 left-0.5 ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
    )
}

export default function Settings() {
    const [settings, setSettings] = useState({
        mixedPort: 7892,
        allowLan: false,
        theme: 'dark',
        systemProxy: false,
        tunMode: false,
        closeToTray: true
    })
    const [autoStart, setAutoStart] = useState(false)

    useEffect(() => {
        window.ipcRenderer.invoke('settings:get').then(setSettings)
        window.ipcRenderer.invoke('autostart:check').then(setAutoStart)
    }, [])

    const updateSetting = (key: string, value: any) => {
        const newSettings = { ...settings, [key]: value }
        setSettings(newSettings)
        window.ipcRenderer.invoke('settings:set', { [key]: value })

        if (key === 'theme') {
            const root = window.document.documentElement
            root.classList.remove('light', 'dark')
            root.classList.add(value)
        }
    }

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="flex-1 h-full p-8 overflow-y-auto no-drag"
        >
            <div className="mb-8">
                <h1 className="text-3xl font-bold tracking-tight mb-2">设置</h1>
                <p className="text-muted-foreground">配置客户端偏好设置</p>
            </div>

            <div className="space-y-8 max-w-2xl">
                {/* Network */}
                <section>
                    <h3 className="text-lg font-medium mb-4 flex items-center">
                        <Globe className="w-5 h-5 mr-2 text-primary" />
                        网络设置
                    </h3>
                    <div className="bg-card border border-border/50 rounded-xl overflow-hidden divide-y divide-border/50">
                        <div className="p-4 flex items-center justify-between">
                            <div>
                                <div className="font-medium">系统代理 (System Proxy)</div>
                                <div className="text-sm text-muted-foreground">自动设置系统 HTTP/SOCKS 代理</div>
                            </div>
                            <SimpleSwitch
                                checked={settings.systemProxy}
                                onCheckedChange={(c) => updateSetting('systemProxy', c)}
                            />
                        </div>
                        <div className="p-4 flex items-center justify-between">
                            <div>
                                <div className="font-medium">TUN 模式 (Experimental)</div>
                                <div className="text-sm text-muted-foreground">创建虚拟网卡接管所有流量 (需 Root 权限)</div>
                            </div>
                            <SimpleSwitch
                                checked={settings.tunMode}
                                onCheckedChange={(c) => updateSetting('tunMode', c)}
                            />
                        </div>
                        <div className="p-4 flex items-center justify-between">
                            <div>
                                <div className="font-medium">混合端口 (Mixed Port)</div>
                                <div className="text-sm text-muted-foreground">HTTP(S) & SOCKS5 混合端口</div>
                            </div>
                            <input
                                type="number"
                                value={settings.mixedPort}
                                onChange={(e) => updateSetting('mixedPort', parseInt(e.target.value))}
                                className="w-24 px-3 py-1.5 rounded-md bg-secondary text-right outline-none focus:ring-1 focus:ring-primary transition-all"
                            />
                        </div>
                        <div className="p-4 flex items-center justify-between">
                            <div>
                                <div className="font-medium">允许局域网连接 (Allow LAN)</div>
                                <div className="text-sm text-muted-foreground">允许其他设备通过 IP 连接代理</div>
                            </div>
                            <SimpleSwitch
                                checked={settings.allowLan}
                                onCheckedChange={(c) => updateSetting('allowLan', c)}
                            />
                        </div>
                    </div>
                </section>

                {/* Application */}
                <section>
                    <h3 className="text-lg font-medium mb-4 flex items-center">
                        <Monitor className="w-5 h-5 mr-2 text-primary" />
                        应用设置
                    </h3>
                    <div className="bg-card border border-border/50 rounded-xl overflow-hidden divide-y divide-border/50">
                        <div className="p-4 flex items-center justify-between">
                            <div>
                                <div className="font-medium">主题外观</div>
                                <div className="text-sm text-muted-foreground">切换深色或浅色模式</div>
                            </div>
                            <select
                                value={settings.theme}
                                onChange={(e) => updateSetting('theme', e.target.value)}
                                className="px-3 py-1.5 rounded-md bg-secondary outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                            >
                                <option value="dark">🌙 深色模式</option>
                                <option value="light">☀️ 浅色模式</option>
                                <option value="system">🖥️ 跟随系统</option>
                            </select>
                        </div>
                        <div className="p-4 flex items-center justify-between">
                            <div>
                                <div className="font-medium">关闭时最小化到托盘</div>
                                <div className="text-sm text-muted-foreground">关闭窗口时保持程序在后台运行</div>
                            </div>
                            <SimpleSwitch
                                checked={settings.closeToTray ?? true}
                                onCheckedChange={(c) => {
                                    updateSetting('closeToTray', c)
                                    updateSetting('closeToTrayAsked', true) // Mark as user explicitly set
                                }}
                            />
                        </div>
                        <div className="p-4 flex items-center justify-between">
                            <div>
                                <div className="font-medium">开机自动启动</div>
                                <div className="text-sm text-muted-foreground">登录系统时自动运行 NewClash</div>
                            </div>
                            <SimpleSwitch
                                checked={autoStart}
                                onCheckedChange={async (c) => {
                                    const result = await window.ipcRenderer.invoke('autostart:set', c)
                                    if (result.success) {
                                        setAutoStart(c)
                                    } else {
                                        alert(`设置失败: ${result.error}`)
                                    }
                                }}
                            />
                        </div>
                    </div>
                </section>

                {/* Advanced */}
                <section>
                    <h3 className="text-lg font-medium mb-4 flex items-center">
                        <span className="w-5 h-5 mr-2 text-primary">⚡</span>
                        高级功能
                    </h3>
                    <div className="bg-card border border-border/50 rounded-xl overflow-hidden divide-y divide-border/50">
                        <div className="p-4 flex items-center justify-between">
                            <div>
                                <div className="font-medium">更新 GeoIP 数据库</div>
                                <div className="text-sm text-muted-foreground">更新 IP 地理位置数据库</div>
                            </div>
                            <button
                                onClick={async () => {
                                    const result = await window.ipcRenderer.invoke('geo:update', 'geoip')
                                    if (result.success) {
                                        alert('GeoIP 更新成功！')
                                    } else {
                                        alert(`更新失败: ${result.error}`)
                                    }
                                }}
                                className="px-4 py-1.5 rounded-lg bg-secondary text-sm font-medium hover:opacity-80 transition-opacity"
                            >
                                更新
                            </button>
                        </div>
                        <div className="p-4 flex items-center justify-between">
                            <div>
                                <div className="font-medium">更新 GeoSite 数据库</div>
                                <div className="text-sm text-muted-foreground">更新域名分流规则数据库</div>
                            </div>
                            <button
                                onClick={async () => {
                                    const result = await window.ipcRenderer.invoke('geo:update', 'geosite')
                                    if (result.success) {
                                        alert('GeoSite 更新成功！')
                                    } else {
                                        alert(`更新失败: ${result.error}`)
                                    }
                                }}
                                className="px-4 py-1.5 rounded-lg bg-secondary text-sm font-medium hover:opacity-80 transition-opacity"
                            >
                                更新
                            </button>
                        </div>
                        <div className="p-4 flex items-center justify-between">
                            <div>
                                <div className="font-medium">清除 DNS 缓存</div>
                                <div className="text-sm text-muted-foreground">清除内核的 DNS 解析缓存</div>
                            </div>
                            <button
                                onClick={async () => {
                                    const result = await window.ipcRenderer.invoke('dns:flush')
                                    if (result.success) {
                                        alert('DNS 缓存已清除！')
                                    } else {
                                        alert('清除失败')
                                    }
                                }}
                                className="px-4 py-1.5 rounded-lg bg-secondary text-sm font-medium hover:opacity-80 transition-opacity"
                            >
                                清除
                            </button>
                        </div>
                        <div className="p-4 flex items-center justify-between">
                            <div>
                                <div className="font-medium">重启内核</div>
                                <div className="text-sm text-muted-foreground">重新启动 Mihomo 内核进程</div>
                            </div>
                            <button
                                onClick={async () => {
                                    if (confirm('确定要重启内核吗？')) {
                                        await window.ipcRenderer.invoke('core:restart')
                                        alert('内核正在重启...')
                                    }
                                }}
                                className="px-4 py-1.5 rounded-lg bg-destructive/20 text-destructive text-sm font-medium hover:bg-destructive/30 transition-colors"
                            >
                                重启
                            </button>
                        </div>
                    </div>
                </section>

                <div className="pt-4 text-center">
                    <span className="text-xs text-muted-foreground opacity-50">NewClash v2.3.0 • Built with ❤️</span>
                </div>
            </div>
        </motion.div>
    )
}
