# Solana Asset Liberator

A tool to swiftly migrate all your Solana assets (SOL and SPL Tokens) to a new wallet with a single signature. Exercise absolute control over your digital wealth.

## Installation

To run this project locally, you'll need to have Node.js and a package manager like npm or yarn installed.

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd <repository-directory>
    ```

2.  **Install dependencies:**
    The `package.json` file contains all the necessary dependencies. Install them by running:
    ```bash
    npm install
    ```
    Or if you use yarn:
    ```bash
    yarn install
    ```

3.  **Run the development server:**
    This project is set up with Vite. Run the following command to start the local server:
    ```bash
    npm run dev
    ```

## How to Switch to Mainnet

By default, the application is configured to run on the Solana **Devnet**. To switch to **Mainnet-Beta** for real transactions, follow these steps:

1.  Open the file `components/SolanaProvider.tsx`.
2.  Locate the `network` constant.
3.  Change its value from `WalletAdapterNetwork.Devnet` to `WalletAdapterNetwork.MainnetBeta`.

    ```typescript
    // Before
    const network = WalletAdapterNetwork.Devnet;

    // After
    const network = WalletAdapterNetwork.MainnetBeta;
    ```
4.  Save the file. Your application will now connect to the Solana Mainnet.

**Important:** Transactions on Mainnet involve real assets. Always double-check the destination address and be aware of the network fees.

## Mobile Usage Notes

This application includes the **Solana Mobile Wallet Adapter**, which enables a seamless experience on mobile devices.

-   When you open the app on a mobile device (iOS or Android) with a compatible wallet installed (like Phantom or Solflare), the "Connect Wallet" button will automatically trigger the mobile wallet to open for connection and transaction approval.
-   This provides a native-like experience without needing a browser extension.
-   The UI is designed to be responsive and should adapt well to various screen sizes.