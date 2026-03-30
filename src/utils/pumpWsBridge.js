/**
 * Lets TokenModal request PumpPortal `subscribeTokenTrade` for a mint
 * using the WebSocket instance owned by Dashboard.
 */
let subscribeImpl = null;

export function registerPumpTokenTradeSubscriber(fn) {
  subscribeImpl = typeof fn === "function" ? fn : null;
}

export function subscribeMintTokenTrades(mint) {
  if (!mint || !subscribeImpl) return;
  subscribeImpl(mint);
}
