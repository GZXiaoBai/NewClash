import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Sidebar } from './components/Layout/Sidebar'
import Dashboard from './pages/Dashboard'
import Proxies from './pages/Proxies'
import Profiles from './pages/Profiles'
import Logs from './pages/Logs'
import Connections from './pages/Connections'
import Settings from './pages/Settings'
import { useEffect } from 'react'

function Layout() {
    // Theme Loader
    useEffect(() => {
        window.ipcRenderer.invoke('settings:get').then(settings => {
            if (settings?.theme) {
                const root = window.document.documentElement
                root.classList.remove('light', 'dark')
                root.classList.add(settings.theme)
            }
        })

        // Listen for system theme changes if needed, or app theme changes
        // For now, Settings page updates IPC, but we also need to listen to changes or reload
        // Ideally, Main process sends "settings:updated" event
    }, [])

    return (
        <div className="flex h-screen w-screen bg-[#0a0a0c] overflow-hidden font-sans text-foreground selection:bg-primary/30">
            {/* Ambient Background */}
            <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-[50%] -left-[20%] w-[80%] h-[80%] rounded-full bg-primary/5 blur-[120px]" />
                <div className="absolute top-[20%] -right-[20%] w-[60%] h-[60%] rounded-full bg-blue-500/5 blur-[100px]" />
            </div>

            <Sidebar />
            <div className="flex-1 h-full relative z-10">
                {/* Drag Region for Titlebar - allows window to be dragged */}
                <div className="absolute top-0 left-0 right-0 h-10 drag z-50" />
                <div className="h-full pt-6">
                    <Routes>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="/proxies" element={<Proxies />} />
                        <Route path="/profiles" element={<Profiles />} />
                        <Route path="/logs" element={<Logs />} />
                        <Route path="/connections" element={<Connections />} />
                        <Route path="/settings" element={<Settings />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </div>
            </div>
        </div>
    )
}

function App() {
    return (
        <HashRouter>
            <Layout />
        </HashRouter>
    )
}

export default App
