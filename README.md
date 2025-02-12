# Bitcoin Inscription Tool

A web application that allows users to connect their Bitcoin wallets (UniSat or Xverse) and inscribe files on the Bitcoin network.

## Features

- Connect to UniSat or Xverse wallet
- Upload files (max 400KB)
- Inscribe files on Bitcoin network
- Modern, responsive UI with Tailwind CSS

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- UniSat or Xverse wallet browser extension

## Installation

1. Clone the repository:
```bash
git clone https://github.com/MuffinsThaCat/bitbars-app.git
cd bitbars-app
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm start
```

The application will be available at http://localhost:3000

## Usage

1. Open the application in your browser
2. Connect your UniSat or Xverse wallet
3. Select a file to inscribe (must be under 400KB)
4. Click "Inscribe File" and approve the transaction in your wallet

## Technologies Used

- React
- Tailwind CSS
- UniSat Wallet SDK
- Xverse Wallet SDK