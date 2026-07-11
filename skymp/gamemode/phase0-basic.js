console.log("[phase0] SkyMP Heavy RP gamemode loaded");

if (typeof mp !== "undefined") {
  console.log("[phase0] mp API available");
} else {
  console.log("[phase0] mp API not available");
}

setInterval(() => {
  // Keep the phase 0 gamemode process alive for connection tests.
}, 10000);
