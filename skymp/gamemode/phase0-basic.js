console.log("[phase0] SkyMP Heavy RP gamemode loaded");

if (typeof mp !== "undefined") {
  console.log("[phase0] mp API available");
  
  mp._onSpawnAllowed = (...args) => {
    console.log("[phase0] _onSpawnAllowed called with args:", args);
    return true;
  };
} else {
  console.log("[phase0] mp API not available");
}

setInterval(() => {
  // Keep the phase 0 gamemode process alive for connection tests.
}, 10000);
