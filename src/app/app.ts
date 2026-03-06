import { Component, signal, computed, effect, OnInit, OnDestroy, PLATFORM_ID, ChangeDetectionStrategy, inject, ElementRef, ViewChild, NgZone, untracked, HostListener } from '@angular/core';
import { isPlatformBrowser, DatePipe } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import * as d3 from 'd3';
import { animate } from 'motion';

interface HistoryItem {
  ts: number;
  avg: number;
  lPct: number;
  jit: number;
  score: number;
  verdict: string;
}

interface LogEntry {
  time: string;
  host: string;
  ms: number;
  isLoss: boolean;
}

interface TimelineEvent {
  time: number;
  status: 'good' | 'warn' | 'bad';
}

const HOSTS: readonly { url: string; label: string }[] = [
  { url: 'https://www.google.com/favicon.ico?_=',     label: 'Google.com' },
  { url: 'https://www.cloudflare.com/favicon.ico?_=', label: 'Cloudflare' },
  { url: 'https://www.microsoft.com/favicon.ico?_=',  label: 'Microsoft' },
];

interface ModalRange {
  dot: string;
  label: string;
  range: string;
  meaning: string;
}

interface ModalInfo {
  icon: string;
  title: string;
  subtitle: string;
  desc: string;
  ranges: ModalRange[];
  tip: string | null;
}

