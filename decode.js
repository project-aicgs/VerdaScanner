// raw-decoder.js
// Pure raw decoder with no formatting

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import msgpack from 'msgpack-lite';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'websocket_data.json');

// Function to decode data (handles both formats)
function decodeData(data) {
  try {
    // Handle MessagePack format (JSON with data array)
    if (data && typeof data === 'object' && data.type === "Buffer" && Array.isArray(data.data)) {
      const buffer = Buffer.from(data.data);
      try {
        return msgpack.decode(buffer);
      } catch (e) {
        return buffer.toString('utf8');
      }
    }
    
    // Handle zlib format (comma-separated string)
    if (typeof data === 'string' && data.includes(',')) {
      const numberArray = data.split(',').map(num => parseInt(num.trim(), 10));
      if (numberArray.some(isNaN)) return null;

      const compressedBuffer = Buffer.from(numberArray);
      const decompressed = zlib.inflateSync(compressedBuffer);
      const decompressedString = decompressed.toString('utf8');
      
      return JSON.parse(decompressedString);
    }
    
    return null;
  } catch (e) {
    console.error('Decode error:', e.message);
    return null;
  }
}

// Read and process the data file
const raw = fs.readFileSync(DATA_FILE, 'utf8');
const lines = raw.split(/\r?\n/);

for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  
  let payload;
  try {
    payload = JSON.parse(trimmed);
  } catch (e) {
    continue;
  }

  // Process token updates
  if (payload.event && payload.event.startsWith('token_updates_')) {
    console.log('=== TOKEN UPDATE ===');
    console.log('Event:', payload.event);
    
    let tokenData;
    if (typeof payload.data === 'string') {
      try {
        tokenData = JSON.parse(payload.data);
      } catch (e) {
        tokenData = decodeData(payload.data);
      }
    } else {
      tokenData = payload.data;
    }
    
    if (tokenData) {
      console.log('RAW TOKEN DATA:');
      console.log(JSON.stringify(tokenData, null, 2));
    }
    console.log('');
  }

  // Process liquidity pool updates
  if (payload.event && payload.event.startsWith('liquidityPoolsV2_')) {
    console.log('=== LIQUIDITY POOL UPDATE ===');
    console.log('Event:', payload.event);
    
    const decodedData = decodeData(payload.data);
    if (decodedData) {
      console.log('RAW LIQUIDITY POOL DATA:');
      console.log(JSON.stringify(decodedData, null, 2));
    }
    console.log('');
  }

  // Process wallet transactions
  if (payload.event && payload.event.startsWith('walletWiseSwaps_')) {
    console.log('=== WALLET TRANSACTION ===');
    console.log('Event:', payload.event);
    
    const decodedData = decodeData(payload.data);
    if (decodedData) {
      console.log('RAW TRANSACTION DATA:');
      console.log(JSON.stringify(decodedData, null, 2));
    }
    console.log('');
  }
}