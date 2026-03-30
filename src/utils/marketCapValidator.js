// marketCapValidator.js - Centralized validation for all token data
// This must be imported where leaderboardStore is available
// import { getToken } from './leaderboardStore.js';

// Configuration constants
const VALIDATION_CONFIG = {
    // Market cap bounds
    MIN_REALISTIC_MC: 1000, // $1K minimum
    MAX_REALISTIC_MC: 10_000_000_000, // $10B maximum
    
    // Change thresholds
    MIN_MC_FOR_CHANGE_CHECK: 30000, // Your threshold
    MAX_SINGLE_TRADE_MULTIPLIER: 2, // 2x max change
    MAX_SINGLE_TRADE_PERCENT: 0.5, // 50% max change alternative
    
    // Volume to MC ratio
    MAX_VOLUME_TO_MC_IMPACT: 1000, // MC shouldn't change more than 1000x the trade volume
    
    // Initial launch caps
    MAX_INITIAL_MC: 1_000_000, // $1M max for first appearance
    MIN_INITIAL_MC: 2000, // $5K minimum for first appearance
    
    // Data quality
    MAX_PRICE_DECIMALS: 18, // Prevent overflow
    MAX_SUPPLY: 1e15, // Realistic max supply
    
    // Circuit breaker
    MAX_CONSECUTIVE_FAILURES: 5,
    FAILURE_COOLDOWN_MS: 60000 // 1 minute
  };
  
  // Track validation failures per token
  const validationFailures = new Map();
  
  /**
   * Main validation entry point
   * @param {Object} data - Raw token data
   * @param {string} source - 'pumpfun' or 'bullx'
   * @param {string} eventType - 'create', 'trade', 'update', etc.
   * @returns {Object} { isValid: boolean, data: normalizedData, errors: string[] }
   */
  export function validateTokenData(data, source, eventType = 'update') {
    const errors = [];
    const result = {
      isValid: true,
      data: null,
      errors: errors
    };
  
    try {
      // Step 1: Basic data structure check
      if (!data || typeof data !== 'object') {
        errors.push('Invalid data structure');
        result.isValid = false;
        return result;
      }
  
      // Step 2: Normalize and clean data
      const normalizedData = normalizeTokenData(data, source);
      
      // Step 3: Validate numbers and bounds
      const numberResult = validateNumbers(normalizedData);
      if (!numberResult.isValid) {
        errors.push(...numberResult.errors);
        result.isValid = false;
        return result;
      }
  
      // Step 4: Get contract address for further checks
      const contractAddress = normalizedData.contractAddress || normalizedData.mint;
      
      if (!contractAddress) {
        errors.push('No contract address found');
        result.isValid = false;
        return result;
      }
      
      // Step 5: Validate market cap change (your 30k rule)
      // Need to import getToken where this is used
      if (typeof getToken !== 'undefined') {
        const existingToken = getToken(contractAddress);
        if (existingToken) {
          const changeResult = validateMarketCapChange(
            existingToken.currentMarketCap,
            normalizedData.marketCapUSD || normalizedData.currentMarketCap,
            normalizedData.volumeUSD
          );
          
          if (!changeResult.isValid) {
            errors.push(...changeResult.errors);
            
            // Track failures for circuit breaker
            trackValidationFailure(contractAddress);
            
            // Check if we should circuit break this token
            if (shouldCircuitBreak(contractAddress)) {
              errors.push(`Token ${contractAddress} has too many validation failures`);
              result.isValid = false;
              return result;
            }
          }
        } else {
          // Validate initial market cap for new tokens
          const initialResult = validateInitialMarketCap(
            normalizedData.marketCapUSD || normalizedData.initialMarketCap
          );
          
          if (!initialResult.isValid) {
            errors.push(...initialResult.errors);
            result.isValid = false;
            return result;
          }
        }
      }
  
      // Step 6: Cross-field validation
      const consistencyResult = validateDataConsistency(normalizedData);
      if (!consistencyResult.isValid) {
        errors.push(...consistencyResult.errors);
        result.isValid = false;
        return result;
      }
  
      // If we made it here, data is valid
      result.data = normalizedData;
      
      // Clear any previous failures for this token
      if (result.isValid && contractAddress) {
        validationFailures.delete(contractAddress);
      }
  
    } catch (error) {
      // console.error('Validation error:', error);
      errors.push(`Validation exception: ${error.message}`);
      result.isValid = false;
    }
  
    if (!result.isValid) {
      // console.warn(`Validation failed for ${source} token:`, errors);
    }
  
    return result;
  }
  
  /**
   * Clean and validate number values
   */
  function cleanNumber(value) {
    // Handle various number formats
    if (typeof value === 'number') {
      if (!isFinite(value) || isNaN(value)) return null;
      return value;
    }
  
    if (typeof value === 'string') {
      // Remove common formatting
      const cleaned = value.replace(/[,$\s]/g, '');
      
      // Check for hex
      if (cleaned.startsWith('0x')) {
        const parsed = parseInt(cleaned, 16);
        return isNaN(parsed) ? null : parsed;
      }
      
      // Parse as float
      const parsed = parseFloat(cleaned);
      if (!isFinite(parsed) || isNaN(parsed)) return null;
      
      return parsed;
    }
  
    return null;
  }
  
  /**
   * Normalize data structure between sources
   */
  function normalizeTokenData(data, source) {
    const normalized = {};
  
    // Copy all fields, cleaning numbers as we go
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'number' || (typeof value === 'string' && /^[\d.,-]+$/.test(value))) {
        const cleaned = cleanNumber(value);
        if (cleaned !== null) {
          normalized[key] = cleaned;
        } else {
          normalized[key] = value; // Keep original if cleaning failed
        }
      } else {
        normalized[key] = value;
      }
    }
  
    // Standardize field names
    if (source === 'pumpfun') {
      normalized.contractAddress = data.mint;
      normalized.currentMarketCap = normalized.marketCapUSD;
    } else if (source === 'bullx') {
      normalized.mint = data.contractAddress;
      normalized.marketCapUSD = normalized.currentMarketCap || normalized.peakMarketCap || normalized.initialMarketCap;
    }
  
    // Ensure we have both address formats
    normalized.contractAddress = normalized.contractAddress || normalized.mint;
    normalized.mint = normalized.mint || normalized.contractAddress;
  
    return normalized;
  }
  
  /**
   * Validate number bounds and sanity
   */
  function validateNumbers(data) {
    const errors = [];
  
    // Check market cap bounds
    const marketCap = data.marketCapUSD || data.currentMarketCap || data.initialMarketCap;
    if (marketCap !== undefined) {
      if (marketCap < 0) {
        errors.push('Market cap cannot be negative');
      } else if (marketCap > VALIDATION_CONFIG.MAX_REALISTIC_MC) {
        errors.push(`Market cap ${marketCap} exceeds maximum ${VALIDATION_CONFIG.MAX_REALISTIC_MC}`);
      } else if (marketCap > 0 && marketCap < VALIDATION_CONFIG.MIN_REALISTIC_MC) {
        errors.push(`Market cap ${marketCap} below minimum ${VALIDATION_CONFIG.MIN_REALISTIC_MC}`);
      }
    }
  
    // Check for common decimal errors
    if (marketCap > 1e15) {
      errors.push('Market cap suggests decimal error');
    }
  
    // Validate supply if present
    if (data.supply !== undefined) {
      if (data.supply > VALIDATION_CONFIG.MAX_SUPPLY) {
        errors.push('Token supply exceeds realistic maximum');
      }
    }
  
    // Validate price decimals
    if (data.priceUSD !== undefined) {
      const priceStr = data.priceUSD.toString();
      const decimalIndex = priceStr.indexOf('.');
      if (decimalIndex > -1) {
        const decimals = priceStr.length - decimalIndex - 1;
        if (decimals > VALIDATION_CONFIG.MAX_PRICE_DECIMALS) {
          errors.push('Price has too many decimal places');
        }
      }
    }
  
    return { isValid: errors.length === 0, errors };
  }
  
  /**
   * Validate market cap changes (implements your 30k rule)
   */
  function validateMarketCapChange(oldMC, newMC, volume) {
    const errors = [];
  
    if (!oldMC || !newMC) {
      return { isValid: true, errors }; // Can't validate without both values
    }
  
    // Your 30k rule: if old > 30k and new > 2x old, reject
    if (oldMC > VALIDATION_CONFIG.MIN_MC_FOR_CHANGE_CHECK) {
      if (newMC > oldMC * VALIDATION_CONFIG.MAX_SINGLE_TRADE_MULTIPLIER) {
        errors.push(
          `Market cap change too large: ${formatMC(oldMC)} -> ${formatMC(newMC)} ` +
          `(${((newMC / oldMC - 1) * 100).toFixed(1)}% increase)`
        );
      }
      
      // Also check for massive drops
      if (newMC < oldMC * 0.1) { // 90% drop
        errors.push(
          `Market cap drop too large: ${formatMC(oldMC)} -> ${formatMC(newMC)} ` +
          `(${((1 - newMC / oldMC) * 100).toFixed(1)}% decrease)`
        );
      }
    }
  
    // Volume to market cap impact check
    if (volume && volume > 0) {
      const mcChange = Math.abs(newMC - oldMC);
      const impactRatio = mcChange / volume;
      
      if (impactRatio > VALIDATION_CONFIG.MAX_VOLUME_TO_MC_IMPACT) {
        errors.push(
          `MC change (${formatMC(mcChange)}) is ${impactRatio.toFixed(0)}x ` +
          `the trade volume (${formatMC(volume)})`
        );
      }
    }
  
    return { isValid: errors.length === 0, errors };
  }
  
  /**
   * Validate initial market cap for new tokens
   */
  function validateInitialMarketCap(marketCap) {
    const errors = [];
  
    if (!marketCap) {
      return { isValid: true, errors }; // Can't validate without value
    }
  
    if (marketCap > VALIDATION_CONFIG.MAX_INITIAL_MC) {
      errors.push(
        `Initial market cap ${formatMC(marketCap)} exceeds maximum ` +
        `${formatMC(VALIDATION_CONFIG.MAX_INITIAL_MC)} for new tokens`
      );
    }
  
    if (marketCap < VALIDATION_CONFIG.MIN_INITIAL_MC) {
      errors.push(
        `Initial market cap ${formatMC(marketCap)} below minimum ` +
        `${formatMC(VALIDATION_CONFIG.MIN_INITIAL_MC)}`
      );
    }
  
    return { isValid: errors.length === 0, errors };
  }
  
  /**
   * Cross-field consistency validation
   */
  function validateDataConsistency(data) {
    const errors = [];
  
    // If we have price and supply, verify market cap calculation
    if (data.priceUSD && data.supply && data.marketCapUSD) {
      const calculatedMC = data.priceUSD * data.supply;
      const reportedMC = data.marketCapUSD;
      const deviation = Math.abs(calculatedMC - reportedMC) / reportedMC;
      
      if (deviation > 0.1) { // 10% tolerance
        errors.push(
          `Market cap inconsistency: reported ${formatMC(reportedMC)} but ` +
          `price * supply = ${formatMC(calculatedMC)}`
        );
      }
    }
  
    // Volume shouldn't exceed market cap
    if (data.volumeUSD && data.marketCapUSD) {
      if (data.volumeUSD > data.marketCapUSD * 2) { // 2x tolerance for high volume
        errors.push('Volume exceeds market cap by unrealistic amount');
      }
    }
  
    return { isValid: errors.length === 0, errors };
  }
  
  /**
   * Circuit breaker tracking
   */
  function trackValidationFailure(contractAddress) {
    const now = Date.now();
    const failures = validationFailures.get(contractAddress) || { count: 0, firstFailure: now };
    
    failures.count++;
    failures.lastFailure = now;
    
    validationFailures.set(contractAddress, failures);
  }
  
  function shouldCircuitBreak(contractAddress) {
    const failures = validationFailures.get(contractAddress);
    if (!failures) return false;
    
    // Reset if cooldown period has passed
    const timeSinceFirst = Date.now() - failures.firstFailure;
    if (timeSinceFirst > VALIDATION_CONFIG.FAILURE_COOLDOWN_MS) {
      validationFailures.delete(contractAddress);
      return false;
    }
    
    return failures.count >= VALIDATION_CONFIG.MAX_CONSECUTIVE_FAILURES;
  }
  
  /**
   * Utility function to format market cap for logging
   */
  function formatMC(value) {
    if (!value) return '$0';
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
    return `$${value.toFixed(2)}`;
  }
  
  /**
   * Get validation statistics
   */
  export function getValidationStats() {
    const stats = {
      totalFailures: 0,
      failingTokens: [],
      circuitBreakerTokens: []
    };
    
    for (const [address, failures] of validationFailures.entries()) {
      stats.totalFailures += failures.count;
      stats.failingTokens.push({
        address,
        failures: failures.count,
        lastFailure: new Date(failures.lastFailure).toISOString()
      });
      
      if (shouldCircuitBreak(address)) {
        stats.circuitBreakerTokens.push(address);
      }
    }
    
    return stats;
  }
  
  /**
   * Clear validation failures (for testing or reset)
   */
  export function clearValidationFailures() {
    validationFailures.clear();
  }
  
  // Export config for external use/modification
  export { VALIDATION_CONFIG };