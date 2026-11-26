/** Browser device GPS (user must allow location permission). */
export function getDeviceGps(
  options?: PositionOptions,
): Promise<{ latitude: number; longitude: number; accuracyMeters: number | null }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("GPS is not supported in this browser"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyMeters:
            typeof pos.coords.accuracy === "number" && Number.isFinite(pos.coords.accuracy)
              ? pos.coords.accuracy
              : null,
        });
      },
      (err) => {
        const code = err?.code;
        if (code === 1) reject(new Error("Location permission denied. Allow GPS access and try again."));
        else if (code === 2) reject(new Error("GPS position unavailable. Try again outdoors or check device location."));
        else if (code === 3) reject(new Error("GPS timed out. Try again."));
        else reject(new Error(err?.message || "Could not get GPS location"));
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
        ...options,
      },
    );
  });
}
