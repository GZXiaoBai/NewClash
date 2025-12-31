
export class MockKernel {
    private trafficInterval: NodeJS.Timeout | null = null;
    private logInterval: NodeJS.Timeout | null = null;
    private webContents: any;

    constructor(webContents: any) {
        this.webContents = webContents;
    }

    start() {
        this.startTrafficSimulator();
        this.startLogSimulator();
    }

    stop() {
        if (this.trafficInterval) clearInterval(this.trafficInterval);
        if (this.logInterval) clearInterval(this.logInterval);
    }

    private startTrafficSimulator() {
        this.trafficInterval = setInterval(() => {
            const up = Math.floor(Math.random() * 1024 * 50); // 0 - 50 KB/s
            const down = Math.floor(Math.random() * 1024 * 1024 * 5); // 0 - 5 MB/s

            this.webContents.send('core:stats', {
                up,
                down
            });
        }, 1000);
    }

    private startLogSimulator() {
        const logLevels = ['info', 'warning', 'error', 'debug'];
        const messages = [
            '[TCP] dialed 1.1.1.1:443',
            '[UDP] packet dropped',
            '[DNS] resolved google.com',
            '[Rule] matched MATCH',
            '[Metadata] source IP: 192.168.1.5'
        ];

        this.logInterval = setInterval(() => {
            // 30% chance to send a log
            if (Math.random() > 0.7) {
                const level = logLevels[Math.floor(Math.random() * logLevels.length)];
                const message = messages[Math.floor(Math.random() * messages.length)];

                this.webContents.send('core:logs', {
                    type: level,
                    payload: message,
                    time: new Date().toLocaleTimeString()
                });
            }
        }, 500);
    }

    getProxies() {
        return {
            proxies: {
                "HK Premium": {
                    all: ["HK 01", "HK 02", "HK 03"],
                    history: [{ time: "2023-10-27T10:00:00.000Z", delay: 45 }],
                    name: "HK Premium",
                    now: "HK 01",
                    type: "Selector",
                    udp: true
                },
                "Global": {
                    all: ["HK Premium", "US Standard", "Direct"],
                    history: [],
                    name: "Global",
                    now: "HK Premium",
                    type: "Selector",
                    udp: true
                }
            }
        };
    }
}