const INFO_DATA: Readonly<Record<string, ModalInfo>> = {
  score: {
    icon: '🏅', title: 'Health Score', subtitle: 'Your overall internet rating out of 100',
    desc: 'This single number summarises how healthy your internet connection is right now. It combines your response speed, data delivery, and stability into one easy score — like a doctor giving you an overall health grade.',
    ranges: [
      { dot:'good', label:'75–100 — Excellent', range:'Great connection', meaning:'Fast, stable, no data loss. Everything works well.' },
      { dot:'warn', label:'45–74 — Fair',        range:'Some issues',     meaning:'You may notice slowdowns or occasional glitches.' },
      { dot:'bad',  label:'0–44 — Poor',         range:'Real problems',   meaning:'Significant issues affecting your experience.' },
    ],
    tip: '💡 Run the test multiple times at different times of day to get a reliable average score.'
  },
  latency: {
    icon: '⚡', title: 'Response Speed (Latency)', subtitle: 'How fast your internet reacts',
    desc: 'Latency is the time it takes for a message to travel from your device to a server and back. Think of it like a conversation — low latency means the other person replies instantly; high latency means there\'s a noticeable pause before they respond.',
    ranges: [
      { dot:'good', label:'Under 60ms — Great',    range:'<60ms',     meaning:'Instant response. Perfect for gaming, calls, and everything.' },
      { dot:'warn', label:'60–140ms — Acceptable', range:'60–140ms',  meaning:'Noticeable on games. Calls may have slight delay.' },
      { dot:'bad',  label:'Over 140ms — Too slow', range:'>140ms',    meaning:'Causing lag, slow loading, and call quality issues.' },
    ],
    tip: '💡 High latency is often caused by WiFi interference or a congested router. Try an Ethernet cable or restart your router.'
  },
  loss: {
    icon: '📦', title: 'Data Delivery (Packet Loss)', subtitle: 'How much of your data actually arrives',
    desc: 'Imagine sending 100 letters — packet loss is how many get lost in the post. The internet works by breaking everything into small pieces called "packets". If any are lost, your device has to ask for them again, causing glitches, freezes, and disconnections.',
    ranges: [
      { dot:'good', label:'0% — Perfect',        range:'0%',    meaning:'All data arriving safely. This is the ideal.' },
      { dot:'warn', label:'1–3% — Some loss',    range:'1–3%',  meaning:'Calls will start to glitch. Video may pixelate.' },
      { dot:'bad',  label:'Over 3% — High loss', range:'>3%',   meaning:'Calls drop, pages fail to load, video freezes.' },
    ],
    tip: '💡 Any packet loss above 0% is a real problem. It usually means a fault between your router and your internet provider. Call your ISP.'
  },
  jitter: {
    icon: '〰️', title: 'Consistency (Jitter)', subtitle: 'How steady your connection speed is',
    desc: 'Jitter measures how much your speed fluctuates from moment to moment. Even if your average speed is OK, high jitter means it keeps jumping up and down unpredictably — like a car constantly speeding up and braking. This makes voice calls sound robotic or choppy.',
    ranges: [
      { dot:'good', label:'Under 15ms — Stable',     range:'<15ms',    meaning:'Very consistent. Calls and video will be smooth.' },
      { dot:'warn', label:'15–35ms — Unsteady',       range:'15–35ms',  meaning:'Occasional crackles on calls. May affect gaming.' },
      { dot:'bad',  label:'Over 35ms — Very unstable',range:'>35ms',    meaning:'Audio will sound robotic. Video calls will freeze.' },
    ],
    tip: '💡 High jitter almost always means a WiFi problem. An Ethernet cable will fix this immediately in most cases.'
  },
  layers: {
    icon: '🔎', title: 'Where is the Problem?', subtitle: 'Network layer analysis',
    desc: 'Your internet connection passes through several "layers" before reaching websites. By testing each layer separately, we can pinpoint exactly where things are breaking down — so you know whether to fix your own equipment or call your provider.',
    ranges: [
      { dot:'good', label:'Green dot — Working fine', range:'✅ OK',      meaning:'This part of your connection is healthy.' },
      { dot:'warn', label:'Amber dot — Issue here',   range:'⚠️ Slow',   meaning:'This layer has a problem that may be affecting you.' },
      { dot:'bad',  label:'Red dot — Problem found',  range:'🔴 Problem', meaning:'This is causing your connection issues. Take action.' },
    ],
    tip: '💡 If only the "Internet Provider" layer is red but your router and WiFi are green, the problem is 100% on your ISP\'s end — call them.'
  },
  'ly-device': {
    icon: '💻', title: 'Your Device', subtitle: 'Your computer, phone, or tablet',
    desc: 'This checks that your device itself is working and online. Problems here are rare but can happen if your network card is faulty, your browser is blocked, or your device is extremely overloaded.',
    ranges: [],
    tip: '💡 If your device shows a problem, try restarting it and closing all other apps. Try a different browser too.'
  },
  'ly-wifi': {
    icon: '📶', title: 'WiFi or Cable', subtitle: 'Your local connection to the router',
    desc: 'This checks how you\'re physically connected to your router. WiFi can be affected by distance, walls, other networks nearby, and interference from microwaves or cordless phones. A cable (Ethernet) connection is always more reliable.',
    ranges: [],
    tip: '💡 If this shows a warning, plug in an Ethernet cable. This one change solves the majority of home connection problems.'
  },
  'ly-router': {
    icon: '📡', title: 'Your Router', subtitle: 'The box in your home that provides WiFi',
    desc: 'The router is the device (usually provided by your ISP) that connects all your home devices to the internet. Routers can slow down over time, especially if they\'ve been on for months without a restart. A quick power cycle (unplug 30 seconds, plug back in) fixes most router issues.',
    ranges: [],
    tip: '💡 Restart your router once a month as routine maintenance. Most routers have a small reset button, or simply unplug the power lead.'
  },
  'ly-isp': {
    icon: '🏢', title: 'Internet Provider (ISP)', subtitle: 'The company supplying your internet',
    desc: 'Your ISP (Internet Service Provider) is the company you pay for internet — like BT, Virgin Media, Comcast, Jio, or Telstra. If there is a fault on your phone line, cable, or in their local exchange, this test will show it. ISP problems are outside your home and require them to fix.',
    ranges: [],
    tip: '💡 If this is red, call your ISP. Say: "I have packet loss and high latency. Please run a line quality test." Always ask for a ticket number.'
  },
  'ly-web': {
    icon: '🌍', title: 'The Internet', subtitle: 'Global websites and services',
    desc: 'This checks whether major global services like Google, Cloudflare, and Microsoft are reachable from your connection. If this fails but your ISP layer is fine, there may be a large-scale outage affecting multiple providers.',
    ranges: [],
    tip: '💡 If only specific websites don\'t work (but others do), the problem is on that website\'s servers — not your connection. Check downdetector.com.'
  },
  connection: {
    icon: '📋', title: 'Your Connection Details', subtitle: 'Technical information about your setup',
    desc: 'This panel shows the basic facts about how your device is currently connected to the internet — whether you\'re on WiFi or a cable, the estimated download speed, and how long this test session has been running.',
    ranges: [],
    tip: '💡 These details are detected directly from your device and browser — nothing is sent to any server.'
  },
  'network-info': {
    icon: '🌍', title: 'Network Information', subtitle: 'Your public IP and ISP',
    desc: 'This shows how the rest of the internet sees your connection. Your public IP address is assigned by your Internet Service Provider (ISP) and indicates your general geographic location.',
    ranges: [],
    tip: '💡 If you are using a VPN, this will show the VPN\'s IP and location instead of your real one.'
  },
  'conn-type': {
    icon: '🔌', title: 'Connection Type', subtitle: 'WiFi, Cable, or Mobile',
    desc: 'This shows how your device is physically connected. Ethernet (cable) is the most reliable and fastest. WiFi is convenient but can be affected by interference. Mobile data (4G/5G) has higher latency by nature.',
    ranges: [
      { dot:'good', label:'Ethernet — Best',   range:'Wired',   meaning:'Most stable, fastest, lowest jitter. Recommended.' },
      { dot:'warn', label:'WiFi — Good enough',range:'Wireless',meaning:'Fine for most uses, but vulnerable to interference.' },
      { dot:'bad',  label:'Mobile — Acceptable',range:'4G/5G',  meaning:'Higher latency normal. Not ideal for video calls or gaming.' },
    ],
    tip: null
  },
  'conn-speed': {
    icon: '🚀', title: 'Download Speed', subtitle: 'Download bandwidth estimate',
    desc: 'This is a measured estimate of your download speed using a short test. It gives a rough idea of your bandwidth.',
    ranges: [
      { dot:'good', label:'25+ Mbps — Great',   range:'>25 Mbps',  meaning:'Handles 4K streaming, multiple devices, video calls.' },
      { dot:'warn', label:'5–25 Mbps — OK',     range:'5–25 Mbps', meaning:'Good for HD video, basic calls, and browsing.' },
      { dot:'bad',  label:'Under 5 Mbps — Slow',range:'<5 Mbps',   meaning:'May struggle with HD video or multiple users.' },
    ],
    tip: '💡 For a precise speed test, visit fast.com or speedtest.net'
  },
  'conn-upload': {
    icon: '📤', title: 'Upload Speed', subtitle: 'Upload bandwidth estimate',
    desc: 'This is a measured estimate of your upload speed. Upload speed is important for video calls, sending large files, and streaming your own video.',
    ranges: [
      { dot:'good', label:'10+ Mbps — Great',   range:'>10 Mbps',  meaning:'Handles HD video calls and quick file uploads.' },
      { dot:'warn', label:'2–10 Mbps — OK',     range:'2–10 Mbps', meaning:'Good for basic calls and normal usage.' },
      { dot:'bad',  label:'Under 2 Mbps — Slow',range:'<2 Mbps',   meaning:'May struggle with video calls or sending files.' },
    ],
    tip: '💡 For a precise speed test, visit fast.com or speedtest.net'
  },
  bufferbloat: {
    icon: '🚦', title: 'Bufferbloat', subtitle: 'Latency under load',
    desc: 'Bufferbloat happens when your router or ISP buffers too much data when your connection is busy (like when someone else is downloading a large file or streaming 4K video). This causes massive lag spikes for everyone else on the network.',
    ranges: [
      { dot:'good', label:'+0-30ms — Excellent',   range:'<30ms increase',  meaning:'Your router manages traffic well. Gaming stays smooth even when others are downloading.' },
      { dot:'warn', label:'+30-100ms — Noticeable',     range:'30-100ms increase', meaning:'You will feel lag in games or calls if someone else uses the internet heavily.' },
      { dot:'bad',  label:'+100ms+ — Severe',range:'>100ms increase',   meaning:'Your connection becomes unusable for real-time apps when under load. You need a router with SQM (Smart Queue Management).' },
    ],
    tip: '💡 To fix severe bufferbloat, you need to enable QoS (Quality of Service) or SQM in your router settings, or buy a modern gaming router.'
  },
  'conn-pings': {
    icon: '🔢', title: 'Tests Run', subtitle: 'Number of pings sent this session',
    desc: 'Each "ping" is a small test message sent to a server to measure how fast it responds. The more tests run, the more accurate your averages become. We recommend at least 20 tests for a reliable result.',
    ranges: [],
    tip: '💡 Let the test run for at least 30 seconds to get accurate averages, especially for jitter measurement.'
  },
  'conn-uptime': {
    icon: '⏱️', title: 'Session Uptime', subtitle: 'How long this test has been running',
    desc: 'This shows how long the current test session has been active. Longer sessions give more reliable results, especially for detecting intermittent problems that only appear occasionally.',
    ranges: [],
    tip: '💡 If your internet drops at a specific time of day (like evenings), run the test at that time for the most useful results.'
  },
  usecases: {
    icon: '✅', title: 'Good Enough For...', subtitle: 'What your connection can handle',
    desc: 'Different activities need different things from your internet. Gaming needs fast response times. Video calls need both fast response AND zero data loss. Streaming mainly needs consistent speed. This panel shows what your current connection can actually handle.',
    ranges: [
      { dot:'good', label:'Green Badge — Perfect', range:'✅', meaning:'Your connection meets all requirements for this activity.' },
      { dot:'warn', label:'Amber Badge — Okay',    range:'⚠️', meaning:'It will work, but you might notice some issues.' },
      { dot:'bad',  label:'Red Badge — Poor',      range:'🔴', meaning:'Your connection is not good enough for this.' },
    ],
    tip: null
  },
  'uc-game': {
    icon: '🎮', title: 'Gaming', subtitle: 'Online multiplayer and competitive games',
    desc: 'Online games are extremely sensitive to latency. Even 80ms can cause you to lose gunfights or feel "behind" other players. The game sends and receives dozens of updates per second, so any delay is immediately noticeable. Packet loss causes teleporting characters and disconnections.',
    ranges: [
      { dot:'good', label:'Under 60ms — Great for gaming',   range:'<60ms, 0% loss', meaning:'Competitive play is smooth and responsive.' },
      { dot:'warn', label:'60–100ms — Playable',              range:'60–100ms',       meaning:'Casual gaming is fine but competitive play suffers.' },
      { dot:'bad',  label:'Over 100ms or any loss — Laggy',  range:'>100ms',         meaning:'Lag and rubber-banding. Call of Duty will be frustrating.' },
    ],
    tip: '💡 Use Ethernet for gaming. Even a strong WiFi signal has more jitter than a cable.'
  },
  'uc-call': {
    icon: '📹', title: 'Video Calls', subtitle: 'Zoom, Teams, Meet, FaceTime',
    desc: 'Video calls (Teams, Zoom, Google Meet, FaceTime) need both low latency AND zero packet loss. Latency causes the awkward talking-over-each-other delay. Packet loss causes the audio to cut out, sound robotic, or faces to freeze mid-sentence.',
    ranges: [
      { dot:'good', label:'Under 100ms, 0% loss — Perfect',  range:'<100ms, 0% loss', meaning:'HD video calls with clear audio. No issues.' },
      { dot:'warn', label:'100–150ms, small loss — Okay',    range:'100–150ms',        meaning:'Slight delay noticeable. Occasional audio glitch.' },
      { dot:'bad',  label:'Over 150ms or any loss — Poor',   range:'>150ms or loss',   meaning:'Calls will cut out, faces freeze, audio sounds robotic.' },
    ],
    tip: '💡 Close other apps that use the internet (like cloud backups or downloads) before important calls.'
  },
  'uc-stream': {
    icon: '📺', title: 'HD Streaming', subtitle: 'Netflix, YouTube, Disney+, Prime Video',
    desc: 'Streaming video is more forgiving than gaming or calls because the video player buffers (downloads a few seconds ahead). A brief slowdown won\'t cause an immediate problem. However, persistent high latency or packet loss will cause buffering, quality drops, or failure to load.',
    ranges: [
      { dot:'good', label:'Under 150ms — Great for streaming', range:'<150ms',  meaning:'4K and HD video plays without buffering.' },
      { dot:'warn', label:'150–250ms — Usually OK',            range:'150–250ms',meaning:'HD likely fine. 4K may occasionally buffer.' },
      { dot:'bad',  label:'Over 250ms — May buffer',           range:'>250ms',   meaning:'Video will buffer, auto-downgrade to lower quality.' },
    ],
    tip: null
  },
  'uc-browse': {
    icon: '🌐', title: 'Web Browsing', subtitle: 'Websites, Google, online shopping',
    desc: 'Normal web browsing is the least demanding use case. Even moderate latency usually goes unnoticed since pages load in parts and humans don\'t react as quickly as games do. However, very high latency (over 200ms) or packet loss will make pages feel sluggish or fail to load fully.',
    ranges: [
      { dot:'good', label:'Under 200ms — Fine for browsing', range:'<200ms', meaning:'Pages load quickly and responsively.' },
      { dot:'bad',  label:'Over 200ms — Noticeably slow',    range:'>200ms', meaning:'Pages take longer to load. May feel sluggish.' },
    ],
    tip: null
  },
  'uc-work': {
    icon: '💼', title: 'Remote Work / VDI', subtitle: 'Working from home, virtual desktops',
    desc: 'Remote work applications like Microsoft Teams, VDI (Virtual Desktop), SSH, or corporate VPNs are very sensitive. A virtual desktop sends your every keystroke and mouse movement over the internet in real time — any delay or packet loss causes freezes, dropped keystrokes, and disconnections.',
    ranges: [
      { dot:'good', label:'Under 100ms, 0% loss — Great',   range:'<100ms, 0% loss', meaning:'Virtual desktop and calls work smoothly.' },
      { dot:'warn', label:'100–150ms — Acceptable',          range:'100–150ms',        meaning:'Slight sluggishness on virtual desktops.' },
      { dot:'bad',  label:'Over 150ms or any loss — Poor',  range:'>150ms or loss',   meaning:'VDI sessions freeze, Teams drops, files fail to sync.' },
    ],
    tip: '💡 For remote work, always use a wired Ethernet connection if possible. WiFi is the #1 cause of VDI and Teams issues.'
  },
  history: {
    icon: '📅', title: 'Test History', subtitle: 'Your last 10 results saved locally',
    desc: 'PingX saves your last 10 test results in your browser. Nothing leaves your device — all history is stored locally and you can delete it anytime. Use it to spot patterns: is your connection always bad at the same time? Getting worse over time?',
    ranges: [],
    tip: '💡 Run tests at different times of day to detect time-based problems like evening congestion.'
  },
  log: {
    icon: '📡', title: 'Live Test Log', subtitle: 'Real-time ping results',
    desc: 'Each row in this log represents a single test message (ping) sent to a server. The color gives you an instant health check for that specific moment. Watch for patterns — a single red row is fine, but consistent red rows mean your connection is unstable.',
    ranges: [
      { dot:'good', label:'Green — Fast',   range:'<60ms',   meaning:'Response was quick. Connection is healthy.' },
      { dot:'warn', label:'Amber — Slow',   range:'60–140ms',meaning:'Response was delayed. You might feel lag.' },
      { dot:'bad',  label:'Red — Lost/Timeout',   range:'>140ms', meaning:'Data failed to arrive. Consistent red rows indicate a REAL PROBLEM.' },
    ],
    tip: '💡 If you see many red rows in a row, your connection is dropping data. This causes freezing in video calls and disconnects in games.'
  }
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
  imports: []
})
export class App implements OnInit, OnDestroy {
  theme = signal<'light' | 'dark'>('light');
  running = signal(false);
  isOnline = signal(true);
  uptimeSec = signal(0);
  pings = signal(0);
  lossCount = signal(0);
  lat = signal<number[]>([]);
  logs = signal<LogEntry[]>([]);
  platformId = inject(PLATFORM_ID);
  userAgent = isPlatformBrowser(this.platformId) ? window.navigator.userAgent : 'Unknown';
  
