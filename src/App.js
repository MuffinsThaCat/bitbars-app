import React, { useState, useEffect } from 'react';
import axios from 'axios';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import './App.css';

// Initialize ECC library
bitcoin.initEccLib(ecc);

// Constants
const DUST_AMOUNT = 546; // Minimum sat value for outputs
const SATS_PER_BTC = 100000000;

// Ensure Buffer is available
if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = require('buffer').Buffer;
}

function App() {
  const [selectedWallet, setSelectedWallet] = useState(null);
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Initialize bitcoinjs network
  const network = bitcoin.networks.bitcoin;

  const connectWallet = async (walletType) => {
    try {
      setError('');
      if (walletType === 'unisat') {
        if (typeof window.unisat === 'undefined') {
          throw new Error('UniSat wallet is not installed');
        }
        const accounts = await window.unisat.requestAccounts();
        setAddress(accounts[0]);
        setSelectedWallet('unisat');
        setConnected(true);
      }
    } catch (error) {
      console.error('Connection error:', error);
      setError(error.message);
    }
  };

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file && file.size <= 400 * 1024) { // 400KB in bytes
      setSelectedFile(file);
      setError('');
    } else {
      setError('File size must be 400KB or less');
      setSelectedFile(null);
    }
  };

  // Function to get current fee rate from mempool.space API
  const getFeeRate = async () => {
    try {
      const response = await axios.get('https://mempool.space/api/v1/fees/recommended');
      return response.data.hourFee; // Use hourFee for a balance of speed and cost
    } catch (error) {
      console.error('Error fetching fee rate:', error);
      return 3; // Default to minimum fee rate if API fails
    }
  };

  const createInscriptionTransaction = async (fileData, feeRate) => {
    try {
      // Get address and check balance
      const [address] = await window.unisat.getAccounts();
      const balance = await window.unisat.getBalance();
      console.log('Connected address:', address);
      console.log('Wallet balance:', balance);

      if (balance.total < DUST_AMOUNT) {
        throw new Error(`Insufficient balance. Have ${balance.total} sats, need at least ${DUST_AMOUNT} sats`);
      }

      // Get UTXOs from the wallet
      const utxos = await window.unisat.getBitcoinUtxos();
      console.log('Raw UTXOs:', utxos);
      console.log('UTXO Structure:', {
        firstUtxo: utxos[0],
        utxoKeys: utxos[0] ? Object.keys(utxos[0]) : [],
        txId: utxos[0]?.txId,
        txid: utxos[0]?.txid,
        outputIndex: utxos[0]?.outputIndex,
        vout: utxos[0]?.vout,
        satoshis: utxos[0]?.satoshis,
        value: utxos[0]?.value
      });

      if (!utxos || utxos.length === 0) {
        throw new Error('No UTXOs available');
      }

      // Calculate required amount and fees
      const inscriptionSize = fileData.length + 546; // Add overhead for script
      const MIN_FEE_RATE = 3; // Minimum fee rate in sats/vbyte
      const currentFeeRate = await getFeeRate(); // Get current network fee rate
      const effectiveFeeRate = Math.max(MIN_FEE_RATE, currentFeeRate); // Use at least MIN_FEE_RATE
      
      // Estimate transaction size (p2tr input + inscription output + change output)
      const estimatedTxSize = 200; // Base size for P2TR transaction
      const estimatedFee = Math.ceil(estimatedTxSize * effectiveFeeRate);
      const totalRequired = DUST_AMOUNT + estimatedFee;

      console.log('Fee calculation:', {
        inscriptionSize,
        currentFeeRate,
        effectiveFeeRate,
        estimatedTxSize,
        estimatedFee,
        totalRequired
      });

      // Find suitable UTXO
      const selectedUtxo = utxos.find(utxo => {
        const value = utxo.satoshis || utxo.value || 0;
        return value >= totalRequired;
      });

      if (!selectedUtxo) {
        const totalAvailable = utxos.reduce((sum, utxo) => sum + (utxo.satoshis || utxo.value || 0), 0);
        const largestUtxo = Math.max(...utxos.map(u => u.satoshis || u.value || 0));
        throw new Error(`No suitable UTXO found. Need ${totalRequired} sats (${estimatedFee} fee), largest UTXO is ${largestUtxo} sats, total available is ${totalAvailable} sats`);
      }

      console.log('Selected UTXO:', selectedUtxo);

      // Create the transaction
      const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });

      // Add input
      const input = {
        hash: selectedUtxo.txId || selectedUtxo.txid,
        index: parseInt(selectedUtxo.outputIndex || selectedUtxo.vout),
        witnessUtxo: {
          script: Buffer.from(selectedUtxo.scriptPk || selectedUtxo.scriptPubKey, 'hex'),
          value: parseInt(selectedUtxo.satoshis || selectedUtxo.value)
        }
      };

      console.log('PSBT Input:', input);
      psbt.addInput(input);

      // Create P2TR inscription output
      const inscriptionScript = bitcoin.script.compile([
        bitcoin.opcodes.OP_1,
        bitcoin.script.number.encode(32),
        Buffer.from('ord'),
        Buffer.from([1]), // version
        Buffer.from('application/octet-stream'),
        Buffer.from([0]), // separator
        Buffer.from(fileData)
      ]);

      // Get the connected wallet's pubkey
      const pubkey = await window.unisat.getPublicKey();
      console.log('Wallet pubkey:', pubkey);

      // Create P2TR output
      const { address: inscriptionAddress } = bitcoin.payments.p2tr({
        internalPubkey: Buffer.from(pubkey, 'hex').slice(1), // Remove the first byte (type)
        scriptTree: {
          output: inscriptionScript
        },
        network: bitcoin.networks.bitcoin
      });

      // Add inscription output
      psbt.addOutput({
        address: inscriptionAddress,
        value: DUST_AMOUNT + 153 // Add minimum relay fee to the inscription output
      });

      // Add change output if needed
      const changeAmount = parseInt(selectedUtxo.satoshis || selectedUtxo.value) - (DUST_AMOUNT + 153) - estimatedFee;
      if (changeAmount > DUST_AMOUNT) {
        psbt.addOutput({
          address: address,
          value: changeAmount
        });
      }

      // Convert to base64
      const psbtBase64 = psbt.toBase64();
      console.log('PSBT Base64:', psbtBase64);

      return psbtBase64;
    } catch (error) {
      console.error('Error creating transaction:', error);
      throw error;
    }
  };

  const inscribeFile = async () => {
    if (!selectedFile || !connected) return;

    try {
      setLoading(true);
      setError('');

      // Get current fee rate
      const feeRate = await getFeeRate();

      // Read file
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const fileData = new Uint8Array(e.target.result);
          
          // Create and sign transaction
          const psbtBase64 = await createInscriptionTransaction(fileData, feeRate);
          console.log('Created PSBT:', psbtBase64);

          // Sign with wallet
          const signedPsbtBase64 = await window.unisat.signPsbt(psbtBase64);
          console.log('Signed PSBT:', signedPsbtBase64);

          // Broadcast transaction
          const txid = await window.unisat.pushPsbt(signedPsbtBase64);
          console.log('Transaction broadcast:', txid);

          alert(`Inscription created! Transaction ID: ${txid}\nYou can view it on the blockchain explorer once confirmed.`);
          setLoading(false);

        } catch (error) {
          console.error('Inscription error:', error);
          setError(error.message);
          setLoading(false);
        }
      };

      reader.readAsArrayBuffer(selectedFile);

    } catch (error) {
      console.error('Error:', error);
      setError(error.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 py-6 flex flex-col justify-center sm:py-12">
      <div className="relative py-3 sm:max-w-xl sm:mx-auto">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-blue-600 shadow-lg transform -skew-y-6 sm:skew-y-0 sm:-rotate-6 sm:rounded-3xl"></div>
        <div className="relative px-4 py-10 bg-white shadow-lg sm:rounded-3xl sm:p-20">
          <div className="max-w-md mx-auto">
            <div className="divide-y divide-gray-200">
              <div className="py-8 text-base leading-6 space-y-4 text-gray-700 sm:text-lg sm:leading-7">
                <h2 className="text-2xl font-bold mb-8 text-center text-gray-900">Bitcoin Inscription Tool</h2>
                
                {error && (
                  <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-4">
                    <p className="text-red-700">{error}</p>
                  </div>
                )}

                {!connected ? (
                  <div className="space-y-4">
                    <p className="text-gray-600">Connect your wallet to start inscribing:</p>
                    <button
                      onClick={() => connectWallet('unisat')}
                      className="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 md:py-4 md:text-lg md:px-10"
                    >
                      Connect UniSat Wallet
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-gray-600">Connected Address:</p>
                    <p className="font-mono text-sm break-all bg-gray-50 p-2 rounded">{address}</p>
                    
                    <div className="mt-4">
                      <label className="block text-gray-600 mb-2">Select File to Inscribe (max 400KB):</label>
                      <input
                        type="file"
                        onChange={handleFileSelect}
                        className="w-full text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                      />
                    </div>

                    {selectedFile && (
                      <button
                        onClick={inscribeFile}
                        disabled={loading}
                        className="w-full mt-4 px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300"
                      >
                        {loading ? 'Creating Inscription...' : 'Inscribe File'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
