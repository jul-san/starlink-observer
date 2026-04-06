# 🛰️ Starlink Observer

![Globe](public/globe-sample.jpg)

### Visualize Starlink satellites on a 3D globe!

*Disclaimer - These are not live satellite positions!*

## ⚙️ Stack
- Next.js
- Three.js
- satellite.js
- SpaceX API v4

## 🚀 Features
- Satellite position propagation from TLE data
- Interactive 3D globe
- Position + orbital metadata display
- Satellite filtering based on version (v1.0, v1.5, All)

## 🧠 How it Works
Orbital Two-Line Elements (TLE) are fetched from the SpaceX API and propagated using satellite.js to find the satellite positions over time. These positions are converted into 3D coordinates and rendered on a globe using Three.js.

## 🛠️ Run Locally
Clone the repo using:
```bash
git clone https://github.com/jul-san/starlink-observer.git
```

Then run it locally using:
```bash
npm install
npm run dev
```