  progress = signal({ show: false, pct: 0, label: 'Starting...' });
  modalInfo = signal<ModalInfo | null>(null);
  toastMsg = signal('');
  
  layers = signal<Record<string, { status: string, desc: string, badge: string, troubleshooting?: string }>>({
    device: { status: 'scanning', desc: 'Your computer or phone', badge: 'Waiting' },
    wifi: { status: 'scanning', desc: 'How you connect to your router', badge: 'Waiting' },
    router: { status: 'scanning', desc: 'The box that gives you internet', badge: 'Waiting' },
    isp: { status: 'scanning', desc: 'The company you pay for internet', badge: 'Waiting' },
    web: { status: 'scanning', desc: 'Websites and services worldwide', badge: 'Waiting' }
  });

  connInfo = signal({ type: '—', sub: 'Detecting...', speed: '—', speedSub: 'Waiting...', upload: '—', uploadSub: 'Waiting...' });
  networkInfo = signal({ ip: 'Detecting...', isp: 'Detecting...', location: 'Detecting...', browser: 'Detecting...', os: 'Detecting...' });
  wifiInfo = signal({ type: 'Unknown', signal: 'Unknown' });
  
  udpLatency = signal<number | null>(null);
  autoMonitor = signal<boolean>(false);

  longTermMode = signal<boolean>(false);
  isBufferbloatRunning = signal<boolean>(false);
  bufferbloatStatus = signal<string>('');
  unloadedLat = signal<number | null>(null);
  loadedLat = signal<number | null>(null);
  timeline = signal<TimelineEvent[]>([]);
  
  @ViewChild('scoreNum') scoreNumRef!: ElementRef;

  @HostListener('window:resize')
  onResize() {
    if (this.isBrowser) {
      this.drawChart(this.logs());
    }
  }

  private pingIdx = 0;
  private uptimeTimer: ReturnType<typeof setInterval> | undefined;
  private autoMonitorInterval: ReturnType<typeof setInterval> | undefined;
  private timelineInterval: ReturnType<typeof setInterval> | undefined;
  private isBrowser: boolean;
  private ngZone = inject(NgZone);
  private sanitizer = inject(DomSanitizer);

  packetLossDetected = signal(false);
  packetHistory = signal<boolean[]>([]);
  lossHistory = signal<number[]>([]);
  jitterHistory = signal<number[]>([]);
  udpHistory = signal<number[]>([]);
  displayedScore = signal(0);
  
  downloadSpeedNum = signal(0);
  uploadSpeedNum = signal(0);
  displayedDownloadSpeed = signal(0);
  displayedUploadSpeed = signal(0);
  
  // Detailed metrics
  downloadPeak = signal(0);
  uploadPeak = signal(0);
  downloadBytes = signal(0);
  uploadBytes = signal(0);
  loadedLatency = signal(0);

  Math = Math;

  exportSupportTicket() {
    const avgLat = this.lat().length > 0 ? (this.lat().reduce((a, b) => a + b, 0) / this.lat().length).toFixed(1) : 'N/A';
    const avgJitter = this.jitterHistory().length > 0 ? (this.jitterHistory().reduce((a, b) => a + b, 0) / this.jitterHistory().length).toFixed(1) : 'N/A';
    const lossPct = this.pings() > 0 ? ((this.lossCount() / this.pings()) * 100).toFixed(1) : '0.0';

    const ticket = `
Network Connectivity Support Ticket
-----------------------------------
IP Address: ${this.networkInfo().ip}
ISP: ${this.networkInfo().isp}
Location: ${this.networkInfo().location}
Connection Type: ${this.connInfo().type}
Signal Quality: ${this.wifiInfo().signal}

Metrics:
- Download Speed: ${this.displayedDownloadSpeed()} Mbps
- Upload Speed: ${this.displayedUploadSpeed()} Mbps
- Avg Latency: ${avgLat} ms
- Avg Jitter: ${avgJitter} ms
- Packet Loss: ${lossPct}%

Please investigate these connectivity issues.
    `.trim();

    navigator.clipboard.writeText(ticket).then(() => {
      this.toastMsg.set('Support ticket copied to clipboard!');
      setTimeout(() => this.toastMsg.set(''), 3000);
    });
  }

  constructor() {
    const platformId = inject(PLATFORM_ID);
    this.isBrowser = isPlatformBrowser(platformId);
    effect(() => {
      const data = this.logs();
      if (this.isBrowser && data.length > 0) {
        this.drawChart(data);
      }
    });

    effect(() => {
      const target = this.score();
      const current = untracked(() => this.displayedScore());
      
      if (this.isBrowser && target !== current) {
        animate(current, target, {
          duration: 1.2,
          ease: "circOut",
          onUpdate: (latest) => this.displayedScore.set(Math.round(latest))
        });
        if (this.scoreNumRef?.nativeElement) {
          animate(this.scoreNumRef.nativeElement, { scale: [1.2, 1] }, { duration: 0.3 });
        }
      }
    });

    effect(() => {
      const target = this.downloadSpeedNum();
      const current = untracked(() => this.displayedDownloadSpeed());
      if (this.isBrowser && Math.abs(target - current) > 0.1) {
        animate(current, target, {
          duration: 0.5,
          ease: "circOut",
          onUpdate: (latest) => this.displayedDownloadSpeed.set(Number(latest.toFixed(1)))
        });
      }
    });

    effect(() => {
      const target = this.uploadSpeedNum();
      const current = untracked(() => this.displayedUploadSpeed());
      if (this.isBrowser && Math.abs(target - current) > 0.1) {
        animate(current, target, {
          duration: 0.5,
          ease: "circOut",
          onUpdate: (latest) => this.displayedUploadSpeed.set(Number(latest.toFixed(1)))
        });
      }
    });
  }

  activeSection = signal<'home' | 'details' | 'logs'>('home');

