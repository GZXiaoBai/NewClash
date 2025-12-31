import { contextBridge, ipcRenderer } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
    // Methods to listen to channels
    on(channel: string, listener: (event: any, ...args: any[]) => void) {
        ipcRenderer.on(channel, listener)
        return () => ipcRenderer.removeListener(channel, listener)
    },
    off(channel: string, listener: (event: any, ...args: any[]) => void) {
        ipcRenderer.removeListener(channel, listener)
    },
    // Methods to invoke main process
    invoke(channel: string, ...args: any[]) {
        return ipcRenderer.invoke(channel, ...args)
    },
})
