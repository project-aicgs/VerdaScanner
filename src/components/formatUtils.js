// Function to format large numbers with abbreviations
export function formatMarketCap(value) {
    if (!value || isNaN(value)) return '$0';
    
    const num = Math.abs(value);
    
    if (num >= 1e9) {
      return '$' + (num / 1e9).toFixed(2) + 'B';
    } else if (num >= 1e6) {
      return '$' + (num / 1e6).toFixed(2) + 'M';
    } else if (num >= 1e3) {
      return '$' + (num / 1e3).toFixed(2) + 'K';
    } else {
      return '$' + num.toFixed(2);
    }
  }
  
  // Function to format volume numbers
  export function formatVolume(value) {
    if (!value || isNaN(value)) return '$0';
    
    const num = Math.abs(value);
    
    if (num >= 1e9) {
      return '$' + (num / 1e9).toFixed(2) + 'B';
    } else if (num >= 1e6) {
      return '$' + (num / 1e6).toFixed(2) + 'M';
    } else if (num >= 1e3) {
      return '$' + (num / 1e3).toFixed(2) + 'K';
    } else {
      return '$' + num.toFixed(2);
    }
  }