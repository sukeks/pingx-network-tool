# PingX — Internet Health Check

PingX is a fast, modern, and user-friendly internet diagnostic tool built with Angular. It goes beyond simple speed tests by measuring the real-time health of your connection—including latency, jitter, packet loss, and network stability—in plain English.

## Features

- **Real-Time Latency & Jitter Tracking:** Visualizes your connection stability with an interactive D3.js chart.
- **Packet Loss Detection:** Identifies dropped connections immediately.
- **Speed Estimation:** Measures approximate download and upload speeds.
- **Network Identity:** Automatically detects your ISP, IP address, and connection type (WiFi, Cellular, Ethernet).
- **Support Ticket Generator:** Easily export your network metrics to send to your IT department or ISP.
- **Dark/Light Mode:** Automatically adapts to your system preferences.

## Tech Stack

- **Framework:** Angular 18+ (Zoneless, Standalone Components)
- **Styling:** Tailwind CSS
- **Data Visualization:** D3.js
- **Icons:** Material Symbols

## Getting Started

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed on your machine.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/sukeks/pingx-network-tool.git
   cd pingx-network-tool
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm start
   ```
   The app will be available at `http://localhost:3000`.

## Deployment (Netlify)

This project is configured to be easily deployed to Netlify.

1. Connect your GitHub repository to Netlify.
2. Use the following build settings:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist/app/browser`
3. Click **Deploy**.

*Note: A `public/_redirects` file is included to ensure Angular's routing works correctly on Netlify's static hosting.*

## License
MIT License
