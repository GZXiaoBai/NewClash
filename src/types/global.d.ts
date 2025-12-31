export { };

declare global {
    interface Window {
        ipcRenderer: {
            on: (channel: string, listener: (event: any, ...args: any[]) => void) => () => void;
            off: (channel: string, listener: (event: any, ...args: any[]) => void) => void;
            invoke: (channel: string, ...args: any[]) => Promise<any>;
        };
    }
}