  ngOnInit() {
    if (this.isBrowser) {
      const saved = localStorage.getItem('pingx-theme');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.theme.set((saved as 'light' | 'dark') || (prefersDark ? 'dark' : 'light'));
      document.documentElement.setAttribute('data-theme', this.theme());
      
      this.fetchNetworkInfo();

      this.isOnline.set(navigator.onLine);
      window.addEventListener('online', () => {
        this.isOnline.set(true);
        if (this.autoMonitor() && !this.running()) {
          this.startTest();
        }
      });
      window.addEventListener('offline', () => this.isOnline.set(false));

      // Setup scroll observer for active section
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            if (entry.target.id === 'top') this.activeSection.set('home');
            else if (entry.target.id === 'details') this.activeSection.set('details');
            else if (entry.target.id === 'logs') this.activeSection.set('logs');
          }
        });
      }, { threshold: 0.3 });

      setTimeout(() => {
        const top = document.getElementById('top');
        const details = document.getElementById('details');
        const logs = document.getElementById('logs');
        if (top) observer.observe(top);
        if (details) observer.observe(details);
        if (logs) observer.observe(logs);
      }, 500);
    }
  }

  async fetchNetworkInfo() {
    // Detect Browser/OS
    const ua = navigator.userAgent;
    let browser = 'Unknown';
    if (ua.includes('Chrome')) browser = 'Chrome';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
    else if (ua.includes('Edge')) browser = 'Edge';

    let os = 'Unknown';
    if (ua.includes('Win')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'macOS';
    else if (ua.includes('Linux')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

    this.networkInfo.update(n => ({ ...n, browser, os }));

    try {
      // Primary API: ipinfo.io
      const res = await fetch('https://ipinfo.io/json');
      if (!res.ok) throw new Error('ipinfo failed');
      const data = await res.json();
      
      // Clean up the org name (remove AS number if present, e.g., "AS15169 Google LLC" -> "Google LLC")
      let ispName = data.org || 'Unknown';
      if (ispName.startsWith('AS') && ispName.indexOf(' ') > 0) {
        ispName = ispName.substring(ispName.indexOf(' ') + 1);
      }

      this.networkInfo.update(n => ({
        ...n,
        ip: data.ip || 'Unknown',
        isp: ispName,
        location: (data.city && data.country) ? `${data.city}, ${data.country}` : 'Unknown'
      }));

    } catch {
      // Fallback API: ipapi.co
      try {
        const res2 = await fetch('https://ipapi.co/json/');
        if (!res2.ok) throw new Error('ipapi failed');
        const data2 = await res2.json();
        
        this.networkInfo.update(n => ({
          ...n,
          ip: data2.ip || 'Unknown',
          isp: data2.org || 'Unknown',
          location: (data2.city && data2.country_name) ? `${data2.city}, ${data2.country_name}` : 'Unknown'
        }));
      } catch {
        // Final fallback: just get the IP
        try {
          const res3 = await fetch('https://api.ipify.org?format=json');
          const data3 = await res3.json();
          this.networkInfo.update(n => ({ 
            ...n,
            ip: data3.ip || 'Unknown', 
            isp: 'Unknown', 
            location: 'Unknown' 
          }));
        } catch {
          this.networkInfo.update(n => ({ ...n, ip: 'Unknown', isp: 'Unknown', location: 'Unknown' }));
        }
      }
    }
  }

  ngOnDestroy(): void {
    this.stopAllTimers();
    this.cleanupChart();
  }

  private stopAllTimers(): void {
    if (this.uptimeTimer) {
      clearInterval(this.uptimeTimer);
      this.uptimeTimer = undefined;
    }
    if (this.autoMonitorInterval) {
      clearInterval(this.autoMonitorInterval);
      this.autoMonitorInterval = undefined;
    }
    if (this.timelineInterval) {
      clearInterval(this.timelineInterval);
      this.timelineInterval = undefined;
    }
  }

  private cleanupChart(): void {
    if (this.isBrowser) {
      const container = d3.select('#latency-chart');
      if (!container.empty()) {
        container.selectAll('*').remove();
      }
    }
  }

  toggleAutoMonitor() {
    this.autoMonitor.update(v => !v);
    if (this.autoMonitor()) {
      if (!this.running() && this.isOnline()) this.startTest();
      this.autoMonitorInterval = setInterval(() => {
        if (!this.running() && this.isOnline()) this.startTest();
      }, 5 * 60 * 1000); // Every 5 minutes
    } else {
      clearInterval(this.autoMonitorInterval);
    }
  }

  exportCsv() {
    const rows = [['Time', 'Host', 'Latency (ms)', 'Packet Loss']];
    this.logs().forEach(l => {
      rows.push([l.time, l.host, l.ms.toString(), l.isLoss ? 'Yes' : 'No']);
    });
    const csvContent = rows.map(e => e.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `pingx-export-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  drawChart(data: LogEntry[]) {
    const container = d3.select('#latency-chart');
    if (container.empty()) return;

    const el = container.node() as HTMLElement;
    const width = el.getBoundingClientRect().width || 600;
    const height = 180;
    const margin = { top: 20, right: 20, bottom: 30, left: 40 };

    let svg = container.select<SVGSVGElement>('svg');
    if (svg.empty()) {
      svg = container.append('svg')
        .attr('height', height);
      
      svg.append('g').attr('class', 'grid');
      svg.append('g').attr('class', 'x-axis');
      svg.append('g').attr('class', 'y-axis');
      svg.append('path').attr('class', 'line-path')
        .attr('fill', 'none')
        .attr('stroke', 'var(--blue)')
        .attr('stroke-width', 2);
    }

    // Always update width/viewBox on redraw
    svg.attr('width', '100%')
       .attr('viewBox', `0 0 ${width} ${height}`);

    let tooltip = container.select<HTMLDivElement>('.chart-tooltip');
    if (tooltip.empty()) {
      tooltip = container.append('div')
        .attr('class', 'chart-tooltip')
        .style('position', 'absolute')
        .style('background', 'var(--surface)')
        .style('border', '1px solid var(--border)')
        .style('border-radius', '6px')
        .style('padding', '8px 12px')
        .style('font-size', '12px')
        .style('color', 'var(--text)')
        .style('box-shadow', 'var(--shadow)')
        .style('pointer-events', 'none')
        .style('opacity', 0)
        .style('z-index', 100);
    }

    const x = d3.scaleLinear()
      .domain([0, Math.max(data.length - 1, 1)])
      .range([margin.left, width - margin.right]);

    const maxMs = d3.max(data, d => d.ms) || 100;
    const y = d3.scaleLinear()
      .domain([0, Math.max(maxMs, 100)])
      .range([height - margin.bottom, margin.top]);

    const line = d3.line<LogEntry>()
      .x((d, i) => x(i))
      .y(d => y(d.ms))
      .curve(d3.curveMonotoneX);

    // Update Grid
    svg.select<SVGGElement>('.grid')
      .attr('transform', `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSize(-width + margin.left + margin.right).tickFormat(() => ''))
      .style('stroke-opacity', 0.1);

    // Update Axes
    svg.select<SVGGElement>('.x-axis')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(d => `#${d}`));

    svg.select<SVGGElement>('.y-axis')
      .attr('transform', `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5));

    // Update Line
    svg.select<SVGPathElement>('.line-path')
      .datum(data)
      .attr('d', line);

    // Update Dots
    const dots = svg.selectAll<SVGCircleElement, LogEntry>('.dot')
      .data(data);

    dots.enter().append('circle')
      .attr('class', 'dot')
      .attr('r', 4)
      .merge(dots)
      .attr('cx', (d, i) => x(i))
      .attr('cy', d => y(d.ms))
      .attr('fill', d => d.isLoss ? 'var(--red)' : 'var(--blue)')
      .style('cursor', 'pointer')
      .on('mouseover', function(event, d) {
        d3.select(this).attr('r', 6).attr('stroke', 'var(--text)').attr('stroke-width', 2);
        tooltip.transition().duration(100).style('opacity', 1);
        tooltip.html(`
          <div style="font-weight:600;margin-bottom:4px;">${d.time}</div>
          <div>Host: ${d.host}</div>
          <div>Status: <span style="color:${d.isLoss ? 'var(--red)' : 'var(--green)'}">${d.isLoss ? 'Lost' : d.ms + 'ms'}</span></div>
        `);
      })
      .on('mousemove', function(event) {
        const [xPos, yPos] = d3.pointer(event, container.node());
        tooltip
          .style('left', (xPos + 10) + 'px')
          .style('top', (yPos - 28) + 'px');
      })
      .on('mouseout', function() {
        d3.select(this).attr('r', 4).attr('stroke', 'none');
        tooltip.transition().duration(200).style('opacity', 0);
      });

    dots.exit().remove();
  }

  async measureUdpLatency(): Promise<number | null> {
    return new Promise((resolve) => {
      try {
        const RTC = window.RTCPeerConnection || (window as { webkitRTCPeerConnection?: typeof RTCPeerConnection }).webkitRTCPeerConnection;
        if (!RTC) {
          resolve(null);
          return;
        }
        const pc = new RTC({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        const start = performance.now();
        
        let resolved = false;
        const finish = (val: number | null) => {
          if (resolved) return;
          resolved = true;
          try { pc.close(); } catch { /* ignore */ }
          resolve(val);
        };

        pc.onicecandidate = (e: RTCPeerConnectionIceEvent) => {
          if (e.candidate) {
            const rtt = performance.now() - start;
            finish(Math.round(rtt));
          }
        };
        pc.createDataChannel('test');
        pc.createOffer().then((offer: RTCSessionDescriptionInit) => pc.setLocalDescription(offer)).catch(() => finish(null));
        setTimeout(() => finish(null), 3000);
      } catch { /* ignore */ }
    });
  }

  async runTraceroute() {
    // Removed
  }

  toggleTheme() {
    const next = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    document.documentElement.setAttribute('data-theme', next);
    if (this.isBrowser) {
      localStorage.setItem('pingx-theme', next);
    }
  }

  showInfo(key: string) {
    this.modalInfo.set(INFO_DATA[key]);
    if (this.isBrowser) {
      document.body.style.overflow = 'hidden';
    }
  }

  closeModal() {
    this.modalInfo.set(null);
    if (this.isBrowser) {
      document.body.style.overflow = '';
    }
  }

  showToast(msg: string) {
    this.toastMsg.set(msg);
    setTimeout(() => this.toastMsg.set(''), 3000);
  }

  // Computed metrics
  showResults = computed(() => {
    return this.pings() >= 5 || (!this.running() && this.pings() > 0);
  });

  heroEyebrow = computed(() => {
    if (!this.isOnline()) return 'Connection Status';
    if (!this.running() && this.pings() === 0) return 'Internet Health Check';
    if (!this.showResults() && this.running()) return 'Running diagnostics...';
    if (!this.running() && this.pings() > 0) return 'Test Results';
    return 'Your internet, right now';
  });

  avgLat = computed(() => {
    const l = this.lat();
    return l.length ? Math.round(l.reduce((a,b) => a+b, 0) / l.length) : 0;
  });

  minLat = computed(() => {
    const l = this.lat();
    return l.length ? Math.min(...l) : 0;
  });

  maxLat = computed(() => {
    const l = this.lat();
    return l.length ? Math.max(...l) : 0;
  });

  lossPct = computed(() => {
    return Math.round((this.lossCount() / Math.max(this.pings(), 1)) * 100);
  });

  jitter = computed(() => {
    const l = this.lat();
    const d = l.slice(1).map((v, i) => Math.abs(v - l[i]));
    return d.length ? Math.round(d.reduce((a,b) => a+b, 0) / d.length) : 0;
  });

  score = computed(() => {
    const avg = this.avgLat();
    const lPct = this.lossPct();
    const jit = this.jitter();
    
    let s = 100;
    if (avg > 300) s -= 40; else if (avg > 150) s -= 25; else if (avg > 80) s -= 12; else if (avg > 50) s -= 4;
    s -= Math.min(lPct * 8, 40);
    if (jit > 50) s -= 20; else if (jit > 30) s -= 12; else if (jit > 15) s -= 5;
    
    const bads = Object.values(this.layers()).filter(v => v.status === 'bad').length;
    const warns = Object.values(this.layers()).filter(v => v.status === 'warn').length;
    s -= bads * 12; s -= warns * 4;
    
    return Math.max(0, Math.min(100, Math.round(s)));
  });

  useCaseStatus = computed(() => {
    const lat = this.avgLat();
    const loss = this.lossPct();
    const jit = this.jitter();
    const dl = this.displayedDownloadSpeed();
    const ul = this.displayedUploadSpeed();
    const hasResults = this.showResults();

    if (!hasResults) {
      return { gaming: 'dim', video: 'dim', stream: 'dim', browse: 'dim' };
    }

    return {
      gaming: (lat < 60 && loss < 1 && jit < 20) ? 'good' : (lat < 100 && loss < 2) ? 'warn' : 'bad',
      video: (lat < 100 && loss < 1 && jit < 30 && ul > 2) ? 'good' : (lat < 150 && loss < 3 && ul > 0.5) ? 'warn' : 'bad',
      stream: (dl > 25 && loss < 1) ? 'good' : (dl > 5 && loss < 3) ? 'warn' : 'bad',
      browse: (lat < 200 && loss < 5) ? 'good' : 'bad'
    };
  });

  gaugeCircumference = 440; // 2 * PI * 70
  
  gaugeDashOffset = computed(() => {
    const s = this.displayedScore();
    const max = 330;
    return max - (s / 100) * max;
  });

  gaugeColorHex = computed(() => {
    const s = this.displayedScore();
    if (s >= 90) return '#22c55e'; // Green-500
    if (s >= 75) return '#84cc16'; // Lime-500
    if (s >= 60) return '#eab308'; // Yellow-500
    if (s >= 45) return '#f97316'; // Orange-500
    return '#ef4444'; // Red-500
  });

  gaugeRotation = computed(() => {
    // Rotate the gauge so the gap is at the bottom
    // 270 degrees visible means 90 degrees gap.
    // Start at -225 degrees?
    return 'rotate(135, 80, 80)';
  });

  needleRotation = computed(() => {
    const s = this.displayedScore();
    const deg = 225 + (s / 100) * 270;
    return `rotate(${deg}, 80, 80)`;
  });

  gLat = computed(() => {
    const ms = this.avgLat();
    return ms < 60 ? 'good' : ms < 140 ? 'warn' : 'bad';
  });

  gLoss = computed(() => {
    const p = this.lossPct();
    return p === 0 ? 'good' : p < 3 ? 'warn' : 'bad';
  });

  gJit = computed(() => {
    const ms = this.jitter();
    return ms < 15 ? 'good' : ms < 35 ? 'warn' : 'bad';
  });

  verdict = computed(() => {
    const avg = this.avgLat();
    const lPct = this.lossPct();
    const jit = this.jitter();
    const gL = this.gLat();
    const gLo = this.gLoss();
    const gJ = this.gJit();
    const l = this.layers();
    
    const ispBad = l['isp'].status === 'bad';
    const routerBad = l['router'].status === 'bad';
    const wifiBad = l['wifi'].status === 'warn' || l['wifi'].status === 'bad';

    if (!this.isOnline()) {
      return {
        status: 'Internet is down.',
        statusIcon: '🔴',
        statusClass: 'bad',
        explain: 'Your device is completely offline. Check your WiFi or cable connection.',
        actionClass: 'bad',
        actionIcon: '🔌',
        actionEye: '👉 Do this now',
        actionTitle: 'Check your connection',
        actionDesc: 'Make sure your WiFi is turned on or your Ethernet cable is plugged in.'
      };
    }

    if (!this.showResults() && this.running()) {
      return {
        status: 'Checking your internet...',
        statusIcon: '⏳',
        statusClass: '',
        explain: 'We\'re checking each part of your connection. Give it about 15 seconds for accurate results.',
        actionClass: '',
        actionIcon: '⏳',
        actionEye: 'Testing...',
        actionTitle: 'Checking your connection',
        actionDesc: 'We\'ll show you exactly what\'s wrong and the one thing to do to fix it.'
      };
    }

    if (!this.running() && this.pings() === 0) {
      return {
        status: 'Ready to check',
        statusIcon: '⚪',
        statusClass: '',
        explain: 'Press Start and we\'ll check every part of your connection — your device, your WiFi, your router, and your internet provider — and tell you exactly what\'s wrong in plain English.',
        actionClass: '',
        actionIcon: '💡',
        actionEye: 'What to do',
        actionTitle: 'Press Start to check your internet',
        actionDesc: 'We\'ll tell you exactly what\'s wrong and what to do — no technical knowledge needed.'
      };
    }

    if (gLo === 'bad' || ispBad) {
      return {
        status: 'There is a problem with your internet.',
        statusIcon: '🔴',
        statusClass: 'bad',
        explain: `You're losing ${lPct}% of your data — this is why things keep disconnecting or failing. The issue is with your internet provider.`,
        actionClass: 'bad', actionIcon: '📞', actionEye: '👉 Do this now',
        actionTitle: 'Call your internet provider',
        actionDesc: `Tell them: "I have ${lPct}% packet loss and ${avg}ms latency. Please check my line quality." Get a ticket number. If they say nothing's wrong, ask for a Level 2 engineer.`
      };
    } else if (routerBad) {
      return {
        status: 'Your router needs a restart.',
        statusIcon: '🔴',
        statusClass: 'bad',
        explain: `Your router is responding very slowly. This is causing the slowdowns and drops you're experiencing.`,
        actionClass: 'bad', actionIcon: '🔌', actionEye: '👉 Do this now',
        actionTitle: 'Restart your router',
        actionDesc: 'Unplug your router from the wall. Wait 30 seconds. Plug it back in. Wait 1 minute. Test again.'
      };
    } else if (wifiBad) {
      return {
        status: 'Your WiFi connection is unstable.',
        statusIcon: '⚠️',
        statusClass: 'warn',
        explain: `Your wireless signal is weak or inconsistent. This causes choppy calls, lag in games, and slow loading.`,
        actionClass: 'warn', actionIcon: '🔌', actionEye: '👉 Best fix',
        actionTitle: 'Use a cable instead of WiFi',
        actionDesc: 'Plug an Ethernet cable from your router directly into your device. This fixes WiFi problems instantly and is always faster and more stable.'
      };
    } else if (gJ === 'bad') {
      const isCellular = this.connInfo().type === '📱 Mobile Data';
      return {
        status: 'Your connection is unstable.',
        statusIcon: '⚠️',
        statusClass: 'warn',
        explain: `We detected high jitter (${jit}ms). This causes choppy audio and lag spikes. ${isCellular ? 'This is common on mobile data networks.' : 'It\'s often caused by WiFi interference or a busy network.'}`,
        actionClass: 'warn', actionIcon: isCellular ? '📶' : '🔌', actionEye: '👉 Try this',
        actionTitle: isCellular ? 'Improve cell signal' : 'Move closer or use a cable',
        actionDesc: isCellular 
          ? 'Mobile data naturally fluctuates. Try moving near a window or going outside for a better signal, or switch to a stable WiFi network if possible.'
          : 'If you are on WiFi, move closer to the router. If possible, plug in an Ethernet cable to fix this instantly.'
      };
    } else if (gL === 'bad' || gLo === 'warn') {
      return {
        status: 'Your internet is slower than normal.',
        statusIcon: '⚠️',
        statusClass: 'warn',
        explain: `Speed is ${avg}ms — above the recommended limit. Things may feel sluggish. Calls may lag.`,
        actionClass: 'warn', actionIcon: '🔄', actionEye: '👉 Try this',
        actionTitle: 'Restart your router',
        actionDesc: 'Routers get slower over time without a restart. Unplug for 30 seconds, plug back in, and run the test again.'
      };
    } else {
      return {
        status: 'Your internet is healthy! 🎉',
        statusIcon: '✅',
        statusClass: 'good',
        explain: `${avg}ms response speed, no data loss, stable connection. Everything is working well.`,
        actionClass: 'ok', actionIcon: '✅', actionEye: 'All clear',
        actionTitle: 'Nothing to fix — you\'re good!',
        actionDesc: 'Your connection is working well. If a specific app is still not working, the problem is on that app\'s server — not your internet. Check their status page.'
      };
    }
  });

  sysInfo = computed(() => {
    if (!this.isBrowser) return { os: 'Unknown', browser: 'Unknown', screen: 'Unknown', time: 'Unknown' };
    const ua = navigator.userAgent;
    let os = 'Unknown OS';
    if (ua.indexOf('Win') !== -1) os = 'Windows';
    if (ua.indexOf('Mac') !== -1) os = 'MacOS';
    if (ua.indexOf('X11') !== -1) os = 'UNIX';
    if (ua.indexOf('Linux') !== -1) os = 'Linux';
    if (/Android/.test(ua)) os = 'Android';
    if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';

    let browser = 'Unknown Browser';
    if (ua.indexOf('Firefox') > -1) browser = 'Firefox';
    else if (ua.indexOf('SamsungBrowser') > -1) browser = 'Samsung Internet';
    else if (ua.indexOf('Opera') > -1 || ua.indexOf('OPR') > -1) browser = 'Opera';
    else if (ua.indexOf('Trident') > -1) browser = 'Internet Explorer';
    else if (ua.indexOf('Edge') > -1) browser = 'Edge';
    else if (ua.indexOf('Chrome') > -1) browser = 'Chrome';
    else if (ua.indexOf('Safari') > -1) browser = 'Safari';

    return {
      os,
      browser,
      screen: `${window.screen.width}x${window.screen.height}`,
      time: new Date().toISOString()
    };
  });

  useCases = computed(() => {
    const avg = this.avgLat();
    const lPct = this.lossPct();
    const jit = this.jitter();
    
    const getStatus = (okCond: boolean, warnCond: boolean) => {
      if (!this.showResults()) return { cls: 'dim', label: 'Waiting...' };
      if (okCond) return { cls: 'ok', label: 'Great' };
      if (warnCond) return { cls: 'warn', label: 'Fair' };
      return { cls: 'no', label: 'Poor' };
    };
    
    return {
      game: getStatus(avg < 60 && lPct === 0 && jit < 10, avg < 100 && lPct < 1 && jit < 20),
      call: getStatus(avg < 100 && lPct === 0 && jit < 15, avg < 150 && lPct < 2 && jit < 35),
      stream: getStatus(avg < 150 && lPct < 2, avg < 250 && lPct < 5),
      browse: getStatus(avg < 200 && lPct < 5, avg < 400 && lPct < 10),
      work: getStatus(avg < 100 && lPct === 0 && jit < 20, avg < 150 && lPct < 2 && jit < 35),
    };
  });

  dlGaugeRotation = computed(() => {
    const s = this.displayedDownloadSpeed();
    // Max 100 Mbps for visual scale
    const pct = Math.min(s, 100) / 100;
    const deg = 135 + (pct * 270); // Start at 135 deg (bottom left), sweep 270 deg
    return `rotate(${deg}, 40, 40)`;
  });

  dlGaugeDashOffset = computed(() => {
    const s = this.displayedDownloadSpeed();
    // Circumference for r=32 is 2*PI*32 = 201.06
    // 270 degrees is 0.75 of circle -> 150.8
    const max = 151;
    const pct = Math.min(s, 100) / 100;
    return max - (pct * max);
  });

  ulGaugeRotation = computed(() => {
    const s = this.displayedUploadSpeed();
    const pct = Math.min(s, 100) / 100;
    const deg = 135 + (pct * 270);
    return `rotate(${deg}, 40, 40)`;
  });

  ulGaugeDashOffset = computed(() => {
    const s = this.displayedUploadSpeed();
    const max = 151;
    const pct = Math.min(s, 100) / 100;
    return max - (pct * max);
  });

  getSpeedPct(speed: number): number {
    // Cap visual at 100 Mbps for the bar, but maybe allow it to go higher visually if we want?
    // Let's cap at 100% width for 100 Mbps.
    return Math.min(speed, 100);
  }

  formatUptime(sec: number) {
    return sec >= 60 ? Math.floor(sec/60)+'m '+sec%60+'s' : sec+'s';
  }

  formatDate(ts: number) {
    const dt = new Date(ts);
    return dt.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' })
      + ' ' + dt.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
  }

  async runBufferbloatTest() {
    if (this.isBufferbloatRunning()) return;
    this.isBufferbloatRunning.set(true);
    this.bufferbloatStatus.set('Measuring baseline latency...');
    
    if (this.lat().length < 5) {
      this.bufferbloatStatus.set('Please run the main test first to get a baseline.');
      setTimeout(() => {
        this.isBufferbloatRunning.set(false);
        this.bufferbloatStatus.set('');
      }, 3000);
      return;
    }
    
    const baseline = this.avgLat();
    this.unloadedLat.set(baseline);
    this.loadedLat.set(null);
    
    this.bufferbloatStatus.set('Downloading data to stress network...');
    
    const controller = new AbortController();
    const loadedPings: number[] = [];
    
    // Start heavy download
    fetch('https://speed.cloudflare.com/__down?bytes=50000000', { signal: controller.signal }).catch(() => { /* ignore */ });
    
    // Ping while downloading
    const pingInterval = setInterval(async () => {
      const t0 = performance.now();
      try {
        await fetch('https://www.google.com/favicon.ico?_='+Date.now(), { method:'HEAD', mode:'no-cors', cache:'no-store', signal: AbortSignal.timeout(2000) });
        loadedPings.push(Math.round(performance.now() - t0));
      } catch { /* ignore */ }
    }, 500);

    // Stop after 6 seconds
    setTimeout(() => {
      controller.abort();
      clearInterval(pingInterval);
      
      if (loadedPings.length > 0) {
        const loadedAvg = Math.round(loadedPings.reduce((a,b)=>a+b,0)/loadedPings.length);
        this.loadedLat.set(loadedAvg);
        const diff = loadedAvg - baseline;
        if (diff > 50) {
          this.bufferbloatStatus.set(`Bufferbloat detected! Latency spiked by +${diff}ms under load.`);
          this.showToast(`⚠️ Bufferbloat: +${diff}ms spike`);
        } else {
          this.bufferbloatStatus.set(`Good! Latency only increased by +${diff}ms under load.`);
          this.showToast(`✅ Bufferbloat: +${diff}ms (Good)`);
        }
      } else {
        this.bufferbloatStatus.set('Failed to measure loaded latency.');
        this.showToast('❌ Bufferbloat test failed');
      }
      this.isBufferbloatRunning.set(false);
    }, 6000);
  }

  async startTest() {
    this.running.set(true);
    this.lat.set([]);
    this.lossCount.set(0);
    this.pings.set(0);
    this.pingIdx = 0;
    this.uptimeSec.set(0);
    this.logs.set([]);
    this.packetHistory.set([]);
    this.jitterHistory.set([]);
    this.udpHistory.set([]);
    this.udpLatency.set(null);
    this.downloadPeak.set(0);
    this.uploadPeak.set(0);
    this.downloadBytes.set(0);
    this.uploadBytes.set(0);
    this.loadedLatency.set(0);
    
    this.layers.set({
      device: { status: 'scanning', desc: 'Your computer or phone', badge: 'Checking...' },
      wifi: { status: 'scanning', desc: 'How you connect to your router', badge: 'Checking...' },
      router: { status: 'scanning', desc: 'The box that gives you internet', badge: 'Checking...' },
      isp: { status: 'scanning', desc: 'The company you pay for internet', badge: 'Checking...' },
      web: { status: 'scanning', desc: 'Websites and services worldwide', badge: 'Checking...' }
    });
    
    this.progress.set({ show: true, pct: 0, label: 'Starting...' });
    
    this.uptimeTimer = setInterval(() => {
      this.uptimeSec.update(s => s + 1);
    }, 1000);

    // Initialize timeline with current status
    this.updateTimeline(true);

    // Measure UDP Latency via WebRTC STUN once before speed test
    const initialUdpMs = await this.measureUdpLatency();
    if (initialUdpMs !== null) {
      this.udpLatency.set(initialUdpMs);
      this.udpHistory.set([initialUdpMs]);
    }

    this.ngZone.runOutsideAngular(async () => {
      await this.runSpeedTest();
      if (!this.running()) return;

      this.pingLoop();
      this.udpLoop();
      this.runLayers();
    });
  }

  stopTest() {
    this.running.set(false);
    if (this.uptimeTimer) {
      clearInterval(this.uptimeTimer);
    }
    // No timelineInterval to clear anymore
    this.progress.update(p => ({ ...p, show: false }));
  }

  resetApp() {
    this.stopTest();
    
    // Reset all signals to initial state
    this.uptimeSec.set(0);
    this.pings.set(0);
    this.lossCount.set(0);
    this.lat.set([]);
    this.logs.set([]);
    this.progress.set({ show: false, pct: 0, label: 'Starting...' });
    this.modalInfo.set(null);
    this.toastMsg.set('');
    
    this.layers.set({
      device: { status: 'scanning', desc: 'Your computer or phone', badge: 'Waiting' },
      wifi: { status: 'scanning', desc: 'How you connect to your router', badge: 'Waiting' },
      router: { status: 'scanning', desc: 'The box that gives you internet', badge: 'Waiting' },
      isp: { status: 'scanning', desc: 'The company you pay for internet', badge: 'Waiting' },
      web: { status: 'scanning', desc: 'Websites and services worldwide', badge: 'Waiting' }
    });

    this.connInfo.set({ type: '—', sub: 'Detecting...', speed: '—', speedSub: 'Waiting...', upload: '—', uploadSub: 'Waiting...' });
    this.networkInfo.set({ ip: 'Detecting...', isp: 'Detecting...', location: 'Detecting...', browser: 'Detecting...', os: 'Detecting...' });
    this.wifiInfo.set({ type: 'Unknown', signal: 'Unknown' });
    
    this.udpLatency.set(null);
    this.autoMonitor.set(false);
    if (this.autoMonitorInterval) {
      clearInterval(this.autoMonitorInterval);
    }

    this.longTermMode.set(false);
    this.isBufferbloatRunning.set(false);
    this.bufferbloatStatus.set('');
    this.unloadedLat.set(null);
    this.loadedLat.set(null);
    this.timeline.set([]);
    
    this.packetLossDetected.set(false);
    this.packetHistory.set([]);
    this.lossHistory.set([]);
    this.jitterHistory.set([]);
    this.udpHistory.set([]);
    this.displayedScore.set(0);
    
    this.downloadSpeedNum.set(0);
    this.uploadSpeedNum.set(0);
    this.displayedDownloadSpeed.set(0);
    this.displayedUploadSpeed.set(0);
    
    this.downloadPeak.set(0);
    this.uploadPeak.set(0);
    this.downloadBytes.set(0);
    this.uploadBytes.set(0);
    
    if (this.isBrowser) {
       this.drawChart([]); 
    }
    
    this.fetchNetworkInfo();
  }

  private updateTimeline(forceNew = false) {
    const l = this.lat();
    const avg = l.length ? Math.round(l.reduce((a,b)=>a+b,0)/l.length) : 0;
    
    // Calculate recent loss from logs (last ~30s) to be more responsive
    const recentLogs = this.logs();
    const recentLossCount = recentLogs.filter(x => x.isLoss).length;
    const recentLossPct = recentLogs.length ? (recentLossCount / recentLogs.length) * 100 : 0;
    
    let status: 'good' | 'warn' | 'bad' = 'good';
    if (recentLossPct >= 10 || avg > 150) status = 'bad';
    else if (recentLossPct > 0 || avg > 60) status = 'warn';

    this.timeline.update(t => {
      const now = Date.now();
      if (t.length === 0 || forceNew) {
        const nt = [...t, { time: now, status }];
        if (nt.length > 60) nt.shift();
        return nt;
      }
      
      const last = t[t.length - 1];
      if (now - last.time > 60000) {
        const nt = [...t, { time: now, status }];
        if (nt.length > 60) nt.shift();
        return nt;
      } else {
        // Update current bar
        const nt = [...t];
        nt[nt.length - 1] = { ...last, status };
        return nt;
      }
    });
  }

  private async runSpeedTest() {
    this.progress.set({ show: true, pct: 2, label: 'Measuring download speed...' });
    this.connInfo.update(c => ({ ...c, speed: 'Testing...', speedSub: 'Downloading...', upload: 'Waiting...' }));
    
    try {
      const durationMs = 6000;
      const warmupMs = 1500;
      let totalBytes = 0;
      
      const controller = new AbortController();

      const worker = async (id: number) => {
        try {
          const res = await fetch(`/api/speedtest/download?mb=100&_=${Date.now()}_${id}`, { 
            cache: 'no-store',
            signal: controller.signal
          });
          const reader = res.body?.getReader();
          if (!reader) return;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.length;
          }
        } catch {
          // Ignore abort errors
        }
      };

      // Start 4 concurrent streams
      for (let i = 0; i < 4; i++) worker(i);
      
      // Warmup phase (let TCP window scale up)
      await this.sleep(warmupMs);
      const bytesAtWarmup = totalBytes;
      const timeAtWarmup = performance.now();
      
      // Monitor speed during test
      const monitor = setInterval(() => {
        const now = performance.now();
        const duration = now - timeAtWarmup;
        if (duration > 0) {
          const bytes = totalBytes - bytesAtWarmup;
          const bps = (bytes * 8) / (duration / 1000);
          const mbps = bps / 1000000;
          const mbpsNum = Number(mbps.toFixed(1));
          this.downloadSpeedNum.set(mbpsNum);
          
          // Track peak
          if (mbpsNum > this.downloadPeak()) {
            this.downloadPeak.set(mbpsNum);
          }
          // Track bytes (in MB)
          this.downloadBytes.set(Number((bytes / 1000000).toFixed(1)));
        }
      }, 100);

      // Measurement phase
      await this.sleep(durationMs - warmupMs);
      clearInterval(monitor);
      controller.abort();
      
      const finalBytes = totalBytes;
      const finalTime = performance.now();
      
      const measureTime = finalTime - timeAtWarmup;
      const measureBytes = finalBytes - bytesAtWarmup;
      
      // Speedtest standard uses 1,000,000 bits for Mbps, not 1,048,576
      const bps = measureTime > 0 ? (measureBytes * 8) / (measureTime / 1000) : 0;
      const mbps = (bps / 1000000).toFixed(1);
      this.downloadSpeedNum.set(Number(mbps));
      this.downloadBytes.set(Number((measureBytes / 1000000).toFixed(1)));
      
      this.connInfo.update(c => ({ 
        ...c, 
        speed: mbps + ' Mbps', 
        speedSub: Number(mbps) >= 25 ? 'Great for 4K' : Number(mbps) >= 5 ? 'Good for HD' : Number(mbps) >= 1 ? 'Basic web' : 'Very slow' 
      }));
    } catch {
      this.connInfo.update(c => ({ ...c, speed: 'Failed', speedSub: 'Could not measure' }));
    }

    if (!this.running()) return;
    this.progress.set({ show: true, pct: 4, label: 'Measuring upload speed...' });

    try {
      this.connInfo.update(c => ({ ...c, upload: 'Testing...' }));
      const durationMs = 6000;
      const warmupMs = 1500;
      const payload = new Uint8Array(2 * 1024 * 1024); // 2MB chunks
      let totalBytes = 0;
      
      const controller = new AbortController();
      let running = true;
      
      const worker = (id: number) => {
        let currentXhr: XMLHttpRequest | null = null;
        
        const runNext = () => {
          if (!running) return;
          const xhr = new XMLHttpRequest();
          currentXhr = xhr;
          xhr.open('POST', '/api/speedtest/upload?_=' + Date.now() + '_' + id);
          xhr.setRequestHeader('Content-Type', 'application/octet-stream');
          
          let lastLoaded = 0;
          xhr.upload.onprogress = (e) => {
            if (!running) {
              xhr.abort();
              return;
            }
            const diff = e.loaded - lastLoaded;
            totalBytes += diff;
            lastLoaded = e.loaded;
          };
          
          xhr.onload = () => {
            if (running) runNext();
          };
          
          xhr.onerror = () => {
            if (running) runNext();
          };
          
          xhr.send(payload);
        };
        
        controller.signal.addEventListener('abort', () => {
          if (currentXhr) currentXhr.abort();
        });
        
        runNext();
      };

      // Start 4 concurrent uploads
      for (let i = 0; i < 4; i++) worker(i);
      
      // Warmup phase
      await this.sleep(warmupMs);
      const bytesAtWarmup = totalBytes;
      const timeAtWarmup = performance.now();
      
      // Monitor speed during test
      const monitor = setInterval(() => {
        const now = performance.now();
        const duration = now - timeAtWarmup;
        if (duration > 0) {
          const bytes = totalBytes - bytesAtWarmup;
          const bps = (bytes * 8) / (duration / 1000);
          const mbps = bps / 1000000;
          const mbpsNum = Number(mbps.toFixed(1));
          this.uploadSpeedNum.set(mbpsNum);
          
          if (mbpsNum > this.uploadPeak()) {
            this.uploadPeak.set(mbpsNum);
          }
          this.uploadBytes.set(Number((bytes / 1000000).toFixed(1)));
        }
      }, 100);
      
      // Measurement phase
      await this.sleep(durationMs - warmupMs);
      clearInterval(monitor);
      running = false;
      controller.abort();
      
      const finalBytes = totalBytes;
      const finalTime = performance.now();
      
      const measureTime = finalTime - timeAtWarmup;
      const measureBytes = finalBytes - bytesAtWarmup;
      
      const bps = measureTime > 0 ? (measureBytes * 8) / (measureTime / 1000) : 0;
      const mbps = (bps / 1000000).toFixed(1);
      this.uploadSpeedNum.set(Number(mbps));
      this.uploadBytes.set(Number((measureBytes / 1000000).toFixed(1)));
      
      const mbpsNum = Number(mbps);
      const uploadSub = mbpsNum >= 10 ? 'Great for HD calls' : mbpsNum >= 2 ? 'Good for calls' : 'May limit video';
      this.connInfo.update(c => ({ ...c, upload: mbps + ' Mbps', uploadSub }));
    } catch {
      this.connInfo.update(c => ({ ...c, upload: 'Failed', uploadSub: 'Could not measure' }));
    }
  }

  private async sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
  }

  private async udpLoop(): Promise<void> {
    while (this.running()) {
      const udpMs = await this.measureUdpLatency();
      if (!this.running()) break;
      
      if (udpMs !== null) {
        this.udpLatency.set(udpMs);
        this.udpHistory.update(uh => {
          const nuh = [...uh, udpMs];
          if (nuh.length > 30) nuh.shift();
          return nuh;
        });
      }
      
      await this.sleep(2000);
    }
  }

  private async pingLoop(): Promise<void> {
    while (this.running()) {
      const h = HOSTS[this.pingIdx % HOSTS.length]; 
      this.pingIdx++;
      
      const t0 = performance.now(); 
      let ok = true;
      try { 
        await fetch(h.url+Date.now(), { method:'HEAD', mode:'no-cors', cache:'no-store', signal: AbortSignal.timeout(3000) }); 
      } catch { 
        ok = false; 
      }
      
      if (!this.running()) break;

      const ms = Math.round(performance.now() - t0);
      this.pings.update(p => p + 1);
      
      const isLoss = !ok || ms > 3000;
      
      // Update packet history (last 30 packets)
      this.packetHistory.update(h => {
        const nh = [...h, !isLoss];
        if (nh.length > 30) nh.shift();
        
        // Calculate loss percentage for the last 30 packets
        const lossCount = nh.filter(ok => !ok).length;
        const lossPct = (lossCount / nh.length) * 100;
        
        this.lossHistory.update(lh => {
           const nlh = [...lh, lossPct];
           if (nlh.length > 20) nlh.shift();
           return nlh;
        });

        return nh;
      });

      if (isLoss) { 
        this.lossCount.update(c => c + 1); 
        this.packetLossDetected.set(true);
        setTimeout(() => this.packetLossDetected.set(false), 2000);
      } else { 
        // Calculate jitter
        const currentLats = this.lat();
        const prevLat = currentLats.length > 0 ? currentLats[currentLats.length - 1] : ms;
        const currentJitter = Math.abs(ms - prevLat);
        
        this.jitterHistory.update(jh => {
          const nj = [...jh, currentJitter];
          if (nj.length > 30) nj.shift();
          return nj;
        });

        this.lat.update(l => {
          const nl = [...l, ms];
          if (nl.length > 40) nl.shift();
          return nl;
        }); 
      }
      
      const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });
      this.logs.update(logs => {
        const newLogs = [...logs, { time: timeStr, host: h.label, ms, isLoss }];
        if (newLogs.length > 14) newLogs.shift();
        return newLogs;
      });

      this.updateTimeline();
      
      if (this.running()) await this.sleep(this.longTermMode() ? 5000 : 2000);
    }
  }

  private async runLayers(): Promise<void> {
    try {
      this.progress.set({ show: true, pct: 5, label: 'Checking your device...' });
      await this.sleep(900);
      if (!this.running()) return;
      this.layers.update(l => ({ ...l, device: { status: 'ok', desc: 'Online and responding normally', badge: '✅ Good' } }));
      this.progress.set({ show: true, pct: 20, label: 'Checking WiFi signal...' });

      await this.sleep(1200);
      if (!this.running()) return;
      const conn = (navigator as unknown as { connection?: { rtt?: number, type?: string, effectiveType?: string, downlink?: number } }).connection || {};
      const rtt  = conn.rtt || 0;
      const type = conn.type || 'unknown';
      const effectiveType = conn.effectiveType || 'unknown';
      const downlink = conn.downlink || 0;
      
      // Infer signal quality from RTT and Downlink
      let signalQuality = 'Unknown';
      
      if (rtt > 0 && downlink > 0) {
        if (rtt < 50 && downlink > 5) {
          signalQuality = 'Excellent';
        } else if (rtt < 100 && downlink > 2) {
          signalQuality = 'Good';
        } else {
          signalQuality = 'Weak';
        }
      }
      
      this.wifiInfo.set({
        type: type === 'cellular' ? `📱 Mobile Data (${effectiveType.toUpperCase()})` : type === 'ethernet' ? '🔌 Ethernet' : '📶 WiFi',
        signal: signalQuality
      });
      
      if (type === 'ethernet') {
        this.layers.update(l => ({ ...l, wifi: { status: 'ok', desc: 'Connected by cable — most stable setup', badge: '✅ Wired' } }));
        this.connInfo.update(c => ({ ...c, type: '🔌 Ethernet', sub: 'Wired — most reliable' }));
      } else if (type === 'cellular') {
        const gen = effectiveType ? `(${effectiveType.toUpperCase()})` : '';
        this.layers.update(l => ({ ...l, wifi: { status: 'warn', desc: `Connected via Mobile Data ${gen}. Higher latency is normal.`, badge: '📱 Mobile', troubleshooting: '• Mobile data naturally has higher latency and jitter than home internet.\n• If it is too slow, try moving near a window or going outside for a better cell signal.\n• Switch to a stable WiFi network if possible.' } }));
        this.connInfo.update(c => ({ ...c, type: '📱 Mobile Data', sub: effectiveType ? `Cellular ${gen} — prone to jitter` : 'Cellular — prone to jitter' }));
      } else if (rtt > 120) {
        this.layers.update(l => ({ ...l, wifi: { status: 'warn', desc: 'Signal is weak — move closer to router or use a cable', badge: '⚠️ Weak', troubleshooting: '• Move closer to your WiFi router\n• Switch to a 5GHz network if available\n• Plug in an Ethernet cable for a guaranteed fix' } }));
        this.connInfo.update(c => ({ ...c, type: '📶 WiFi', sub: 'Weak signal — unstable' }));
      } else {
        this.layers.update(l => ({ ...l, wifi: { status: 'ok', desc: 'WiFi is connected and signal looks OK', badge: '✅ OK' } }));
        this.connInfo.update(c => ({ ...c, type: '📶 WiFi', sub: 'Good signal — convenient' }));
      }
      
      if (!this.running()) return;
      this.progress.set({ show: true, pct: 40, label: 'Checking your router...' });

      await this.sleep(1500);
      if (!this.running()) return;
      const t0 = performance.now();
      try { await fetch('https://www.google.com/?_='+Date.now(), { mode:'no-cors', cache:'no-store', signal: AbortSignal.timeout(4000) }); } catch { /* ignore */ }
      if (!this.running()) return;
      const ms = Math.round(performance.now() - t0);
      if (ms < 70)       this.layers.update(l => ({ ...l, router: { status: 'ok', desc: `Responding quickly (${ms}ms)`, badge: '✅ Good' } }));
      else if (ms < 180) this.layers.update(l => ({ ...l, router: { status: 'warn', desc: `A bit slow (${ms}ms) — try restarting it`, badge: '⚠️ Slow', troubleshooting: '• Unplug your router from power\n• Wait 30 seconds\n• Plug it back in and wait for lights to stabilize' } }));
      else               this.layers.update(l => ({ ...l, router: { status: 'bad', desc: `Very slow (${ms}ms) — restart it now`, badge: '🔴 Restart!', troubleshooting: '• Your router is struggling to process traffic.\n• Unplug it from the wall for 30 seconds, then plug it back in.\n• If this happens often, you may need a replacement router.' } }));
      
      if (!this.running()) return;
      this.progress.set({ show: true, pct: 60, label: 'Checking your internet provider...' });

      await this.sleep(2000);
      if (!this.running()) return;
      const lr = this.lossCount() / Math.max(this.pings(), 1);
      const t1 = performance.now();
      try { await fetch('https://1.1.1.1/?_='+Date.now(), { mode:'no-cors', cache:'no-store', signal: AbortSignal.timeout(5000) }); } catch { /* ignore */ }
      if (!this.running()) return;
      const ispMs = Math.round(performance.now() - t1);
      if (lr > 0.05)       this.layers.update(l => ({ ...l, isp: { status: 'bad', desc: `Dropping ${Math.round(lr*100)}% of your data — call them`, badge: '🔴 Call ISP!', troubleshooting: `• Contact your ISP support\n• Tell them: "I am experiencing ${Math.round(lr*100)}% packet loss."\n• Ask them to check your line quality and run a diagnostic.` } }));
      else if (ispMs > 220) this.layers.update(l => ({ ...l, isp: { status: 'warn', desc: `Network is slow right now (${ispMs}ms)`, badge: '⚠️ Slow', troubleshooting: '• Your ISP\'s network is currently congested.\n• This often happens during peak evening hours.\n• If it persists daily, complain to your provider.' } }));
      else                  this.layers.update(l => ({ ...l, isp: { status: 'ok', desc: `Their network is working fine`, badge: '✅ Good' } }));
      
      if (!this.running()) return;
      this.progress.set({ show: true, pct: 80, label: 'Checking the internet...' });

      await this.sleep(1500);
      if (!this.running()) return;
      let ok = 0;
      for (const u of ['https://www.google.com/', 'https://www.cloudflare.com/']) {
        if (!this.running()) return;
        try { await fetch(u+'?_='+Date.now(), { mode:'no-cors', cache:'no-store', signal: AbortSignal.timeout(3000) }); ok++; } catch { /* ignore */ }
      }
      if (!this.running()) return;
      if      (ok === 2) this.layers.update(l => ({ ...l, web: { status: 'ok', desc: 'Major websites are reachable', badge: '✅ Reachable' } }));
      else if (ok === 1) this.layers.update(l => ({ ...l, web: { status: 'warn', desc: 'Some websites are unreachable', badge: '⚠️ Partial', troubleshooting: '• Some internet routes are currently down.\n• This is a wider internet issue, not your home network.\n• Wait a few hours for the affected services to recover.' } }));
      else               this.layers.update(l => ({ ...l, web: { status: 'bad', desc: 'The internet is not reachable', badge: '🔴 Unreachable', troubleshooting: '• Your connection to the outside world is completely blocked.\n• Check if your ISP has a reported outage in your area.\n• Verify your router says "Internet Connected".' } }));
      
      if (!this.running()) return;
      this.progress.set({ show: true, pct: 100, label: 'Done!' });
      setTimeout(() => {
        if (this.running()) {
          this.progress.update(p => ({ ...p, show: false }));
        }
      }, 1500);
    } catch (err) {
      console.error('Error in runLayers:', err);
      this.showToast('⚠️ Diagnostic failed. Please try again.');
    }
  }

  shareNow() {
    let msg = '🌐 PingX — free internet health checker. Shows exactly what\'s wrong with your connection in plain English.';
    
    // If we have results, make the share message specific
    if (this.lat().length > 0) {
      const score = this.score();
      const avg = this.avgLat();
      const loss = this.lossPct();
      const status = score >= 75 ? 'Excellent' : score >= 45 ? 'Fair' : 'Poor';
      
      msg = `🚀 My Internet Health Score: ${score}/100 (${status})\n` +
            `⚡ Latency: ${avg}ms\n` +
            `📦 Packet Loss: ${loss}%\n\n` +
            `Check your connection details:`;
    }

    if (navigator.share) { 
      navigator.share({ title:'PingX Internet Check', text:msg, url:location.href }).catch(()=>{ /* ignore */ }); 
    } else { 
      navigator.clipboard.writeText(msg + '\n' + location.href).then(()=>this.showToast('✅ Result copied to clipboard!')); 
    }
  }

  showTechModal = signal(false);
  showMobileMenu = signal(false);

  scrollTo(id: string) {
    if (!this.isBrowser) return;
    
    if (id === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
    this.showMobileMenu.set(false);
  }

  techReport = computed(() => {
    const s = this.sysInfo();
    const n = this.networkInfo();
    const c = this.connInfo();
    const l = this.logs().slice(-5);
    
    return `--- PingX Technical Support Report ---
Generated: ${new Date().toISOString()}

[SYSTEM INFO]
OS: ${s.os}
Browser: ${s.browser}
Screen: ${s.screen}
User Agent: ${navigator.userAgent}

[NETWORK INFO]
Public IP: ${n.ip}
ISP: ${n.isp}
Location: ${n.location}
Connection Type: ${c.type} (${c.sub})

[PERFORMANCE METRICS]
Download Speed: ${c.speed}
Upload Speed: ${c.upload}
Ping Count: ${this.pings()} sent
Packet Loss: ${this.lossCount()} (${this.lossPct()}%)
Latency: Min ${this.minLat()}ms / Avg ${this.avgLat()}ms / Max ${this.maxLat()}ms
Jitter: ${this.jitter()}ms
Health Score: ${this.score()}/100

[BUFFERBLOAT]
Status: ${this.bufferbloatStatus() || 'Not run'}
Unloaded: ${this.unloadedLat() || '-'}ms
Loaded: ${this.loadedLat() || '-'}ms

[RECENT LOGS]
${l.map(x => `${x.time} - ${x.host}: ${x.isLoss ? 'LOSS' : x.ms + 'ms'}`).join('\n')}

[VERDICT]
Status: ${this.verdict().status}
Explanation: ${this.verdict().explain}
Action: ${this.verdict().actionTitle}
---------------------------------------`;
  });

  pulseColor = computed(() => {
    if (!this.isOnline()) return 'red';
    if (this.running()) return 'blue';
    const s = this.score();
    if (s >= 75) return 'green';
    if (s >= 45) return 'amber';
    return 'red';
  });

  copyTechReport() {
    navigator.clipboard.writeText(this.techReport()).then(() => {
      this.showToast('✅ Support report copied to clipboard');
      this.showTechModal.set(false);
    });
  }

  copyReport() {
    if (!this.lat().length) { this.showToast('⚠️ Run a test first!'); return; }
    
    const avg = this.avgLat();
    const lPct = this.lossPct();
    const jit = this.jitter();
    const score = this.score();
    
    const lNames: Record<string, string> = { device: 'Device', wifi: 'WiFi/Cable', router: 'Router', isp: 'Internet Provider', web: 'The Internet' };
    const layerLines = Object.entries(this.layers()).map(([k,v]) => `${v.status==='ok'?'✅':v.status==='warn'?'⚠️':'🔴'} ${lNames[k]||k}`).join('\n');
    
    const txt = `PingX Internet Health Report
${new Date().toLocaleString()}
${'─'.repeat(40)}
Health Score:     ${score}/100
Response Speed:   ${avg}ms  ${avg<60?'(Great)':avg<140?'(Slow)':'(Too slow)'}
Data Delivery:    ${lPct}% lost  ${lPct===0?'(Perfect)':lPct<3?'(Some loss)':'(High loss)'}
Consistency:      ${jit}ms jitter  ${jit<15?'(Stable)':jit<35?'(Unsteady)':'(Unstable)'}

Where is the problem?
${layerLines}

Verdict: ${this.verdict().status}
${this.verdict().explain}

What to do: ${this.verdict().actionTitle}
${this.verdict().actionDesc}`;
    
    navigator.clipboard.writeText(txt).then(()=>this.showToast('📋 Report copied!')).catch(()=>alert(txt));
  }
}
